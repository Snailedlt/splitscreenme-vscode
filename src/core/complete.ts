// Text-based expression resolution for completion, hover and signature help.
// Works on incomplete code (while typing), so it scans text instead of parsing.
import { Resolved, resolveGlobal, resolveIndex, resolveMember } from './api';

const ID = /[A-Za-z_$][\w$]*/y;

/** Segments of a member chain: identifiers, or '[]' for an index access. */
export type Chain = string[];

/**
 * Parse the member chain that ends right before `end`, e.g. for
 * `foo(Context.Options["x"].` returns ['Context', 'Options', '[]'].
 */
export function chainEndingAt(text: string, end: number): Chain | undefined {
  const segs: string[] = [];
  let i = end;
  const skipWs = () => {
    while (i > 0 && /\s/.test(text[i - 1])) i--;
  };
  for (;;) {
    skipWs();
    if (text[i - 1] === ']') {
      // balanced [...] backwards
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j--) {
        if (text[j] === ']') depth++;
        else if (text[j] === '[' && --depth === 0) break;
      }
      if (j < 0) return undefined;
      const inner = text.slice(j + 1, i - 1).trim();
      const lit = inner.match(/^(["'])([A-Za-z_$][\w$]*)\1$/);
      segs.unshift(lit ? lit[2] : '[]');
      i = j;
    } else {
      let j = i;
      while (j > 0 && /[\w$]/.test(text[j - 1])) j--;
      if (j === i || /\d/.test(text[j])) return undefined;
      segs.unshift(text.slice(j, i));
      i = j;
    }
    skipWs();
    if (text[i - 1] === '.') {
      i--;
      continue;
    }
    if (text[i - 1] === '[') return undefined;
    break;
  }
  // `foo.bar` where foo is itself a property (preceded by '.') isn't a root
  return segs;
}

/** Parse a forward chain like `PlayerList[i]` or `Game.Hook` (for alias right-hand sides). */
function parseForwardChain(src: string): Chain | undefined {
  src = src.trim();
  const segs: string[] = [];
  let i = 0;
  ID.lastIndex = 0;
  const first = ID.exec(src);
  if (!first) return undefined;
  segs.push(first[0]);
  i = ID.lastIndex;
  while (i < src.length) {
    while (/\s/.test(src[i])) i++;
    if (src[i] === '.') {
      i++;
      while (/\s/.test(src[i])) i++;
      ID.lastIndex = i;
      const m = ID.exec(src);
      if (!m) return undefined;
      segs.push(m[0]);
      i = ID.lastIndex;
    } else if (src[i] === '[') {
      const close = src.indexOf(']', i);
      if (close < 0) return undefined;
      segs.push('[]');
      i = close + 1;
    } else return undefined;
  }
  return segs;
}

/** Simple aliases such as `var player = PlayerList[i];` found anywhere in the text. */
export function findAliases(text: string): Map<string, Chain | null> {
  const map = new Map<string, Chain | null>();
  const re = /(?:\b(?:var|let|const)\s+|(?:^|[;{}(,]\s*))([A-Za-z_$][\w$]*)\s*=(?!=)\s*([^;\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (name === 'var' || name === 'let' || name === 'const') continue;
    const chain = parseForwardChain(m[2]);
    const prev = map.get(name);
    if (prev === undefined) map.set(name, chain ?? null);
    else if (prev && chain && prev.join('.') !== chain.join('.')) map.set(name, null);
    else if (!chain) map.set(name, null);
  }
  return map;
}

export function resolveChain(chain: Chain, aliases: Map<string, Chain | null>, depth = 0): Resolved | undefined {
  if (!chain.length || depth > 5) return undefined;
  const [head, ...rest] = chain;
  let cur: Resolved | undefined;
  const alias = aliases.get(head);
  if (alias) cur = resolveChain(alias, aliases, depth + 1);
  else if (alias === null) return undefined; // user variable we can't follow
  else cur = resolveGlobal(head);
  for (const seg of rest) {
    if (!cur) return undefined;
    cur = seg === '[]' ? resolveIndex(cur) : resolveMember(cur, seg).resolved;
  }
  return cur;
}

export interface MemberContext {
  /** What the expression before the dot resolves to. */
  base: Resolved;
  /** Identifier typed so far after the dot. */
  partial: string;
  partialStart: number;
}

/** For completion: `Game.Ho|` -> base Game, partial "Ho". */
export function memberContextAt(text: string, offset: number): MemberContext | undefined {
  let s = offset;
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
  let d = s;
  while (d > 0 && /[ \t]/.test(text[d - 1])) d--;
  if (text[d - 1] !== '.') return undefined;
  const chain = chainEndingAt(text, d - 1);
  if (!chain) return undefined;
  const base = resolveChain(chain, findAliases(text));
  if (!base) return undefined;
  return { base, partial: text.slice(s, offset), partialStart: s };
}

/** For hover: resolve the identifier at `offset` (with its chain). */
export function resolveAt(text: string, offset: number): { resolved: Resolved; start: number; end: number } | undefined {
  let s = offset;
  let e = offset;
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
  while (e < text.length && /[\w$]/.test(text[e])) e++;
  if (s === e) return undefined;
  const chain = chainEndingAt(text, e);
  if (!chain) return undefined;
  // a lone identifier that is a property of something unknown (x.Context) is not a global
  let p = s;
  while (p > 0 && /\s/.test(text[p - 1])) p--;
  if (chain.length === 1 && text[p - 1] === '.') return undefined;
  const resolved = resolveChain(chain, findAliases(text));
  return resolved ? { resolved, start: s, end: e } : undefined;
}

export interface CallContext {
  callee: Resolved;
  /** Index of the argument the cursor is in. */
  activeParameter: number;
  isNew: boolean;
}

/** For signature help: find the innermost unclosed call around `offset`. */
export function callContextAt(text: string, offset: number): CallContext | undefined {
  const start = Math.max(0, offset - 4000);
  const stack: { pos: number; commas: number; ch: string }[] = [];
  for (let i = start; i < offset; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < offset && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 || nl > offset ? offset : nl;
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 || e > offset ? offset : e + 1;
    } else if (c === '(' || c === '[' || c === '{') stack.push({ pos: i, commas: 0, ch: c });
    else if (c === ')' || c === ']' || c === '}') stack.pop();
    else if (c === ',' && stack.length) stack[stack.length - 1].commas++;
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const frame = stack[k];
    if (frame.ch !== '(') {
      // inside an array/object literal that is itself an argument: keep looking outward
      continue;
    }
    const chain = chainEndingAt(text, frame.pos);
    if (!chain) return undefined;
    const isNew = /\bnew\s+[\w$.\s]+$/.test(text.slice(Math.max(0, frame.pos - 200), frame.pos));
    const callee = resolveChain(chain, findAliases(text));
    if (!callee) return undefined;
    // active parameter counts commas in the call frame only (nested literals are separate frames)
    return { callee, activeParameter: frame.commas, isNew };
  }
  return undefined;
}
