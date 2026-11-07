// Format a handler: indentation and the spacing between tokens, nothing else.
//
// Safe for Nucleus by construction:
// - Line breaks stay where they are (Nucleus runs the file line by line, and ASI depends on them);
//   only runs of blank lines shrink to one.
// - Tokens, strings and comments are never changed: the result is tokenized again and compared,
//   token by token, with the original. Any difference and nothing is formatted.
// - Lines inside a multi-line comment (or a string continued with a backslash) are left as they are.
// - Lines at the top level stay unindented, so the Hub install still finds `Game.GameName` and
//   `Game.ExecutableName` at the start of a line.
import * as acorn from 'acorn';

export interface FormatOptions {
  /** One level of indentation; detected from the file when left out (tab, 2 or 4 spaces). */
  indent?: string;
}
export type FormatResult = { ok: true; code: string; changed: boolean } | { ok: false; reason: string };

/** acorn's token types carry these at runtime; its typings leave them out. */
type TT = acorn.TokenType & { binop?: number | null; isAssign?: boolean; beforeExpr?: boolean; prefix?: boolean; keyword?: string };
type Tok = { kind: 'tok'; type: TT; value: string; start: number; end: number; line: number; endLine: number };
type Com = { kind: 'com'; block: boolean; value: string; start: number; end: number; line: number; endLine: number };
type Item = Tok | Com;

const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const OPENERS = new Set(['(', '[', '{', '${']);
const CLOSERS = new Set([')', ']', '}']);
/** Operators newer than ES5, which ES5's tokenizer splits in two. */
const GLUED = new Set(['=>', '**', '**=', '?.', '??']);

function lex(text: string): { items: Item[]; lineStarts: number[] } | string {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const items: Item[] = [];
  try {
    const tokens = acorn.tokenizer(text, {
      ecmaVersion: 5,
      allowReserved: true,
      allowHashBang: false,
      onComment: (block, value, start, end) => items.push({ kind: 'com', block, value, start, end, line: lineOf(start), endLine: lineOf(end - 1) }),
    });
    for (const t of tokens) items.push({ kind: 'tok', type: t.type as TT, value: text.slice(t.start, t.end), start: t.start, end: t.end, line: lineOf(t.start), endLine: lineOf(Math.max(t.start, t.end - 1)) });
  } catch (e) {
    return (e as Error).message;
  }
  items.sort((a, b) => a.start - b.start);
  return { items, lineStarts };
}

const label = (t: Item | undefined) => (t?.kind === 'tok' ? t.type.label : '');
const isWord = (t: Item | undefined) => t?.kind === 'tok' && (t.type.label === 'name' || t.type.label === 'num' || t.type.label === 'string' || t.type.label === 'regexp' || !!t.type.keyword);
const closesExpr = (t: Item | undefined) => t?.kind === 'tok' && (t.type.label === 'name' || t.type.label === 'num' || t.type.label === 'string' || t.type.label === 'regexp' || t.value === 'this' || t.value === 'true' || t.value === 'false' || t.value === 'null' || CLOSERS.has(t.value));

/** Whether a +/-/++/-- token is a prefix (unary) one, from the token before it. */
const isPrefix = (prev: Tok | undefined) => !prev || (prev.type.beforeExpr && !closesExpr(prev)) || (!!prev.type.keyword && prev.value !== 'this' && prev.value !== 'true' && prev.value !== 'false' && prev.value !== 'null');

export function formatHandler(text: string, options: FormatOptions = {}): FormatResult {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const src = text.slice(bom.length);
  const eol = (src.match(/\r\n/g)?.length ?? 0) > (src.match(/(?<!\r)\n/g)?.length ?? 0) ? '\r\n' : '\n';
  const body = src.replace(/\r\n/g, '\n');
  const lexed = lex(body);
  if (typeof lexed === 'string') return { ok: false, reason: `The file can't be read as ES5 (${lexed}), so it isn't formatted. Fix that first (Check lists it).` };
  const { items, lineStarts } = lexed;
  const lines = body.split('\n');
  const unit = options.indent ?? detectIndent(lines);

  // Lines inside a multi-line comment or token: left exactly as they are.
  const raw = new Set<number>();
  for (const it of items) for (let l = it.line + 1; l <= it.endLine; l++) raw.add(l);
  const byLine = new Map<number, Item[]>();
  for (const it of items) {
    if (!byLine.has(it.line)) byLine.set(it.line, []);
    byLine.get(it.line)!.push(it);
  }

  const toks = items.filter((i): i is Tok => i.kind === 'tok');
  const prevTok = new Map<Item, Tok | undefined>();
  {
    let last: Tok | undefined;
    for (const it of items) {
      prevTok.set(it, last);
      if (it.kind === 'tok') last = it;
    }
  }

  // Ternary `?` … `:` pairs, so their `:` gets spaces (an object key's or a case's doesn't).
  const ternaryColon = new Set<Tok>();
  {
    const stack: number[] = [0];
    for (const t of toks) {
      if (OPENERS.has(t.value)) stack.push(0);
      else if (CLOSERS.has(t.value)) stack.length > 1 && stack.pop();
      else if (t.value === '?') stack[stack.length - 1]++;
      else if (t.value === ':' && stack[stack.length - 1] > 0) {
        stack[stack.length - 1]--;
        ternaryColon.add(t);
      }
    }
  }

  const space = (a: Item, b: Item): string => {
    if (b.kind === 'com' || a.kind === 'com') return ' ';
    const A = a.value;
    const B = b.value;
    // Never glue tokens into a different one: a - -b, a + +b, a - --b.
    if ((A.endsWith('+') && B.startsWith('+')) || (A.endsWith('-') && B.startsWith('-'))) return ' ';
    // ES5 reads `=>` (and `**`, `?.`, `??`) as two tokens; written together, they stay together, so
    // code that isn't ES5 yet keeps its meaning (`() => 1` must not become `() = > 1`).
    if (a.end === b.start && GLUED.has(A + B)) return '';
    if (B === ',' || B === ';' || B === ')' || B === ']') return '';
    if (A === '(' || A === '[') return '';
    if (A === '.' || B === '.') return '';
    if (A === '{') return B === '}' ? '' : ' ';
    if (B === '}') return ' ';
    if (B === ':') return ternaryColon.has(b) ? ' ' : '';
    if (A === ':' || A === ',' || A === ';' || A === '?' || B === '?') return ' ';
    if (B === '(') {
      if (a.type.keyword) return a.value === 'function' || CONTROL.has(A) || a.type.beforeExpr ? ' ' : '';
      return closesExpr(a) ? '' : ' ';
    }
    if (B === '[') return closesExpr(a) ? '' : ' ';
    if (B === '{') return ' ';
    // Prefix operators stick to their operand; postfix ones to theirs.
    if (label(a) === '!/~') return '';
    if ((label(a) === '+/-' || label(a) === '++/--') && isPrefix(prevTok.get(a))) return '';
    if (label(b) === '++/--' && !isPrefix(prevTok.get(b))) return '';
    if (b.type.binop != null || b.type.isAssign || label(b) === '=' || a.type.binop != null || a.type.isAssign || label(a) === '=') return ' ';
    if (isWord(a) || isWord(b)) return ' ';
    return ' ';
  };

  // Indentation: one level per line that opened brackets still open (two brackets opened on one
  // line, as in `foo([`, count once), one more for case bodies inside a switch, for the body of an
  // if/for/while/else without braces, and for a line that continues an expression.
  type Open = { value: string; line: number; isSwitch: boolean; control: boolean };
  const stack: Open[] = [];
  const out: string[] = [];
  let blank = 0;
  let prevLast: Tok | undefined; // the last token of the previous line with code
  let parenKeyword: string | undefined;
  const parenKeywords: (string | undefined)[] = [];
  let lastClosedParenKeyword: string | undefined;
  let inCase = 0;
  for (let ln = 0; ln < lines.length; ln++) {
    if (raw.has(ln)) {
      out.push(lines[ln]);
      blank = 0;
      continue;
    }
    const its = byLine.get(ln) ?? [];
    if (!its.length) {
      if (++blank <= 1 && out.length) out.push('');
      continue;
    }
    blank = 0;
    // Leading closers dedent this line.
    let k = 0;
    const tmp = [...stack];
    while (k < its.length && its[k].kind === 'tok' && CLOSERS.has((its[k] as Tok).value) && tmp.length) {
      tmp.pop();
      k++;
    }
    const levelOf = (s: Open[]) => {
      let n = 0;
      let lastLine = -1;
      for (const o of s) {
        if (o.line !== lastLine) n++;
        lastLine = o.line;
        if (o.isSwitch) n++;
      }
      return n;
    };
    let level = levelOf(tmp);
    const first = its[0];
    const firstVal = first.kind === 'tok' ? first.value : '';
    const top = tmp[tmp.length - 1];
    if (top?.isSwitch && (firstVal === 'case' || firstVal === 'default')) level--;
    else if (top?.isSwitch && inCase === 0) level--;
    // A body without braces, or an expression continued on this line.
    const afterHeader = prevLast && ((prevLast.value === ')' && CONTROL.has(lastClosedParenKeyword ?? '') && lastClosedParenKeyword !== 'switch' && lastClosedParenKeyword !== 'catch') || prevLast.value === 'else' || prevLast.value === 'do');
    const continues =
      (prevLast && prevLast.value !== ',' && (prevLast.type.binop != null || prevLast.type.isAssign || prevLast.value === '=' || prevLast.value === '?' || prevLast.value === '.' || ternaryColon.has(prevLast))) ||
      (first.kind === 'tok' && (first.value === '.' || first.value === '?' || ternaryColon.has(first) || (first.type.binop != null && !isPrefix(prevTok.get(first)))));
    if ((afterHeader && firstVal !== '{') || continues) level++;
    let line = unit.repeat(Math.max(0, level));
    for (let i = 0; i < its.length; i++) {
      const it = its[i];
      if (i > 0) line += space(its[i - 1], it);
      // Something that runs onto the next lines (a block comment, a continued string): only its
      // part on this line goes here; the rest of its lines are kept as they are.
      if (it.endLine > it.line) line += body.slice(it.start, ln + 1 < lineStarts.length ? lineStarts[ln + 1] - 1 : body.length);
      else line += it.kind === 'tok' ? it.value : it.block ? `/*${it.value}*/` : `//${it.value.trimEnd()}`;
    }
    // Trailing spaces go, unless they belong to a comment or string that goes on to the next line.
    const runsOn = its[its.length - 1].endLine > ln;
    out.push(runsOn ? line : line.replace(/[ \t]+$/, ''));
    // Update the bracket stack with this line's tokens.
    for (const it of its) {
      if (it.kind !== 'tok') continue;
      const v = it.value;
      const p = prevTok.get(it);
      if (v === '(') {
        parenKeywords.push(p?.type.keyword ? p.value : undefined);
        stack.push({ value: v, line: ln, isSwitch: false, control: false });
      } else if (v === ')') {
        lastClosedParenKeyword = parenKeywords.pop();
        if (stack.length) stack.pop();
      } else if (v === '{') {
        const isSwitch = p?.value === ')' && lastClosedParenKeyword === 'switch';
        stack.push({ value: v, line: ln, isSwitch, control: false });
        if (isSwitch) inCase = 0;
      } else if (v === '[') stack.push({ value: v, line: ln, isSwitch: false, control: false });
      else if (v === ']' || v === '}') {
        if (stack.length) stack.pop();
      } else if ((v === 'case' || v === 'default') && stack[stack.length - 1]?.isSwitch) inCase = 1;
      if (v !== ')') lastClosedParenKeyword = v === ')' ? lastClosedParenKeyword : lastClosedParenKeyword;
    }
    const lastTok = [...its].reverse().find((x): x is Tok => x.kind === 'tok');
    if (lastTok) {
      prevLast = lastTok;
      if (lastTok.value !== ')') lastClosedParenKeyword = lastTok.value === 'else' || lastTok.value === 'do' ? lastClosedParenKeyword : undefined;
    }
    void parenKeyword;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  const formatted = out.join('\n') + '\n';

  // The guarantee: the same tokens and comments, in the same order.
  const again = lex(formatted);
  // (Trailing spaces after a // comment don't count: removing them is part of formatting.)
  const sig = (l: { items: Item[] }) => l.items.map((i) => (i.kind === 'tok' ? `${i.type.label}\u0000${i.value}` : `c\u0000${i.block}\u0000${i.block ? i.value : i.value.trimEnd()}`));
  const before = sig(lexed);
  const after = typeof again === 'string' ? null : sig(again);
  if (!after || after.length !== before.length || after.some((s, i) => s !== before[i])) {
    if (!after) return { ok: false, reason: `Formatting would have broken the code (${again}), so nothing was changed. Please report this handler.` };
    const i = after.findIndex((s, j) => s !== before[j]);
    const at = lexed.items[Math.max(0, i)];
    return { ok: false, reason: `Formatting would have changed the code itself (near line ${at ? at.line + 1 : '?'}: ${JSON.stringify(before[i]?.split('\u0000').pop())} became ${JSON.stringify(after?.[i]?.split('\u0000').pop())}), so nothing was changed. Please report this handler.` };
  }
  // Same line breaks (blank lines aside), so Nucleus' line-by-line reading is unaffected.
  const lineSig = (l: { items: Item[] }, t: string) => {
    const nonBlank = t.split('\n').map((x, i) => (x.trim() ? i : -1)).filter((i) => i >= 0);
    const rank = new Map(nonBlank.map((l2, i) => [l2, i]));
    return l.items.map((i) => rank.get(i.line) ?? -1).join(',');
  };
  if (typeof again !== 'string' && lineSig(lexed, body) !== lineSig(again, formatted)) return { ok: false, reason: 'Formatting would have moved code to other lines, so nothing was changed. Please report this handler.' };
  const code = bom + (eol === '\r\n' ? formatted.replace(/\n/g, '\r\n') : formatted);
  return { ok: true, code, changed: code !== text };
}

/** The file's own indentation: tabs, or the most common step between indented lines (2 or 4). */
export function detectIndent(lines: string[]): string {
  let tabs = 0;
  const steps = new Map<number, number>();
  let prev = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = l.match(/^[ \t]*/)![0];
    if (m.includes('\t')) {
      tabs++;
      prev = m.replace(/\t/g, '    ').length;
      continue;
    }
    const n = m.length;
    const d = Math.abs(n - prev);
    if (d === 2 || d === 4) steps.set(d, (steps.get(d) ?? 0) + 1);
    prev = n;
  }
  const spaces = [...steps.values()].reduce((a, b) => a + b, 0);
  if (tabs > spaces) return '\t';
  return (steps.get(2) ?? 0) > (steps.get(4) ?? 0) ? '  ' : '    ';
}
