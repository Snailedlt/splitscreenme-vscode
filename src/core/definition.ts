// Go to definition and find references inside a handler: where a function or variable is declared (scopes as
// Jint has them: `var`, `let` and `const` all function-scoped, function declarations hoisted), where an option is
// set (`Game.Play` -> its `Game.Play = …` line), and which `Game.AddOption(…)` a `Context.Options["key"]` reads.
// Plain data (offsets), shared by VS Code, the Language Server, the Notepad++ plugin and the workbench.
import type * as acorn from 'acorn';
import { parseLikeJint } from './jsparse';

export interface Span {
  start: number;
  end: number;
}

type Node = acorn.Node & Record<string, any>;

const ID_CHAR = /[\w$]/;
function wordAt(text: string, offset: number): Span | undefined {
  let s = offset;
  let e = offset;
  while (s > 0 && ID_CHAR.test(text[s - 1])) s--;
  while (e < text.length && ID_CHAR.test(text[e])) e++;
  return e > s && !/\d/.test(text[s]) ? { start: s, end: e } : undefined;
}

function parse(text: string): Node | undefined {
  try {
    return parseLikeJint(text, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true }).program as Node;
  } catch {
    return undefined;
  }
}

const isFunction = (n: Node) => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';

function children(n: Node): Node[] {
  const out: Node[] = [];
  for (const k of Object.keys(n)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    const v = (n as any)[k];
    if (Array.isArray(v)) for (const c of v) c && typeof c.type === 'string' && out.push(c);
    else if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

interface Scope {
  names: Map<string, Span>;
  parent?: Scope;
}

/** The names a function (or the program) declares: params, `var`/`let`/`const` anywhere in it (not in nested functions), function declarations. */
function declare(body: Node, scope: Scope, params: Node[] = []) {
  const add = (id: Node | undefined) => {
    if (id?.type === 'Identifier' && !scope.names.has(id.name)) scope.names.set(id.name, { start: id.start, end: id.end });
  };
  params.forEach(add);
  const walk = (n: Node) => {
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) add(d.id);
    if (n.type === 'FunctionDeclaration') {
      add(n.id);
      return; // its body is its own scope
    }
    if (isFunction(n)) return;
    if (n.type === 'CatchClause') add(n.param);
    children(n).forEach(walk);
  };
  walk(body);
}

/** Every identifier that is a variable reference (not a property name or object key), with the scope it's in. */
function forEachReference(program: Node, visit: (id: Node, scope: Scope) => void) {
  const root: Scope = { names: new Map() };
  declare(program, root);
  const walk = (n: Node, scope: Scope, parent?: Node) => {
    if (isFunction(n)) {
      const inner: Scope = { names: new Map(), parent: scope };
      // A named function expression sees its own name.
      if (n.type === 'FunctionExpression' && n.id) inner.names.set(n.id.name, { start: n.id.start, end: n.id.end });
      declare(n.body, inner, n.params);
      if (n.id && n.type === 'FunctionDeclaration') visit(n.id, scope);
      for (const p of n.params) walk(p, inner, n);
      walk(n.body, inner, n);
      return;
    }
    if (n.type === 'Identifier') {
      const isProperty = parent && ((parent.type === 'MemberExpression' && parent.property === n && !parent.computed) || (parent.type === 'Property' && parent.key === n && !parent.computed && !parent.shorthand));
      if (!isProperty) visit(n, scope);
      return;
    }
    for (const c of children(n)) walk(c, scope, n);
  };
  walk(program, root);
}

function lookup(scope: Scope | undefined, name: string): Span | undefined {
  for (let s = scope; s; s = s.parent) {
    const d = s.names.get(name);
    if (d) return d;
  }
  return undefined;
}

/** `Context.Options["mode"]`: the `Game.AddOption(…, "mode", …)` that defines that key. */
function optionKeyDefinition(text: string, offset: number): Span | undefined {
  const before = text.slice(Math.max(0, offset - 200), offset);
  const after = text.slice(offset, offset + 200);
  const m = /Context\s*\.\s*Options\s*\[\s*(["'])([^"'\\\n]*)$/.exec(before);
  const rest = m ? new RegExp(`^([^"'\\\\\\n]*)${m[1]}`).exec(after) : undefined;
  if (!m || !rest) return undefined;
  const key = m[2] + rest[1];
  const re = /Game\s*\.\s*AddOption\s*\(/g;
  let call: RegExpExecArray | null;
  while ((call = re.exec(text))) {
    // AddOption(name, description, key, value(s), default): the third argument is the key.
    const args = /^\s*(["'])(?:[^\\]|\\.)*?\1\s*,\s*(["'])(?:[^\\]|\\.)*?\2\s*,\s*(["'])((?:[^\\]|\\.)*?)\3/.exec(text.slice(call.index + call[0].length));
    if (args && args[4] === key) {
      const at = text.indexOf(args[3] + key + args[3], call.index + call[0].length);
      return { start: at + 1, end: at + 1 + key.length };
    }
  }
  return undefined;
}

/** `Game.Play` (or any `Game.X`, `Game.Hook.X`, user `obj.x`): where the handler first sets it at the top level. */
function memberAssignment(text: string, chain: string): Span | undefined {
  const re = new RegExp(`(^|[;{}\\n])[ \\t]*(${chain.split('.').map((p) => p.replace(/\$/g, '\\$')).join('\\s*\\.\\s*')})\\s*=(?!=)`, 'g');
  const m = re.exec(text);
  if (!m) return undefined;
  const start = m.index + m[0].indexOf(m[2]);
  return { start, end: start + m[2].length };
}

/** Where the name at `offset` is defined in this handler, if it is. */
export function definitionAt(text: string, offset: number): Span | undefined {
  const key = optionKeyDefinition(text, offset);
  if (key) return key;
  const w = wordAt(text, offset);
  if (!w) return undefined;
  // A member (`Game.Play`, `Game.Hook.ForceFocus`): its assignment.
  let d = w.start;
  while (d > 0 && /\s/.test(text[d - 1])) d--;
  if (text[d - 1] === '.') {
    let s = d - 1;
    while (s > 0 && /[\w$.\s]/.test(text[s - 1]) && !/\n/.test(text[s - 1])) s--;
    const chain = (text.slice(s, d) + text.slice(w.start, w.end)).replace(/\s+/g, '').replace(/^\.+/, '');
    const at = memberAssignment(text, chain);
    return at;
  }
  const program = parse(text);
  if (program) {
    let found: Span | undefined;
    forEachReference(program, (id, scope) => {
      if (!found && id.start <= offset && offset <= id.end) found = lookup(scope, id.name) ?? { start: -1, end: -1 };
    });
    if (found && found.start >= 0) return found;
    // A global set without `var` (`count = 0;`): its first assignment.
    return memberAssignment(text, text.slice(w.start, w.end));
  }
  // Doesn't parse (being typed): the first `function name` or `var name`.
  const name = text.slice(w.start, w.end);
  const m = new RegExp(`\\b(?:function\\s+|(?:var|let|const)\\s+)(${name.replace(/\$/g, '\\$')})\\b`).exec(text);
  return m ? { start: m.index + m[0].length - name.length, end: m.index + m[0].length } : undefined;
}

/** Every use of the variable or function at `offset` (its declaration included), when it is the handler's own. */
export function referencesAt(text: string, offset: number): Span[] {
  const program = parse(text);
  if (!program) return [];
  let target: Span | undefined;
  forEachReference(program, (id, scope) => {
    if (!target && id.start <= offset && offset <= id.end) target = lookup(scope, id.name);
  });
  if (!target) return [];
  const out: Span[] = [];
  forEachReference(program, (id, scope) => {
    const d = lookup(scope, id.name);
    if (d && d.start === target!.start) out.push({ start: id.start, end: id.end });
  });
  if (!out.some((s) => s.start === target!.start)) out.unshift(target);
  return out.sort((a, b) => a.start - b.start);
}
