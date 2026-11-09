// Code in the docs, laid out as prettier would: short code stays on one line; code wider than the box breaks calls,
// arrays and objects one item per line, indented, and hugs a last array/object/function argument the way prettier
// does (`f(a, b, [` … `])`). For the small pieces of code the docs show (examples, signatures), in every tool, with
// no dependency. Only code it fully understands is reprinted (statements of expressions and `var`s, no comments);
// anything else comes back exactly as written, so it can never change what code says.
import * as acorn from 'acorn';

// The layout: text, arrays of parts, groups (flat if they fit), indents, lines (soft: no space when flat), hard lines
// and the call-argument choice (flat / hug the last / one per line).
type Doc = any;
const group = (...c: Doc[]): Doc => ({ t: 'group', c });
const indent = (...c: Doc[]): Doc => ({ t: 'indent', c });
const line: Doc = { t: 'line', soft: false }; // a space, or a new line when its group breaks
const softline: Doc = { t: 'line', soft: true }; // nothing, or a new line
const hardline: Doc = { t: 'line', soft: false, hard: true }; // always a new line (and its group breaks)

class Unsupported extends Error {}

function printNode(n: any, src: string): Doc {
  switch (n.type) {
    case 'Identifier':
    case 'ThisExpression':
      return src.slice(n.start, n.end);
    case 'Literal':
      return n.raw;
    case 'MemberExpression':
      return [printNode(n.object, src), n.computed ? ['[', printNode(n.property, src), ']'] : ['.', printNode(n.property, src)]] as unknown as Doc;
    case 'CallExpression':
      return [printNode(n.callee, src), args(n.arguments, src)] as unknown as Doc;
    case 'NewExpression':
      return ['new ', printNode(n.callee, src), args(n.arguments, src)] as unknown as Doc;
    case 'ArrayExpression':
      if (!n.elements.length) return '[]';
      if (n.elements.some((e: any) => e === null)) throw new Unsupported();
      return group('[', indent(softline, ...join(n.elements.map((e: any) => printNode(e, src)), [',', line])), softline, ']');
    case 'ObjectExpression':
      if (!n.properties.length) return '{}';
      return group('{', indent(line, ...join(n.properties.map((p: any) => {
        if (p.kind !== 'init' || p.computed || p.method || p.shorthand) throw new Unsupported();
        return [printNode(p.key, src), ': ', printNode(p.value, src)] as unknown as Doc;
      }), [',', line])), line, '}');
    case 'AssignmentExpression':
      return assignment([printNode(n.left, src), ` ${n.operator}`], n.right, src);
    case 'BinaryExpression':
    case 'LogicalExpression': {
      // A chain of one operator (`a + b + c`): one group, every operand on its own line when it breaks (prettier).
      const parts: any[] = [];
      let x = n;
      while ((x.type === 'BinaryExpression' || x.type === 'LogicalExpression') && x.operator === n.operator) {
        parts.unshift(x.right);
        x = x.left;
      }
      parts.unshift(x);
      return group(...join(parts.map((p) => printNode(p, src)), [` ${n.operator}`, line]));
    }
    case 'UnaryExpression':
      return [n.operator, /^[a-z]/.test(n.operator) ? ' ' : '', printNode(n.argument, src)] as unknown as Doc;
    case 'ConditionalExpression':
      return group(printNode(n.test, src), indent(line, '? ', printNode(n.consequent, src), line, ': ', printNode(n.alternate, src)));
    case 'FunctionExpression': {
      // A callback: its statements laid out too (or kept as written, re-indented, when they're more than this prints).
      const params = n.params.map((p: any) => printNode(p, src));
      const head = ['function ', n.id ? printNode(n.id, src) : '', '(', ...join(params, [', ']), ') '];
      if (!n.body.body.length) return [...head, '{}'];
      let body: Doc[];
      try {
        body = n.body.body.map((st: any) => printStatement(st, src));
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        body = src.slice(n.body.start + 1, n.body.end - 1).trim().split('\n').map((l) => l.trim());
      }
      return [...head, '{', indent(...body.flatMap((d) => [hardline, d])), hardline, '}'];
    }
    default:
      throw new Unsupported();
  }
}

/** `left = right`: a chain or condition on the right moves to its own indented lines when it doesn't fit (prettier);
 *  arrays, objects, calls and functions open on the same line. */
function assignment(left: Doc[], right: any, src: string): Doc {
  const r = printNode(right, src);
  if (['BinaryExpression', 'LogicalExpression', 'ConditionalExpression'].includes(right.type)) return group(...left, group(indent(line, r)));
  return group(...left, ' ', r);
}

/** One statement: an expression or a `var` with one name. */
function printStatement(s: any, src: string): Doc {
  if (s.type === 'ExpressionStatement') return [printNode(s.expression, src), ';'];
  if (s.type === 'VariableDeclaration' && s.declarations.length === 1) {
    const d = s.declarations[0];
    return [d.init ? assignment([`${s.kind} `, printNode(d.id, src), ' ='], d.init, src) : [`${s.kind} `, printNode(d.id, src)], ';'];
  }
  if (s.type === 'ReturnStatement') return ['return', ...(s.argument ? [' ', printNode(s.argument, src)] : []), ';'];
  throw new Unsupported();
}

/** Arguments: flat if they fit; else the last one hugged when it's an array, object or function; else one per line. */
function args(list: any[], src: string): Doc {
  if (!list.length) return '()';
  const printed = list.map((a) => printNode(a, src));
  const last = list[list.length - 1];
  const huggable = ['ArrayExpression', 'ObjectExpression', 'FunctionExpression'].includes(last.type) && !list.slice(0, -1).some((a) => ['ArrayExpression', 'ObjectExpression', 'FunctionExpression'].includes(a.type));
  const expanded = group('(', indent(softline, ...join(printed, [',', line])), softline, ')');
  if (!huggable) return expanded;
  return { t: 'conditional', flat: group('(', ...join(printed, [', ']), ')'), hug: ['(', ...join(printed.slice(0, -1), [', ']), printed.length > 1 ? ', ' : '', printed[printed.length - 1], ')'], expanded } as unknown as Doc;
}

function join(docs: Doc[], sep: Doc[]): Doc[] {
  return docs.flatMap((d, i) => (i ? [...sep, d] : [d]));
}

// ---- The printer (Wadler / prettier style) ----
type Mode = 'flat' | 'break';
function fits(next: [number, Mode, Doc][], width: number): boolean {
  let rest = width;
  const stack = [...next];
  while (rest >= 0 && stack.length) {
    const [ind, mode, d] = stack.pop()!;
    if (typeof d === 'string') rest -= d.length;
    else if (Array.isArray(d)) for (let i = d.length - 1; i >= 0; i--) stack.push([ind, mode, d[i]]);
    else if ((d as any).t === 'line') {
      if ((d as any).hard) return mode === 'break';
      if (mode === 'break') return true;
      rest -= (d as any).soft ? 0 : 1;
    } else if ((d as any).t === 'conditional') stack.push([ind, mode, (d as any).flat]);
    else stack.push([ind, (d as any).t === 'group' ? 'flat' : mode, (d as any).c]);
  }
  return rest >= 0;
}
function render(doc: Doc, width: number): string {
  let out = '';
  let col = 0;
  const stack: [number, Mode, Doc][] = [[0, 'break', doc]];
  while (stack.length) {
    const [ind, mode, d] = stack.pop()!;
    if (typeof d === 'string') {
      out += d;
      col += d.length;
    } else if (Array.isArray(d)) for (let i = d.length - 1; i >= 0; i--) stack.push([ind, mode, d[i]]);
    else if ((d as any).t === 'indent') stack.push([ind + 2, mode, (d as any).c]);
    else if ((d as any).t === 'group') {
      const flat = fits([[ind, 'flat', (d as any).c]], width - col);
      stack.push([ind, flat ? 'flat' : 'break', (d as any).c]);
    } else if ((d as any).t === 'conditional') {
      const c = d as any;
      if (fits([[ind, 'flat', c.flat]], width - col)) stack.push([ind, 'flat', c.flat]);
      // Hugging: everything before the last argument fits on this line, and the last one opens here.
      else if (fits([[ind, 'flat', firstLine(c.hug)]], width - col)) stack.push([ind, 'break', c.hug]);
      else stack.push([ind, 'break', c.expanded]);
    } else if ((d as any).t === 'line') {
      if (mode === 'flat' && !(d as any).hard) {
        if (!(d as any).soft) {
          out += ' ';
          col++;
        }
      } else {
        out += '\n' + ' '.repeat(ind);
        col = ind;
      }
    }
  }
  return out.replace(/[ \t]+$/gm, '');
}
/** The hugged layout up to where the last argument opens (its first group's opening bracket). */
function firstLine(d: any): Doc {
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    const out: Doc[] = [];
    for (const x of d) {
      if (typeof x !== 'string' && !Array.isArray(x) && x.t === 'group') return [...out, x.c[0]] as unknown as Doc;
      out.push(firstLine(x));
      if (typeof x !== 'string' && !Array.isArray(x) && (x.t === 'line' || x.t === 'indent')) return out as unknown as Doc;
    }
    return out as unknown as Doc;
  }
  return d.t === 'group' ? d.c[0] : d;
}

/** Code laid out to `width` columns (prettier's style), or the code as written if it isn't plain enough to reprint. */
export function prettyCode(code: string, width = 60): string {
  const src = code.trim();
  if (!src || /\/\/|\/\*/.test(src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""'))) return code;
  let program: any;
  try {
    program = acorn.parse(src, { ecmaVersion: 5, allowReserved: true });
  } catch {
    return code;
  }
  try {
    const out = program.body.map((st: any) => render(printStatement(st, src), width));
    return out.join('\n');
  } catch (e) {
    if (e instanceof Unsupported) return code;
    throw e;
  }
}

/** A signature (`Owner.Name(a: T, b: U): R`) wider than `width`: one parameter per line, as prettier prints them. */
export function prettySignature(sig: string, width = 60): string {
  if (sig.length <= width) return sig;
  const open = sig.indexOf('(');
  if (open < 0) return sig;
  // The matching `)` and the parameters between, split at top-level commas.
  let depth = 0;
  let close = -1;
  const parts: string[] = [];
  let start = open + 1;
  for (let i = open; i < sig.length; i++) {
    const c = sig[i];
    if ('([<{'.includes(c)) depth++;
    else if (')]>}'.includes(c)) {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    } else if (c === ',' && depth === 1) {
      parts.push(sig.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (close < 0) return sig;
  parts.push(sig.slice(start, close).trim());
  if (parts.length < 2 && parts[0].length + open < width) return sig;
  return `${sig.slice(0, open)}(\n${parts.filter(Boolean).map((p) => `  ${p}`).join(',\n')}\n)${sig.slice(close + 1)}`;
}
