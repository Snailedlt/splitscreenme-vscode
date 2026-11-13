// The handler's own names, for suggestions, hovers and parameter hints: the functions and variables it declares
// (with the comment above them as their docs), and the options it adds with `Game.AddOption` (so
// `Context.Options["…"]` can offer their keys, and a comparison their values). Plain data, shared by every editor.
// Tolerant of code being typed: when the handler doesn't parse, the line being edited is left out and it's tried again.
import { children, declare, isFunction, Node, Scope } from './definition';
import { parseLikeJint } from './jsparse';

export interface OwnName {
  name: string;
  kind: 'function' | 'variable' | 'parameter';
  /** `function copyCfg(player, folder)`, `var savePath`. */
  signature: string;
  params?: string[];
  /** The comment just above the declaration, without its `//` or `/* *​/`. */
  doc?: string;
  /** Where it's declared. */
  start: number;
  end: number;
}

/** The program, parsed even while lines are being typed: each line the parser stops at is blanked out and the rest
 *  tried again (a few times at most); failing that, the same after blanking the line being edited. */
export function parseTolerant(text: string, offset?: number): Node | undefined {
  const blank = (t: string, at: number) => {
    let s = t.lastIndexOf('\n', at - 1) + 1;
    let e = t.indexOf('\n', at);
    if (e < 0) e = t.length;
    // The parser often stops on the line after the broken one (`};` after `name().`): blank the last line with code.
    while (t.slice(s, e).trim() === '' && s > 0) {
      e = s - 1;
      s = t.lastIndexOf('\n', e - 1) + 1;
    }
    return t.slice(0, s) + ' '.repeat(e - s) + t.slice(e);
  };
  // Where the parser stops, blanked line by line; failing that, the line being edited first.
  const attempt = (t: string): Node | undefined => {
    for (let tries = 0; tries < 8; tries++) {
      try {
        return parseLikeJint(t, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true }).program as Node;
      } catch (e) {
        const pos = (e as { pos?: number }).pos;
        if (typeof pos !== 'number') return undefined;
        t = blank(t, Math.min(pos, t.length - 1));
      }
    }
    return undefined;
  };
  return attempt(text) ?? (offset !== undefined ? attempt(blank(text, offset)) : undefined);
}

/** The comment block right above `at` (no blank line between), as plain text. */
export function leadingComment(text: string, at: number): string | undefined {
  let lineStartAt = text.lastIndexOf('\n', at - 1) + 1;
  // Only when the declaration starts its line (`var a = 1, b = 2;` shares one comment).
  if (text.slice(lineStartAt, at).trim() !== '' && !/^\s*(var|let|const)\s*$/.test(text.slice(lineStartAt, at))) return undefined;
  const lines: string[] = [];
  let end = lineStartAt - 1;
  while (end > 0) {
    const s = text.lastIndexOf('\n', end - 1) + 1;
    const line = text.slice(s, end).replace(/\r$/, '');
    const t = line.trim();
    if (t.startsWith('//')) lines.unshift(t.replace(/^\/\/\s?/, ''));
    else if (t.endsWith('*/')) {
      const open = text.lastIndexOf('/*', end);
      if (open < 0) break;
      const body = text.slice(open + 2, text.lastIndexOf('*/', end)).split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trimEnd());
      lines.unshift(...body.filter((l, i) => l || (i > 0 && i < body.length - 1)));
      break;
    } else break;
    end = s - 1;
    lineStartAt = s;
  }
  const doc = lines.join('\n').trim();
  return doc || undefined;
}

const paramNames = (fn: Node) => fn.params.map((p: Node) => (p.type === 'Identifier' ? p.name : '…'));

function nameInfo(text: string, id: Node, decl: Node | undefined, kind: OwnName['kind']): OwnName {
  const fn = decl && isFunction(decl) ? decl : decl?.type === 'VariableDeclarator' && decl.init && isFunction(decl.init) ? decl.init : undefined;
  const at = decl?.type === 'VariableDeclarator' ? (decl as any).__declStart ?? decl.start : decl?.start ?? id.start;
  if (fn) {
    const params = paramNames(fn);
    return { name: id.name, kind: 'function', signature: `function ${id.name}(${params.join(', ')})`, params, doc: leadingComment(text, at), start: id.start, end: id.end };
  }
  return { name: id.name, kind, signature: kind === 'parameter' ? `(parameter) ${id.name}` : `var ${id.name}`, doc: kind === 'parameter' ? undefined : leadingComment(text, at), start: id.start, end: id.end };
}

/** Every function and variable the handler declares that the code at `offset` can see, innermost first. */
export function visibleNames(text: string, offset: number): OwnName[] {
  const program = parseTolerant(text, offset);
  if (!program) return regexNames(text);
  const out = new Map<string, OwnName>();
  const take = (body: Node, params: Node[]) => {
    const scope: Scope = { names: new Map() };
    declare(body, scope, params);
    const decls = declarationsIn(body, params);
    for (const [name] of scope.names) {
      if (out.has(name)) continue; // an inner one hides an outer one
      const d = decls.get(name);
      if (d) out.set(name, nameInfo(text, d.id, d.decl, d.kind));
    }
  };
  // The functions around `offset`, innermost first, then the program.
  const chain: Node[] = [];
  const walk = (n: Node) => {
    if (isFunction(n) && n.start <= offset && offset <= n.end) chain.push(n);
    for (const c of children(n)) if (c.start <= offset && offset <= c.end) walk(c);
  };
  walk(program);
  for (const fn of chain.reverse()) {
    take(fn.body, fn.params);
    if (fn.type === 'FunctionExpression' && fn.id && !out.has(fn.id.name)) out.set(fn.id.name, nameInfo(text, fn.id, fn, 'function'));
  }
  take(program, []);
  return [...out.values()];
}

/** For each name a scope declares: its identifier and the node that declares it. */
function declarationsIn(body: Node, params: Node[]): Map<string, { id: Node; decl?: Node; kind: OwnName['kind'] }> {
  const m = new Map<string, { id: Node; decl?: Node; kind: OwnName['kind'] }>();
  for (const p of params) if (p.type === 'Identifier' && !m.has(p.name)) m.set(p.name, { id: p, kind: 'parameter' });
  const walk = (n: Node) => {
    if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) if (d.id.type === 'Identifier' && !m.has(d.id.name)) {
        (d as any).__declStart = n.declarations[0] === d ? n.start : d.start;
        m.set(d.id.name, { id: d.id, decl: d, kind: 'variable' });
      }
    }
    if (n.type === 'FunctionDeclaration') {
      if (n.id && !m.has(n.id.name)) m.set(n.id.name, { id: n.id, decl: n, kind: 'function' });
      return;
    }
    if (isFunction(n)) return;
    if (n.type === 'CatchClause' && n.param?.type === 'Identifier' && !m.has(n.param.name)) m.set(n.param.name, { id: n.param, kind: 'variable' });
    children(n).forEach(walk);
  };
  walk(body);
  return m;
}

/** Without a parse: the `function x(…)` and `var x` lines. */
function regexNames(text: string): OwnName[] {
  const out = new Map<string, OwnName>();
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const name = m[1] ?? m[3];
    if (out.has(name)) continue;
    const start = m.index + m[0].indexOf(name);
    if (m[1]) {
      const params = m[2].split(',').map((p) => p.trim()).filter(Boolean);
      out.set(name, { name, kind: 'function', signature: `function ${name}(${params.join(', ')})`, params, doc: leadingComment(text, m.index), start, end: start + name.length });
    } else out.set(name, { name, kind: 'variable', signature: `var ${name}`, doc: leadingComment(text, m.index), start, end: start + name.length });
  }
  return [...out.values()];
}

/** The handler's own name at `offset`, as `visibleNames` sees it (for hovers and parameter hints). */
export function ownNameAt(text: string, offset: number, name: string): OwnName | undefined {
  return visibleNames(text, offset).find((n) => n.name === name);
}

// ---------------------------------------------------------------------------
// Options added with Game.AddOption(name, description, key, values[, default])

export interface AddedOption {
  key: string;
  name?: string;
  description?: string;
  /** The choices, when the values are a list the handler spells out (directly or in a `var`). */
  values?: string[];
  default?: string;
  /** The `Game.AddOption` call. */
  start: number;
  end: number;
}

const literal = (n: Node | undefined): string | undefined =>
  n?.type === 'Literal' && n.value !== null && typeof n.value !== 'object' ? String(n.value) : n?.type === 'BinaryExpression' && n.operator === '+' ? joinLiteral(n) : undefined;
function joinLiteral(n: Node): string | undefined {
  const a = literal(n.left);
  const b = literal(n.right);
  return a !== undefined && b !== undefined ? a + b : undefined;
}

/** Every `Game.AddOption(…)` in the handler, in order. */
export function addedOptions(text: string, offset?: number): AddedOption[] {
  const program = parseTolerant(text, offset);
  if (!program) return [];
  const arrays = new Map<string, Node>(); // var answers = ["a", "b"]: the last list each name is given
  const calls: Node[] = [];
  const walk = (n: Node) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'ArrayExpression') arrays.set(n.id.name, n.init);
    if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && n.right.type === 'ArrayExpression') arrays.set(n.left.name, n.right);
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.name === 'AddOption' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'Game') calls.push(n);
    children(n).forEach(walk);
  };
  walk(program);
  const out: AddedOption[] = [];
  for (const c of calls) {
    const [name, desc, key, values, def] = c.arguments as Node[];
    const k = literal(key);
    if (k === undefined) continue;
    let list: Node | undefined = values?.type === 'ArrayExpression' ? values : values?.type === 'Identifier' ? arrays.get(values.name) : undefined;
    const choices = list?.elements.map((e: Node) => literal(e)).filter((v: string | undefined): v is string => v !== undefined);
    out.push({ key: k, name: literal(name), description: literal(desc), values: choices?.length ? choices : undefined, default: literal(def) ?? (values && !list ? literal(values) : undefined), start: c.start, end: c.end });
  }
  return out;
}

/** Markdown for an option's hover and suggestion docs. */
export function optionMarkdown(o: AddedOption, text: string): string {
  const line = text.slice(0, o.start).split('\n').length;
  const parts = [`**${o.name ?? o.key}**` + (o.description ? `: ${o.description}` : '')];
  if (o.values) parts.push('Choices: ' + o.values.map((v) => `\`${v}\``).join(', '));
  if (o.default !== undefined) parts.push(`Default: \`${o.default}\``);
  parts.push(`Added by \`Game.AddOption\` on line ${line}. A saved profile gives the value back as text.`);
  return parts.join('\n\n');
}

/** Whether `offset` is in code, a string or a comment (a simple scan: enough for suggestions). */
export function codeStateAt(text: string, offset: number): 'code' | 'string' | 'comment' {
  for (let i = 0; i < offset; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (j >= offset) return 'string';
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl < 0 || nl >= offset) return 'comment';
      i = nl;
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      if (e < 0 || e + 2 > offset) return 'comment';
      i = e + 1;
    }
  }
  return 'code';
}

/** JavaScript keywords Jint's ES5 parser takes, for suggestions where a statement or expression starts. */
export const KEYWORDS = ['var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'new', 'typeof', 'instanceof', 'in', 'this', 'true', 'false', 'null', 'undefined', 'try', 'catch', 'finally', 'throw', 'delete'];

/**
 * What the handler's own functions give back, where it can be told: an `@returns {type}` in the comment above, or
 * every `return` giving the same kind of value (a string, a number, a list of strings). Name -> TypeScript type.
 */
export function ownReturnTypes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const program = parseTolerant(text);
  if (!program) return out;
  const kindOf = (n: Node | undefined): string | undefined => {
    if (!n) return undefined;
    if (n.type === 'Literal') return typeof n.value === 'string' ? 'string' : typeof n.value === 'number' ? 'number' : undefined;
    if (n.type === 'BinaryExpression' && n.operator === '+') {
      const a = kindOf(n.left);
      const b = kindOf(n.right);
      return a === 'string' || b === 'string' ? 'string' : a === 'number' && b === 'number' ? 'number' : undefined;
    }
    if (n.type === 'BinaryExpression' && ['-', '*', '/', '%'].includes(n.operator)) return 'number';
    if (n.type === 'ArrayExpression') return n.elements.length && n.elements.every((e: Node) => kindOf(e) === 'string') ? 'string[]' : 'any[]';
    return undefined;
  };
  const infer = (fn: Node, at: number): string | undefined => {
    const tag = /@returns?\s+\{([^}]+)\}/.exec(leadingComment(text, at) ?? '');
    if (tag) return tag[1].trim().replace(/^String$/, 'string').replace(/^Number$/, 'number');
    const kinds = new Set<string | undefined>();
    const walk = (n: Node) => {
      if (n !== fn && isFunction(n)) return;
      if (n.type === 'ReturnStatement') kinds.add(n.argument ? kindOf(n.argument) : undefined);
      children(n).forEach(walk);
    };
    walk(fn.body);
    const [only] = [...kinds];
    return kinds.size === 1 ? only : undefined;
  };
  const visit = (n: Node, stmtStart?: number) => {
    if (n.type === 'FunctionDeclaration' && n.id && !out.has(n.id.name)) {
      const t = infer(n, n.start);
      if (t) out.set(n.id.name, t);
    }
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier' && d.init && isFunction(d.init) && !out.has(d.id.name)) {
      const t = infer(d.init, n.declarations[0] === d ? n.start : d.start);
      if (t) out.set(d.id.name, t);
    }
    children(n).forEach((c) => visit(c, stmtStart));
  };
  visit(program);
  return out;
}
