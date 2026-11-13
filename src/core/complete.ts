// Text-based expression resolution for completion, hover and signature help.
// Works on incomplete code (while typing), so it scans text instead of parsing.
import { Resolved, resolveCall, resolveGlobal, resolveIndex, resolveMember, api, Member } from './api';
import { ownReturnTypes } from './ownsymbols';

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
    // A string literal starts the chain: `"a,b".split(",")`.
    if (text[i - 1] === '"' || text[i - 1] === "'") {
      const q = text[i - 1];
      let j = i - 2;
      while (j >= 0 && text[j] !== '\n' && !(text[j] === q && text[j - 1] !== '\\')) j--;
      if (j < 0 || text[j] !== q) return undefined;
      segs.unshift('$string');
      return segs;
    }
    // A call: `.replace("a", "b").` -> what it returns; the callee comes before the `(`.
    if (text[i - 1] === ')') {
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j--) {
        if (text[j] === ')') depth++;
        else if (text[j] === '(' && --depth === 0) break;
      }
      if (j < 0) return undefined;
      segs.unshift('()');
      i = j;
      skipWs();
      if (!/[\w$]/.test(text[i - 1] ?? '')) return undefined; // `(a + b).`: not followed
      continue;
    }
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
      skipWs();
      if (/[\w$\])]/.test(text[i - 1] ?? '')) continue; // `PlayerList[i].`: what's indexed comes before the `[`
      return undefined; // an array literal `[1, 2].`: not followed
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
  const lit = /^(["'])(?:[^\\\n]|\\.)*?\1/.exec(src);
  const first = lit ? undefined : ID.exec(src);
  if (lit) {
    segs.push('$string');
    i = lit[0].length;
  } else {
    if (!first) return undefined;
    segs.push(first[0]);
    i = ID.lastIndex;
  }
  while (i < src.length) {
    while (/\s/.test(src[i])) i++;
    if (i >= src.length) break;
    if (src[i] === '(') {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')' && --depth === 0) break;
      }
      if (j >= src.length) return undefined;
      segs.push('()');
      i = j + 1;
    } else if (src[i] === '.') {
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
    // A chain (`Context.UserProfileConfigPath.split("\\")`), else by its look: a string (`"-w " + Context.Width`,
    // `path + "\\x.ini"`: JavaScript's string methods, core/jsbuiltins.ts), a list or a number.
    const rhs = m[2].replace(/\s*\/\/.*$/, '').replace(/[\s;]+$/, '');
    const chain = parseForwardChain(rhs) ?? (/^\s*["']/.test(rhs) || /\+\s*["']|["']\s*\+/.test(rhs) ? ['$string'] : /^\s*\[/.test(rhs) ? ['$array'] : /^\s*-?\d/.test(rhs) && !/["']/.test(rhs) ? ['$number'] : undefined);
    const prev = map.get(name);
    if (prev === undefined) map.set(name, chain ?? null);
    else if (prev && chain && prev.join('.') !== chain.join('.')) map.set(name, null);
    else if (!chain) map.set(name, null);
  }
  // The handler's own functions whose result type is known: `myFn().` gets that type's members.
  for (const [name, type] of ownReturnTypes(text)) map.set(name, [`$function:${type}`]);
  return map;
}

export function resolveChain(chain: Chain, aliases: Map<string, Chain | null>, depth = 0): Resolved | undefined {
  if (!chain.length || depth > 5) return undefined;
  const [head, ...rest] = chain;
  let cur: Resolved | undefined;
  const alias = aliases.get(head);
  if (alias) cur = resolveChain(alias, aliases, depth + 1);
  else if (alias === null) return undefined; // user variable we can't follow
  else if (head === '$string') cur = { kind: 'object', type: 'String' };
  else if (head === '$array') cur = { kind: 'object', type: 'Array' };
  else if (head === '$number') cur = { kind: 'object', type: 'Number' };
  else if (head.startsWith('$function:')) cur = { kind: 'member', owner: '', name: head, member: { kind: 'method', own: true, doc: '', overloads: [{ returns: head.slice(10), params: [] }] } };
  else cur = resolveGlobal(head);
  for (const seg of rest) {
    if (!cur) return undefined;
    cur = seg === '[]' ? resolveIndex(cur) : seg === '()' ? resolveCall(cur) : resolveMember(cur, seg).resolved;
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
export function resolveAt(text: string, offset: number, aliases?: Map<string, Chain | null>): { resolved: Resolved; start: number; end: number } | undefined {
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
  const resolved = resolveChain(chain, aliases ?? findAliases(text));
  return resolved ? { resolved, start: s, end: e } : undefined;
}

export interface CallContext {
  callee: Resolved;
  /** Index of the argument the cursor is in. */
  activeParameter: number;
  isNew: boolean;
}

/** The innermost unclosed `(` around `offset` (strings and comments skipped), and how many commas it has so far. */
export function innerCallFrame(text: string, offset: number): { pos: number; commas: number } | undefined {
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
  // Inside an array/object literal that is itself an argument: the call around it.
  for (let k = stack.length - 1; k >= 0; k--) if (stack[k].ch === '(') return { pos: stack[k].pos, commas: stack[k].commas };
  return undefined;
}

/** For signature help: find the innermost unclosed call around `offset`. */
export function callContextAt(text: string, offset: number): CallContext | undefined {
  const frame = innerCallFrame(text, offset);
  if (!frame) return undefined;
  const chain = chainEndingAt(text, frame.pos);
  if (!chain) return undefined;
  const isNew = /\bnew\s+[\w$.\s]+$/.test(text.slice(Math.max(0, frame.pos - 200), frame.pos));
  const callee = resolveChain(chain, findAliases(text));
  if (!callee) return undefined;
  // active parameter counts commas in the call frame only (nested literals are separate frames)
  return { callee, activeParameter: frame.commas, isNew };
}

export interface ValueContext {
  /** The option being assigned, e.g. Game.DPIHandling. */
  owner: string;
  name: string;
  member: Member;
  /** What has been typed of the value so far, and where it starts. */
  partial: string;
  partialStart: number;
  /** Values to offer: enum values as `Nucleus.Enum.Value`, `true` / `false`, a function for callbacks, the usual
   *  window messages for `Game.ProtoInput.BlockedMessages`. `snippet` is the VS Code snippet form ($0 = cursor). */
  values: { value: string; detail?: string; snippet?: string }[];
}

/** `Game.DPIHandling = |` or `Game.KeepAspectRatio = tr|`: the values the option takes.
 *  For enum and boolean options, callbacks (`Game.Play = function () { ... };`) and BlockedMessages. */
export function valueContextAt(text: string, offset: number): ValueContext | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  const m = before.match(/([\w$.\]\[]+)\s*=\s*([\w$.]*)$/);
  if (!m) return undefined; // (a comparison like `a == b` or `a != b` doesn't match: no word right before the =)
  const targetEnd = lineStart + before.length - m[0].length + m[1].length;
  const r = resolveAt(text, targetEnd);
  if (!r || r.resolved.kind !== 'member') return undefined;
  const { owner, name, member } = r.resolved;
  if (member.kind === 'method' || member.readonly) return undefined;
  const t = member.type ?? '';
  let values: ValueContext['values'] = [];
  if (t.startsWith('enum:')) {
    const e = t.slice(5);
    values = Object.entries(api.enums[e]?.values ?? {}).map(([v, n]) => ({ value: `Nucleus.${e}.${v}`, detail: `= ${n}` }));
  } else if (t === 'boolean') {
    values = [{ value: 'true' }, { value: 'false' }];
  } else if (t === 'function') {
    values = [{ value: 'function () {\n};', detail: 'Nucleus calls it', snippet: 'function () {\n\t$0\n};' }];
  } else if (owner === 'GameProtoInput' && name === 'BlockedMessages') {
    // The set most Hub handlers block (core/wm.ts COMMON_MESSAGES).
    values = [{ value: '[0x0008, 0x02a1, 0x02a3];', detail: 'WM_KILLFOCUS, WM_MOUSEHOVER, WM_MOUSELEAVE: the usual set' }];
  }
  if (!values.length) return undefined;
  return { owner, name, member, partial: m[2], partialStart: offset - m[2].length, values };
}

/** A value in the code that can be picked from a list: `Game.SymlinkGame = |false|;` (testbench#22). */
export interface ValuePick {
  owner: string;
  name: string;
  member: Member;
  /** The value's span in the text, and its text. */
  start: number;
  end: number;
  current: string;
  kind: 'boolean' | 'enum' | 'number';
  /** The choices, in order; `current` marks the one that's there now, `isDefault` Nucleus' default. */
  options: { value: string; label: string; detail?: string; current?: boolean; isDefault?: boolean }[];
  /** Set when the value has the wrong type, in plain words ("text, not true or false"). */
  wrong?: string;
}

const BOOL_WRONG: Record<string, string> = { string: 'text in quotes, not true or false', number: 'a number, not true or false' };
const literalKind = (v: string): 'string' | 'number' | 'boolean' | 'enum' | undefined =>
  /^(["'])(?:[^\\]|\\.)*\1$/.test(v) ? 'string'
  : /^-?(\d+(\.\d+)?|0x[0-9a-f]+)$/i.test(v) ? 'number'
  : v === 'true' || v === 'false' ? 'boolean'
  : /^Nucleus\.\w+\.\w+$/.test(v) ? 'enum'
  : undefined;

/** Every pickable value in the text: assignments whose target is an option with true/false, enum or number values,
 *  and whose value is a plain literal (anything computed is left alone). */
export function valuePicks(text: string): ValuePick[] {
  return picksIn(text, 0);
}

/** The picks whose assignment starts at or after `from`. The text's aliases are read once, not once per assignment:
 *  that made moving the cursor in a long handler quadratic (30000 assignments froze the editor). */
function picksIn(text: string, from: number): ValuePick[] {
  const out: ValuePick[] = [];
  let aliases: Map<string, Chain | null> | undefined;
  const re = /([\w$.\]\[]+)[ \t]*=[ \t]*([^;\n=]+?)[ \t]*(?=;|\n|$|\/\/)/g;
  re.lastIndex = from;
  for (let m; (m = re.exec(text)); ) {
    const before = text[m.index - 1];
    if (before && /[\w$.=!<>]/.test(before)) continue;
    if (!literalKind(m[2])) continue;
    const pick = pickFor(text, m.index + m[1].length, m.index + m[0].length - m[2].length, m[2], (aliases ??= findAliases(text)));
    if (pick) out.push(pick);
  }
  return out;
}

/** The pickable value at (or touching) an offset, if any: only the cursor's line is searched. */
export function valuePickAt(text: string, offset: number): ValuePick | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', offset) < 0 ? text.length : text.indexOf('\n', offset);
  return picksIn(text.slice(0, lineEnd), lineStart).find((p) => offset >= p.start && offset <= p.end);
}

function pickFor(text: string, targetEnd: number, start: number, value: string, aliases?: Map<string, Chain | null>): ValuePick | undefined {
  const lit = literalKind(value);
  if (!lit) return undefined;
  const r = resolveAt(text, targetEnd, aliases);
  if (!r || r.resolved.kind !== 'member') return undefined;
  const { owner, name, member } = r.resolved;
  if (member.kind === 'method' || member.readonly) return undefined;
  const t = member.type ?? '';
  const end = start + value.length;
  const base = { owner, name, member, start, end, current: value };
  const def = member.default?.replace(/^(\w+)\.(\w+)$/, 'Nucleus.$1.$2');
  if (t === 'boolean') {
    const options = ['true', 'false'].map((v) => ({ value: v, label: v, current: v === value, isDefault: def === v }));
    return { ...base, kind: 'boolean', options, wrong: lit === 'boolean' ? undefined : BOOL_WRONG[lit] ?? 'not true or false' };
  }
  if (t.startsWith('enum:')) {
    const e = t.slice(5);
    const values = Object.entries(api.enums[e]?.values ?? {});
    if (!values.length) return undefined;
    const options = values.map(([v, n]) => {
      const full = `Nucleus.${e}.${v}`;
      return { value: full, label: v, detail: `= ${n}`, current: full === value, isDefault: def === full || member.default === v };
    });
    const known = options.some((o) => o.current);
    return { ...base, kind: 'enum', options, wrong: known ? undefined : lit === 'enum' ? 'not one of this option\'s values' : `${lit === 'string' ? 'text in quotes' : lit === 'number' ? 'a number' : lit}, not one of this option's values` };
  }
  if (t === 'number') {
    if (lit !== 'number') return lit === 'string' ? { ...base, kind: 'number', options: [], wrong: 'text in quotes, not a number' } : undefined;
    return { ...base, kind: 'number', options: [] };
  }
  return undefined;
}
