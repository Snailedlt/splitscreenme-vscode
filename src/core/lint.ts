// Static analysis for Nucleus Co-op handlers. Pure: no VS Code dependency, so
// the same code powers the editor diagnostics and the `nucleus-lint` CLI.
import * as acorn from 'acorn';
import {
  api,
  Member,
  Resolved,
  resolveGlobal,
  resolveIndex,
  resolveMember,
  ownerLabel,
  suggest,
  SimpleType,
} from './api';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export const RULES = {
  'syntax-error': { severity: 'error', description: 'The file cannot be parsed.' },
  'es5-only': {
    severity: 'error',
    description: 'Nucleus runs handlers with Jint 2.x, which only understands ES5 (plus let/const). Newer syntax (arrow functions, template strings, classes, spread, destructuring, ...) prevents the handler from loading.',
  },
  'let-const-semantics': {
    severity: 'info',
    description: 'Jint 2.x accepts `let` and `const` but treats them exactly like `var`: they are function-scoped (not block-scoped) and `const` can be reassigned.',
  },
  'unknown-member': {
    severity: 'warning',
    description: 'The property or method does not exist on this Nucleus object. Jint silently ignores writes to unknown properties and reads return undefined.',
  },
  'readonly-member': { severity: 'warning', description: 'The property is read-only (computed by Nucleus); assigning it has no effect.' },
  'type-mismatch': { severity: 'warning', description: 'The assigned value does not match the type Nucleus expects.' },
  'wrong-arguments': { severity: 'warning', description: 'No overload of this Nucleus method takes this number of arguments.' },
  'missing-required': { severity: 'error', description: 'Game.GUID, Game.GameName and Game.ExecutableName are required for Nucleus to load the handler.' },
  'callback-only-global': {
    severity: 'error',
    description: 'Context, Player, PlayerList, Handler and ProtoInput only exist while a callback such as Game.Play runs. Using them at the top level makes the handler fail to load.',
  },
  'duplicate-assignment': { severity: 'warning', description: 'The same option is set more than once at the top level; only the last value is used.' },
  'hub-install-parse': {
    severity: 'warning',
    description: 'When a handler is installed from the Hub, Nucleus finds Game.GameName and Game.ExecutableName by reading lines that start with them and taking the text between the first and last double quote.',
  },
  'guid-characters': { severity: 'info', description: 'Game.GUID becomes a folder name; use only letters, digits and spaces.' },
  deprecated: { severity: 'hint', description: 'The option is deprecated.' },
} as const satisfies Record<string, { severity: Severity; description: string }>;

export type RuleId = keyof typeof RULES;

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}
export interface Fix {
  title: string;
  edits: TextEdit[];
  preferred?: boolean;
}
export interface Diagnostic {
  rule: RuleId;
  severity: Severity;
  message: string;
  start: number;
  end: number;
  fixes?: Fix[];
  tags?: ('deprecated' | 'unnecessary')[];
}

export interface LintOptions {
  /** Per-rule severity override, or 'off'. */
  rules?: Partial<Record<RuleId, Severity | 'off'>>;
}

type Node = acorn.Node & Record<string, any>;

const CALLBACK_ONLY = new Set(['Context', 'Player', 'PlayerList', 'Handler', 'ProtoInput']);
const REQUIRED = ['GUID', 'GameName', 'ExecutableName'] as const;

export function lint(text: string, options: LintOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const comments: acorn.Comment[] = [];
  let program: Node;
  try {
    program = acorn.parse(text, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      onComment: comments,
    }) as Node;
  } catch (e: any) {
    const pos = typeof e.pos === 'number' ? e.pos : 0;
    out.push({
      rule: 'syntax-error',
      severity: 'error',
      message: String(e.message).replace(/\s*\(\d+:\d+\)$/, ''),
      start: pos,
      end: Math.min(text.length, pos + 1),
    });
    return finalize(out, text, comments, options);
  }

  new Analyzer(text, program, out).run();
  return finalize(out, text, comments, options);
}

// ---------------------------------------------------------------------------

interface Ctx {
  parent?: Node;
  fnDepth: number;
  inTypeof: boolean;
  topLevelStatement: boolean;
}

class Analyzer {
  private aliases = new Map<string, Resolved | null>();
  private shadowed = new Set<string>();
  /** Top-level assignments keyed by chain ("Game.Hook.ForceFocus"). */
  private topAssignments = new Map<string, Node[]>();
  private gameAssignedAnywhere = new Set<string>();

  constructor(
    private text: string,
    private program: Node,
    private out: Diagnostic[],
  ) {}

  run() {
    this.collectBindings();
    this.walk(this.program, { fnDepth: 0, inTypeof: false, topLevelStatement: false });
    this.checkRequired();
    this.checkDuplicates();
    this.checkHubInstall();
    this.checkGuid();
  }

  // ---- bindings / aliases ------------------------------------------------

  private collectBindings() {
    const inits = new Map<string, Node[]>();
    const add = (name: string, init: Node | null | undefined) => {
      if (!inits.has(name)) inits.set(name, []);
      if (init) inits.get(name)!.push(init);
      else inits.get(name)!.push(null as any);
    };
    visit(this.program, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') add(n.id.name, n.init);
      else if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'Identifier') add(n.left.name, n.right);
      else if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') && n.params) {
        if (n.id?.type === 'Identifier' && n.type === 'FunctionDeclaration') add(n.id.name, null);
        for (const p of n.params) if (p.type === 'Identifier') add(p.name, null);
      }
    });
    for (const [name, list] of inits) {
      if (api.globals[name]) {
        this.shadowed.add(name);
        continue;
      }
      // An alias is only trusted if every assignment resolves to the same kind of object.
      let res: Resolved | null | undefined;
      for (const init of list) {
        const r = init ? this.resolve(init, false) : undefined;
        const key = r ? describe(r) : null;
        if (res === undefined) res = r ?? null;
        else if (!r || !res || describe(res) !== key) res = null;
      }
      if (res && (res.kind === 'object' || res.kind === 'list' || res.kind === 'enum' || res.kind === 'nucleus' || (res.kind === 'member' && res.member.kind === 'object'))) {
        this.aliases.set(name, res);
      }
    }
  }

  /** Resolve an expression to a Nucleus API entity (no diagnostics). */
  private resolve(node: Node, useAliases = true): Resolved | undefined {
    if (node.type === 'Identifier') {
      if (useAliases && this.aliases.has(node.name)) return this.aliases.get(node.name) ?? undefined;
      if (this.shadowed.has(node.name)) return undefined;
      return resolveGlobal(node.name);
    }
    if (node.type === 'MemberExpression') {
      const base = this.resolve(node.object, useAliases);
      if (!base) return undefined;
      if (node.computed) {
        if (node.property.type === 'Literal' && typeof node.property.value === 'string') return resolveMember(base, node.property.value).resolved;
        return resolveIndex(base);
      }
      return resolveMember(base, node.property.name).resolved;
    }
    return undefined;
  }

  private chainOf(node: Node): string | undefined {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression' && !node.computed) {
      const o = this.chainOf(node.object);
      return o ? `${o}.${node.property.name}` : undefined;
    }
    return undefined;
  }

  // ---- walk ----------------------------------------------------------------

  private walk(node: Node, ctx: Ctx) {
    this.enter(node, ctx);
    const isFn = node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression';
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const v = node[key];
      const childCtx: Ctx = {
        parent: node,
        fnDepth: ctx.fnDepth + (isFn ? 1 : 0),
        inTypeof: ctx.inTypeof || (node.type === 'UnaryExpression' && node.operator === 'typeof'),
        topLevelStatement: node.type === 'Program' || (node.type === 'ExpressionStatement' && ctx.topLevelStatement),
      };
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === 'string') this.walk(c, childCtx);
      } else if (v && typeof v.type === 'string') this.walk(v, childCtx);
    }
  }

  private enter(n: Node, ctx: Ctx) {
    this.checkEs5(n, ctx);
    switch (n.type) {
      case 'Identifier':
        this.checkCallbackOnly(n, ctx);
        break;
      case 'MemberExpression':
        this.checkMember(n, ctx);
        break;
      case 'AssignmentExpression':
        this.checkAssignment(n, ctx);
        break;
      case 'CallExpression':
        this.checkCall(n);
        break;
      case 'NewExpression':
        this.checkNew(n);
        break;
    }
  }

  // ---- rules ------------------------------------------------------------------

  private report(d: Omit<Diagnostic, 'severity'> & { severity?: Severity }) {
    this.out.push({ severity: RULES[d.rule].severity, ...d });
  }

  private checkEs5(n: Node, ctx: Ctx) {
    const es = (start: number, end: number, what: string, fixes?: Fix[]) =>
      this.report({ rule: 'es5-only', message: `${what} is not supported by Nucleus (Jint ${api.jint ?? '2.x'} only understands ES5).`, start, end, fixes });
    switch (n.type) {
      case 'VariableDeclaration': {
        if (n.kind === 'var') break;
        const fix: Fix[] = [{ title: `Replace \`${n.kind}\` with \`var\``, edits: [{ start: n.start, end: n.start + n.kind.length, text: 'var' }], preferred: true }];
        const p = ctx.parent;
        const inLoopHead = (p?.type === 'ForStatement' && p.init === n) || ((p?.type === 'ForInStatement' || p?.type === 'ForOfStatement') && p.left === n);
        // Jint 2's parser accepts let/const as statements (an old Esprima extension), and
        // `for (var|let ...)`, but not `const` in a loop head.
        const statementPosition = p?.type === 'Program' || p?.type === 'BlockStatement' || p?.type === 'SwitchCase';
        if ((inLoopHead && n.kind === 'const') || (!inLoopHead && !statementPosition)) {
          es(n.start, n.start + n.kind.length, `\`${n.kind}\` here`, fix);
        } else {
          this.report({
            rule: 'let-const-semantics',
            message: `Nucleus (Jint ${api.jint ?? '2.x'}) treats \`${n.kind}\` like \`var\`: it is function-scoped, not block-scoped${n.kind === 'const' ? ', and can be reassigned' : ''}.`,
            start: n.start,
            end: n.start + n.kind.length,
            fixes: fix,
          });
        }
        break;
      }
      case 'CallExpression':
      case 'NewExpression': {
        const last = n.arguments[n.arguments.length - 1];
        if (last && /^[\s)]*,/.test(this.text.slice(last.end, n.end).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''))) {
          const comma = this.text.indexOf(',', last.end);
          es(comma, comma + 1, 'A trailing comma in an argument list', [{ title: 'Remove the trailing comma', edits: [{ start: comma, end: comma + 1, text: '' }], preferred: true }]);
        }
        break;
      }
      case 'ArrowFunctionExpression':
        es(n.start, n.body.start, 'An arrow function');
        break;
      case 'TemplateLiteral':
        if (ctx.parent?.type !== 'TaggedTemplateExpression') {
          es(n.start, n.end, 'A template string', templateFix(this.text, n));
        }
        break;
      case 'TaggedTemplateExpression':
        es(n.start, n.end, 'A tagged template');
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        es(n.start, n.start + 5, 'A class');
        break;
      case 'SpreadElement':
        es(n.start, n.end, 'Spread syntax (`...`)');
        break;
      case 'RestElement':
        es(n.start, n.end, 'A rest parameter (`...`)');
        break;
      case 'AssignmentPattern':
        es(n.start, n.end, 'A default parameter value');
        break;
      case 'ObjectPattern':
      case 'ArrayPattern':
        es(n.start, n.end, 'Destructuring');
        break;
      case 'ForOfStatement':
        es(n.start, n.start + 3, '`for...of`');
        break;
      case 'Property':
        if (n.shorthand) es(n.start, n.end, 'Shorthand property syntax');
        else if (n.method) es(n.key.start, n.key.end, 'Method shorthand syntax');
        else if (n.computed) es(n.key.start - 1, n.key.end + 1, 'A computed property name');
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
        if (n.async) es(n.start, n.start + 5, 'An async function');
        if (n.generator) es(n.start, n.start + 8, 'A generator function');
        break;
      case 'ChainExpression':
        es(n.start, n.end, 'Optional chaining (`?.`)');
        break;
      case 'LogicalExpression':
        if (n.operator === '??') es(n.left.end, n.right.start, 'The `??` operator');
        break;
      case 'BinaryExpression':
        if (n.operator === '**') es(n.left.end, n.right.start, 'The `**` operator');
        break;
      case 'AssignmentExpression':
        if (['**=', '??=', '||=', '&&='].includes(n.operator)) es(n.left.end, n.right.start, `The \`${n.operator}\` operator`);
        break;
      case 'CatchClause':
        if (!n.param) es(n.start, n.body.start, 'An optional catch binding');
        break;
      case 'Literal':
        if (typeof n.bigint === 'string') es(n.start, n.end, 'A BigInt literal');
        else if (typeof n.value === 'number' && /^0[bBoO]|_/.test(n.raw)) es(n.start, n.end, 'This number literal syntax');
        else if (n.regex && /[uysd]/.test(n.regex.flags)) es(n.start, n.end, `The regular expression flag(s) "${n.regex.flags.replace(/[gim]/g, '')}"`);
        break;
      case 'AwaitExpression':
        es(n.start, n.start + 5, '`await`');
        break;
      case 'YieldExpression':
        es(n.start, n.start + 5, '`yield`');
        break;
      case 'MetaProperty':
        es(n.start, n.end, n.meta.name + '.' + n.property.name);
        break;
    }
  }

  private isReference(n: Node, parent?: Node): boolean {
    if (!parent) return true;
    if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return false;
    if ((parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key === n && !parent.computed) return parent.shorthand;
    if (parent.type === 'VariableDeclarator' && parent.id === n) return false;
    if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression') && (parent.id === n || parent.params.includes(n))) return false;
    if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return false;
    if (parent.type === 'CatchClause' && parent.param === n) return false;
    return true;
  }

  private checkCallbackOnly(n: Node, ctx: Ctx) {
    if (ctx.fnDepth > 0 || ctx.inTypeof) return;
    if (!CALLBACK_ONLY.has(n.name) || this.shadowed.has(n.name)) return;
    if (!this.isReference(n, ctx.parent)) return;
    this.report({
      rule: 'callback-only-global',
      message: `\`${n.name}\` is only available inside callbacks such as \`Game.Play = function () { ... }\`. Using it at the top level makes the handler fail to load.`,
      start: n.start,
      end: n.end,
    });
  }

  private checkMember(n: Node, ctx: Ctx) {
    if (n.computed) {
      if (!(n.property.type === 'Literal' && typeof n.property.value === 'string')) return;
    }
    const base = this.resolve(n.object);
    if (!base) return;
    const name: string = n.computed ? n.property.value : n.property.name;
    const step = resolveMember(base, name);
    const isWrite = ctx.parent?.type === 'AssignmentExpression' && ctx.parent.left === n;
    if (step.unknown) {
      const { candidates, ownerLabel: owner } = step.unknown;
      const label = ownerLabel(owner);
      const visible = candidates.filter((c) => !(api.objects[owner]?.members[c]?.internal));
      const s = suggest(name, visible.length ? visible : candidates);
      const fixes: Fix[] | undefined = s && !n.computed ? [{ title: `Change to \`${s}\``, edits: [{ start: n.property.start, end: n.property.end, text: s }], preferred: true }] : undefined;
      const effect = isWrite ? 'Assigning it has no effect' : 'It will be undefined';
      this.report({
        rule: 'unknown-member',
        message: `\`${name}\` does not exist on \`${label}\`. ${effect}.${s ? ` Did you mean \`${s}\`?` : ''}`,
        start: n.property.start,
        end: n.property.end,
        fixes,
      });
      return;
    }
    const r = step.resolved;
    if (r?.kind === 'member' && r.member.deprecated) {
      this.report({ rule: 'deprecated', message: `\`${ownerLabel(r.owner)}.${name}\`: ${r.member.deprecated}`, start: n.property.start, end: n.property.end, tags: ['deprecated'] });
    }
  }

  private checkAssignment(n: Node, ctx: Ctx) {
    if (n.left.type !== 'MemberExpression') return;
    const r = this.resolve(n.left);
    const chain = this.chainOf(n.left);
    if (chain?.startsWith('Game.') && ctx.fnDepth === 0) {
      this.gameAssignedAnywhere.add(chain);
      if (ctx.topLevelStatement && ctx.parent?.type === 'ExpressionStatement') {
        if (!this.topAssignments.has(chain)) this.topAssignments.set(chain, []);
        this.topAssignments.get(chain)!.push(n);
      }
    }
    if (!r || r.kind !== 'member' || n.operator !== '=') return;
    const m = r.member;
    const label = `${ownerLabel(r.owner)}.${r.name}`;
    if (m.kind === 'method') {
      this.report({ rule: 'readonly-member', message: `\`${label}\` is a method; assigning it has no effect.`, start: n.left.start, end: n.left.end });
      return;
    }
    if (m.readonly || m.kind === 'object') {
      this.report({ rule: 'readonly-member', message: `\`${label}\` is read-only; assigning it has no effect.`, start: n.left.start, end: n.left.end });
      return;
    }
    if (m.type) this.checkType(label, m, n.right);
  }

  private checkType(label: string, m: Member, value: Node) {
    const expected = m.type as SimpleType;
    const actual = literalType(value);
    if (!actual || expected === 'any' || expected === 'array') return;
    const mismatch = (msg: string, fixes?: Fix[], severity?: Severity) =>
      this.report({ rule: 'type-mismatch', message: `\`${label}\` expects ${msg}`, start: value.start, end: value.end, fixes, severity });

    if (actual === 'null') return;
    if (expected.startsWith('enum:')) {
      const enumName = expected.slice(5);
      if (actual === 'number' || actual === 'boolean') return;
      const r = this.resolve(value);
      if (r?.kind === 'enumValue' && r.enumName !== enumName) mismatch(`a \`Nucleus.${enumName}\` value, not \`Nucleus.${r.enumName}\`.`);
      else if (actual === 'string') mismatch(api.enums[enumName] ? `a \`Nucleus.${enumName}\` value (e.g. \`Nucleus.${enumName}.${Object.keys(api.enums[enumName].values)[0]}\`).` : 'a number or boolean.');
      return;
    }
    switch (expected) {
      case 'boolean':
        if (actual === 'boolean') return;
        if (actual === 'string' && /^(true|false)$/i.test(String(value.value))) {
          const lit = String(value.value).toLowerCase();
          // .NET parses "True"/"False" when converting, so this works, but reads as a bug.
          return mismatch(`a boolean, not the string ${value.raw} (it works because .NET parses it, but \`${lit}\` is clearer).`, [{ title: `Replace with \`${lit}\``, edits: [{ start: value.start, end: value.end, text: lit }], preferred: true }], 'info');
        }
        if (actual !== 'expression') return mismatch(`a boolean (\`true\` or \`false\`), not ${article(actual)}.`);
        return;
      case 'number':
        if (actual === 'number') return;
        if (actual === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(String(value.value))) {
          return mismatch(`a number, not the string ${value.raw}.`, [{ title: `Replace with \`${String(value.value).trim()}\``, edits: [{ start: value.start, end: value.end, text: String(value.value).trim() }], preferred: true }]);
        }
        if (actual !== 'expression') return mismatch(`a number, not ${article(actual)}.`);
        return;
      case 'string':
        // Jint converts numbers to strings (e.g. Game.SteamID = 12345 works).
        if (actual === 'string' || actual === 'number' || actual === 'expression') return;
        return mismatch(`a string, not ${article(actual)}.`);
      case 'string[]':
      case 'number[]':
      case 'boolean[]':
        if (actual === 'array' || actual === 'expression') return;
        return mismatch(`an array (e.g. \`[${value.raw ?? '...'}]\`), not ${article(actual)}.`, [
          { title: 'Wrap the value in an array', edits: [{ start: value.start, end: value.end, text: `[${this.text.slice(value.start, value.end)}]` }], preferred: true },
        ]);
      case 'function':
        if (actual === 'function' || actual === 'expression') return;
        return mismatch(`a function, e.g. \`function () { ... }\`, not ${article(actual)}.`);
    }
  }

  private checkCall(n: Node) {
    if (n.arguments.some((a: Node) => a.type === 'SpreadElement')) return;
    const r = this.resolve(n.callee);
    if (!r || r.kind !== 'member') return;
    const m = r.member;
    const label = `${ownerLabel(r.owner)}.${r.name}`;
    if (m.kind !== 'method') {
      if (m.type && m.type !== 'function' && m.type !== 'any') {
        this.report({ rule: 'type-mismatch', message: `\`${label}\` is not a method.`, start: n.callee.start, end: n.callee.end });
      }
      return;
    }
    const count = n.arguments.length;
    const ok = (m.overloads ?? []).some((o) => {
      const required = o.params.filter((p) => !p.optional && !p.rest).length;
      const max = o.params.some((p) => p.rest) ? Infinity : o.params.length;
      return count >= required && count <= max;
    });
    if (!ok) {
      const arities = [...new Set((m.overloads ?? []).map((o) => o.params.length))].sort((a, b) => a - b);
      this.report({
        rule: 'wrong-arguments',
        message: `\`${label}\` takes ${arities.join(' or ')} argument${arities.length === 1 && arities[0] === 1 ? '' : 's'}, but ${count} ${count === 1 ? 'was' : 'were'} given. Nucleus will fail with "No public methods with the specified arguments were found".`,
        start: n.callee.property?.start ?? n.start,
        end: n.end,
      });
    }
  }

  private checkNew(n: Node) {
    const r = this.resolve(n.callee);
    if (r?.kind !== 'nucleusClass') return;
    const expected = api.nucleusClasses[r.name].params.length;
    if (n.arguments.length !== expected) {
      this.report({
        rule: 'wrong-arguments',
        message: `\`new Nucleus.${r.name}(...)\` takes ${expected} arguments (${api.nucleusClasses[r.name].params.join(', ')}), but ${n.arguments.length} ${n.arguments.length === 1 ? 'was' : 'were'} given.`,
        start: n.start,
        end: n.end,
      });
    }
  }

  private checkRequired() {
    // Only meaningful for files that actually define a handler.
    if (![...this.gameAssignedAnywhere].length) return;
    const missing = REQUIRED.filter((k) => {
      if (this.gameAssignedAnywhere.has(`Game.${k}`)) return false;
      if (k === 'ExecutableName' && (this.gameAssignedAnywhere.has('Game.ExecutableNames') || this.gameAssignedAnywhere.has('Game.ExecutableToLaunch'))) return false;
      return true;
    });
    if (!missing.length) return;
    const firstGame = [...this.topAssignments.values()][0]?.[0];
    const at = firstGame ? lineStart(this.text, firstGame.start) : 0;
    const lines = missing.map((k) => `Game.${k} = "${k === 'ExecutableName' ? 'Game.exe' : 'My Game'}";`).join('\n') + '\n';
    this.report({
      rule: 'missing-required',
      message: `Missing required option${missing.length > 1 ? 's' : ''}: ${missing.map((k) => `Game.${k}`).join(', ')}. Nucleus cannot load the handler without ${missing.length > 1 ? 'them' : 'it'}.`,
      start: at,
      end: lineEnd(this.text, at),
      fixes: [{ title: `Add ${missing.map((k) => `Game.${k}`).join(', ')}`, edits: [{ start: at, end: at, text: lines }], preferred: true }],
    });
  }

  private checkDuplicates() {
    for (const [chain, nodes] of this.topAssignments) {
      if (nodes.length < 2) continue;
      for (const n of nodes.slice(0, -1)) {
        const line = lineOf(this.text, nodes[nodes.length - 1].start) + 1;
        const stmtStart = lineStart(this.text, n.start);
        const stmtEnd = nextLineStart(this.text, n.end);
        const onlyStatementOnLine = this.text.slice(stmtStart, n.start).trim() === '' && /^\s*;?\s*(\/\/.*)?$/.test(this.text.slice(n.end, stmtEnd).replace(/\r?\n$/, ''));
        this.report({
          rule: 'duplicate-assignment',
          message: `\`${chain}\` is set again on line ${line}; this value is overwritten.`,
          start: n.left.start,
          end: n.end,
          tags: ['unnecessary'],
          fixes: onlyStatementOnLine ? [{ title: 'Remove this assignment', edits: [{ start: stmtStart, end: stmtEnd, text: '' }] }] : undefined,
        });
      }
    }
  }

  private checkHubInstall() {
    // Mirrors DownloadPrompt.ExtractHandler in Nucleus: for each line,
    // `line.ToLower().StartsWith("game.executablename")` / ("game.gamename"),
    // then the value is the text between the first and the last '"'.
    for (const key of ['ExecutableName', 'GameName'] as const) {
      const nodes = this.topAssignments.get(`Game.${key}`);
      if (!nodes?.length) continue;
      const n = nodes[nodes.length - 1];
      const ls = lineStart(this.text, n.start);
      const le = lineEnd(this.text, n.start);
      const line = this.text.slice(ls, le);
      const prefix = `game.${key.toLowerCase()}`;
      const problems: string[] = [];
      const fixes: Fix[] = [];
      if (!line.toLowerCase().startsWith(prefix)) {
        problems.push('the line must start with it (no indentation or code before it)');
        const indent = line.match(/^\s+/)?.[0];
        if (indent && n.start === ls + indent.length) fixes.push({ title: 'Remove indentation', edits: [{ start: ls, end: ls + indent.length, text: '' }], preferred: true });
      }
      const v = n.right;
      if (v.type !== 'Literal' || typeof v.value !== 'string') {
        problems.push('the value must be a plain double-quoted string');
      } else {
        if (!v.raw.startsWith('"')) {
          problems.push('the value must use double quotes');
          if (!v.value.includes('"')) fixes.push({ title: 'Use double quotes', edits: [{ start: v.start, end: v.end, text: JSON.stringify(v.value) }], preferred: true });
        } else {
          const first = line.indexOf('"');
          const last = line.lastIndexOf('"');
          const extracted = line.slice(first + 1, last);
          if (extracted !== v.value) problems.push(`no other double quotes may appear on the line (Nucleus would read \`${extracted}\`)`);
        }
      }
      if (key === 'ExecutableName') {
        // `Game.ExecutableNames` also starts with "game.executablename" and is matched first.
        const re = /^game\.executablenames/im;
        const m = re.exec(this.text);
        if (m && m.index < ls) problems.push('`Game.ExecutableNames` appears before it, and Nucleus would read that line instead');
      }
      if (problems.length) {
        this.report({
          rule: 'hub-install-parse',
          message: `When installed from the Hub, Nucleus will not read \`Game.${key}\` correctly: ${problems.join('; ')}.`,
          start: n.start,
          end: n.end,
          fixes: fixes.length ? fixes : undefined,
        });
      }
    }
  }

  private checkGuid() {
    const nodes = this.topAssignments.get('Game.GUID');
    const v = nodes?.[nodes.length - 1]?.right;
    if (!v || v.type !== 'Literal' || typeof v.value !== 'string') return;
    if (!v.value.trim()) {
      this.report({ rule: 'missing-required', message: '`Game.GUID` must not be empty.', start: v.start, end: v.end });
      return;
    }
    if (/[^A-Za-z0-9 _.\-]/.test(v.value)) {
      const clean = v.value.replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim();
      this.report({
        rule: 'guid-characters',
        message: '`Game.GUID` is used as a folder name; use only letters, digits and spaces.',
        start: v.start,
        end: v.end,
        fixes: clean ? [{ title: `Change to "${clean}"`, edits: [{ start: v.start, end: v.end, text: JSON.stringify(clean) }] }] : undefined,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// helpers

function visit(node: Node, fn: (n: Node) => void) {
  fn(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') visit(c, fn);
    } else if (v && typeof v.type === 'string') visit(v, fn);
  }
}

function describe(r: Resolved): string {
  switch (r.kind) {
    case 'object':
      return `o:${r.type}`;
    case 'list':
      return `l:${r.of}`;
    case 'enum':
      return `e:${r.name}`;
    case 'member':
      return `m:${r.owner}.${r.name}`;
    default:
      return r.kind;
  }
}

type LitType = 'string' | 'number' | 'boolean' | 'array' | 'function' | 'object' | 'null' | 'expression';
function literalType(n: Node): LitType | undefined {
  switch (n.type) {
    case 'Literal':
      if (n.value === null && !n.regex) return 'null';
      if (typeof n.value === 'string') return 'string';
      if (typeof n.value === 'number') return 'number';
      if (typeof n.value === 'boolean') return 'boolean';
      return 'expression';
    case 'TemplateLiteral':
      return 'string';
    case 'ArrayExpression':
      return 'array';
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return 'function';
    case 'ObjectExpression':
      return 'object';
    case 'UnaryExpression':
      if (n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return 'number';
      if (n.operator === '!') return 'boolean';
      return 'expression';
    default:
      return 'expression';
  }
}

const article = (t: LitType) => ({ string: 'a string', number: 'a number', boolean: 'a boolean', array: 'an array', function: 'a function', object: 'an object', null: 'null', expression: 'an expression' })[t];

function templateFix(text: string, n: Node): Fix[] | undefined {
  const parts: string[] = [];
  n.quasis.forEach((q: Node, i: number) => {
    const cooked: string | null = q.value.cooked;
    if (cooked === null) return;
    if (cooked) parts.push(JSON.stringify(cooked));
    const e = n.expressions[i];
    if (e) {
      const src = text.slice(e.start, e.end);
      parts.push(/^[\w.$\[\]"']+$/.test(src) || /^\(.*\)$/s.test(src) ? src : `(${src})`);
    }
  });
  if (!parts.length) parts.push('""');
  if (n.expressions.length && !n.quasis[0].value.cooked) parts.unshift('""');
  return [{ title: 'Convert to string concatenation', edits: [{ start: n.start, end: n.end, text: parts.join(' + ') }], preferred: true }];
}

export function lineOf(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
export function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}
export function lineEnd(text: string, offset: number): number {
  const e = text.indexOf('\n', offset);
  const end = e < 0 ? text.length : e;
  return text[end - 1] === '\r' ? end - 1 : end;
}
function nextLineStart(text: string, offset: number): number {
  const e = text.indexOf('\n', offset);
  return e < 0 ? text.length : e + 1;
}

// ---------------------------------------------------------------------------
// suppression & severity

const DIRECTIVE = /nucleus-lint-(disable-next-line|disable-line|disable|enable)\b([^\n*]*)/;

function finalize(diags: Diagnostic[], text: string, comments: acorn.Comment[], options: LintOptions): Diagnostic[] {
  const fileDisabled = new Set<string>();
  const lineDisabled = new Map<number, Set<string> | 'all'>();
  let fileAll = false;
  for (const c of comments) {
    const m = DIRECTIVE.exec(c.value);
    if (!m) continue;
    const rules = m[2].split(/[\s,]+/).filter((r) => r && !r.startsWith('--'));
    const line = lineOf(text, c.start);
    if (m[1] === 'disable') {
      if (rules.length) rules.forEach((r) => fileDisabled.add(r));
      else fileAll = true;
    } else {
      const target = m[1] === 'disable-next-line' ? lineOf(text, c.end) + 1 : line;
      lineDisabled.set(target, rules.length ? new Set(rules) : 'all');
    }
  }
  const seen = new Set<string>();
  return diags
    .filter((d) => {
      const override = options.rules?.[d.rule];
      if (override === 'off') return false;
      if (override) d.severity = override;
      if (fileAll || fileDisabled.has(d.rule)) return false;
      const l = lineDisabled.get(lineOf(text, d.start));
      if (l === 'all' || l?.has(d.rule)) return false;
      const key = `${d.rule}:${d.start}:${d.end}:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start);
}

/** Heuristic: does this JavaScript text look like a Nucleus handler? */
export function looksLikeHandler(text: string): boolean {
  return /^\s*Game\.(GUID|GameName|ExecutableName|Play|SteamID|HandlerInterval|SymlinkGame)\s*=/m.test(text);
}
