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
  'wrong-arguments': {
    severity: 'error',
    description: 'No overload of this Nucleus method takes this number of arguments. Jint throws "No public methods with the specified arguments were found", so the handler fails to load (top level) or the instance setup fails (Game.Play).',
  },
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
  'protoinput-legacy-hooks': {
    severity: 'warning',
    description: 'With Proto Input and multiple keyboards/mice, the legacy input options (Game.HookGetCursorPos, Game.SendNormalMouseInput, ...) must be set to false; several default to true and would run alongside Proto Input.',
  },
  'missing-builtin': {
    severity: 'error',
    description: 'Jint 2.x only has the ES5 standard library (plus String padStart/padEnd). Newer built-ins such as `Object.assign`, `Array.from`, `Map`, `"…".includes()` or `[].find()` do not exist and throw when the code runs.',
  },
  'callback-misuse': {
    severity: 'warning',
    description: 'Callbacks Nucleus never runs or calls without checking: `Game.SetupSse` (never called), `Game.Play` with both `GamePlayBeforeGameSetup` and `GamePlayAfterLaunch` (never runs), `Context.StartArguments` set in a `Game.Play` that runs after launch (no effect), and `Game.CustomHotkeys` entries without their `Game.OnCustomHotKey_N` (Nucleus crashes when the hotkey is pressed).',
  },
  deprecated: { severity: 'hint', description: 'The option is deprecated (setting it to false is fine).' },
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
  /**
   * Safe to apply without review ("Fix all", `nucleus lint --fix`, fix-on-save): the
   * fix keeps the handler's behaviour, or repairs code Nucleus can't load or run.
   * Fixes that change behaviour or need the author's input leave this unset.
   */
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

// Built-ins newer than ES5 that Jint 2.11.58 does not have (each one checked against the
// real engine: calling it throws "Object has no method '<name>'" or "<name> is not defined").
export const MISSING_STATIC: Record<string, string[]> = {
  Object: ['assign', 'entries', 'values', 'is', 'fromEntries'],
  Array: ['from', 'of'],
  Number: ['isInteger', 'isNaN', 'isFinite', 'parseFloat', 'parseInt', 'EPSILON'],
  Math: ['trunc', 'sign', 'log2', 'log10', 'cbrt', 'hypot'],
  String: ['fromCodePoint'],
};
export const MISSING_GLOBALS = new Set(['Map', 'Set', 'WeakMap', 'Promise', 'Symbol', 'Reflect', 'Proxy']);
// String/Array methods. The receiver's type is unknown statically, so these are warnings.
export const MISSING_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'repeat', 'find', 'findIndex', 'fill', 'flat', 'flatMap', 'trimStart', 'trimEnd', 'trimLeft', 'codePointAt', 'normalize', 'keys', 'values', 'entries']);

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
  /** Inside "use strict" code (program or function directive). */
  strict: boolean;
}

const hasUseStrict = (body: Node[] | undefined) => !!body?.some((st) => st.type === 'ExpressionStatement' && st.directive === 'use strict');

class Analyzer {
  private aliases = new Map<string, Resolved | null>();
  private parentOf = new WeakMap<Node, Node>();
  private shadowed = new Set<string>();
  /** Every variable/function/parameter name the handler declares or assigns. */
  private declared = new Set<string>();
  /** Property names the handler defines itself (`{ find: ... }`, `x.find = ...`). */
  private ownProps = new Set<string>();
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
    this.walk(this.program, { fnDepth: 0, inTypeof: false, topLevelStatement: false, strict: hasUseStrict(this.program.body) });
    this.checkRequired();
    this.checkDuplicates();
    this.checkHubInstall();
    this.checkCallbacks();
    this.checkExeName();
    this.checkProtoInputLegacy();
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
    visit(this.program, (n) => {
      if (n.type === 'Property' && !n.computed && n.key) this.ownProps.add(n.key.type === 'Identifier' ? n.key.name : String(n.key.value));
      else if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed) this.ownProps.add(n.left.property.name);
    });
    for (const name of inits.keys()) this.declared.add(name);
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
    if (ctx.parent) this.parentOf.set(node, ctx.parent);
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
        strict: ctx.strict || (isFn && node.body?.type === 'BlockStatement' && hasUseStrict(node.body.body)),
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
        this.checkMissingGlobal(n, ctx);
        break;
      case 'MemberExpression':
        this.checkMissingBuiltin(n, ctx);
        this.checkMember(n, ctx);
        break;
      case 'AssignmentExpression':
        this.checkAssignment(n, ctx);
        break;
      case 'CallExpression':
        this.checkCall(n);
        this.checkOptionCall(n);
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
        es(n.start, n.body.start, 'An arrow function', arrowFix(this.text, n));
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
        es(n.start, n.end, 'A default parameter value', defaultParamFix(this.text, n, ctx.parent));
        break;
      case 'ObjectPattern':
      case 'ArrayPattern':
        es(n.start, n.end, 'Destructuring');
        break;
      case 'ForOfStatement':
        es(n.start, n.start + 3, '`for...of`');
        break;
      case 'Property':
        if (n.shorthand) {
          const fix: Fix[] | undefined =
            ctx.parent?.type === 'ObjectExpression' && n.key.type === 'Identifier'
              ? [{ title: `Write \`${n.key.name}: ${n.key.name}\``, edits: [{ start: n.start, end: n.end, text: `${n.key.name}: ${n.key.name}` }], preferred: true }]
              : undefined;
          es(n.start, n.end, 'Shorthand property syntax', fix);
        } else if (n.method) {
          const fix: Fix[] | undefined =
            !n.computed && n.kind === 'init' && !n.value.async && !n.value.generator
              ? [{ title: 'Convert to `name: function () {...}`', edits: [{ start: n.key.end, end: n.value.start, text: ': function ' }], preferred: true }]
              : undefined;
          es(n.key.start, n.key.end, 'Method shorthand syntax', fix);
        }
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
        if (n.operator === '??') {
          const L = this.text.slice(n.left.start, n.left.end);
          const R = this.text.slice(n.right.start, n.right.end);
          const fix: Fix[] | undefined = isSimpleRef(n.left)
            ? [{ title: 'Rewrite with `!== null && !== undefined`', edits: [{ start: n.start, end: n.end, text: `(${L} !== null && ${L} !== undefined ? ${L} : ${R})` }], preferred: true }]
            : undefined;
          es(n.left.end, n.right.start, 'The `??` operator', fix);
        }
        break;
      case 'BinaryExpression':
        if (n.operator === '**') {
          const L = this.text.slice(n.left.start, n.left.end);
          const R = this.text.slice(n.right.start, n.right.end);
          es(n.left.end, n.right.start, 'The `**` operator', [{ title: 'Use `Math.pow(...)`', edits: [{ start: n.start, end: n.end, text: `Math.pow(${L}, ${R})` }], preferred: true }]);
        }
        break;
      case 'AssignmentExpression':
        if (['**=', '??=', '||=', '&&='].includes(n.operator)) es(n.left.end, n.right.start, `The \`${n.operator}\` operator`);
        break;
      case 'CatchClause':
        if (!n.param) es(n.start, n.body.start, 'An optional catch binding', [{ title: 'Add `(e)`', edits: [{ start: n.start + 5, end: n.body.start, text: ' (e) ' }], preferred: true }]);
        break;
      case 'Literal':
        // Nucleus rebuilds the file line by line ("\r\n" + line + "\r\n", GenericGameInfo's
        // constructor), so a backslash line continuation inside a string is followed by an
        // extra line break, and Jint stops with "Unexpected token ILLEGAL".
        if (typeof n.value === 'string' && /[\r\n]/.test(n.raw)) {
          const raw: string = n.raw;
          const joined = raw.replace(/\\(\r\n|[\r\n])/g, ''); // StreamReader.ReadLine doesn't split on U+2028/2029
          this.report({
            rule: 'syntax-error',
            message: 'Nucleus can\'t load a string that continues onto the next line with `\\` (it adds line breaks when it reads the file, which Jint rejects). Keep the string on one line, or join parts with `+`.',
            start: n.start,
            end: n.end,
            fixes: [{ title: 'Join the string onto one line', edits: [{ start: n.start, end: n.end, text: joined }], preferred: true }],
          });
          break;
        }
        if (typeof n.bigint === 'string') es(n.start, n.end, 'A BigInt literal');
        else if (typeof n.value === 'number' && /^0[bBoO]|_/.test(n.raw))
          es(n.start, n.end, 'This number literal syntax', [{ title: `Write it as ${String(n.value)}`, edits: [{ start: n.start, end: n.end, text: String(n.value) }], preferred: true }]);
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
    const fix = this.callbackMoveFix();
    this.report({
      rule: 'callback-only-global',
      message: `\`${n.name}\` is only available inside callbacks such as \`Game.Play = function () { ... }\`. Using it at the top level makes the handler fail to load.`,
      start: n.start,
      end: n.end,
      fixes: fix ? [fix] : undefined,
    });
  }

  private checkMissingGlobal(n: Node, ctx: Ctx) {
    if (!MISSING_GLOBALS.has(n.name) || ctx.inTypeof || this.declared.has(n.name)) return;
    if (!this.isReference(n, ctx.parent)) return;
    this.report({
      rule: 'missing-builtin',
      message: `\`${n.name}\` does not exist in Nucleus (Jint ${api.jint ?? '2.x'} has only the ES5 built-ins); using it throws "${n.name} is not defined". Use a plain object or array instead.`,
      start: n.start,
      end: n.end,
    });
  }

  private checkMissingBuiltin(n: Node, ctx: Ctx) {
    if (n.computed || n.property.type !== 'Identifier') return;
    const name: string = n.property.name;
    const engine = `Jint ${api.jint ?? '2.x'}`;
    const obj = n.object;
    if (obj.type === 'Identifier' && MISSING_STATIC[obj.name]?.includes(name) && !this.declared.has(obj.name)) {
      const fixes: Fix[] = [];
      if (obj.name === 'Number' && (name === 'parseFloat' || name === 'parseInt')) {
        fixes.push({ title: `Use the global \`${name}\``, edits: [{ start: n.start, end: n.end, text: name }], preferred: true });
      }
      const called = ctx.parent?.type === 'CallExpression' && ctx.parent.callee === n;
      this.report({
        rule: 'missing-builtin',
        severity: called ? 'error' : 'warning', // reading e.g. Number.EPSILON gives undefined, it doesn't throw
        message:
          called
            ? `\`${obj.name}.${name}\` does not exist in Nucleus (${engine} has only the ES5 built-ins); calling it throws "Object has no method '${name}'".`
            : `\`${obj.name}.${name}\` is \`undefined\` in Nucleus (${engine} has only the ES5 built-ins).`,
        start: n.start,
        end: n.end,
        fixes,
      });
      return;
    }
    const call = ctx.parent;
    if (!MISSING_METHODS.has(name) || call?.type !== 'CallExpression' || call.callee !== n) return;
    if (this.ownProps.has(name) || this.resolve(obj)) return; // the handler's own method, or a Nucleus/.NET object
    if (obj.type === 'Identifier' && (MISSING_STATIC[obj.name] || obj.name === 'Object' || obj.name === 'JSON')) return;
    const literal = (obj.type === 'Literal' && typeof obj.value === 'string') || obj.type === 'ArrayExpression';
    const fixes: Fix[] = [];
    const args = call.arguments as Node[];
    const recv = this.text.slice(obj.start, obj.end);
    if ((name === 'includes' || name === 'startsWith') && args.length === 1 && args[0].type !== 'SpreadElement') {
      const arg = this.text.slice(args[0].start, args[0].end);
      const text = `(${recv}.indexOf(${arg}) ${name === 'includes' ? '!== -1' : '=== 0'})`;
      fixes.push({ title: `Use \`indexOf\`: ${text}`, edits: [{ start: call.start, end: call.end, text }], preferred: true });
    } else if ((name === 'trimStart' || name === 'trimLeft' || name === 'trimEnd') && args.length === 0) {
      const text = `${recv}.replace(${name === 'trimEnd' ? '/\\s+$/' : '/^\\s+/'}, '')`;
      fixes.push({ title: `Use \`replace\`: ${text}`, edits: [{ start: call.start, end: call.end, text }], preferred: true });
    }
    this.report({
      rule: 'missing-builtin',
      severity: literal ? 'error' : 'warning',
      message: `\`.${name}()\` does not exist on strings or arrays in Nucleus (${engine} has only the ES5 built-ins); calling it throws "Object has no method '${name}'".`,
      start: n.property.start,
      end: call.end,
      fixes,
    });
  }

  private moveFix: Fix | null | undefined;
  /**
   * One fix that moves every top-level statement using Context/Player/... (and the
   * top-level statements that depend on them) into Game.Play, in source order.
   * Variable declarations stay at the top level (only their assignments move), so
   * other code that refers to the variables keeps working. Not offered when a
   * statement that would move configures Game.* (that must stay at the top level).
   */
  private callbackMoveFix(): Fix | null {
    if (this.moveFix !== undefined) return this.moveFix;
    this.moveFix = null;
    const body: Node[] = this.program.body;
    const text = this.text;
    const isPlay = (st: Node) =>
      st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' && this.chainOf(st.expression.left) === 'Game.Play';
    const playStmt = body.find(isPlay);
    const playFn = playStmt?.expression.right;
    if (playStmt && !(playFn?.type === 'FunctionExpression' && playFn.body.type === 'BlockStatement')) return null;

    const refsAtTop = (st: Node, names: Set<string>) => {
      let hit = false;
      const walk = (x: Node, parent?: Node) => {
        if (hit || !x || typeof x.type !== 'string') return;
        if (x.type === 'FunctionExpression' || x.type === 'FunctionDeclaration' || x.type === 'ArrowFunctionExpression') return;
        if (x.type === 'UnaryExpression' && x.operator === 'typeof') return;
        if (x.type === 'Identifier' && names.has(x.name) && this.isReference(x, parent)) {
          hit = true;
          return;
        }
        for (const k of Object.keys(x)) {
          if (k === 'type' || k === 'start' || k === 'end') continue;
          const v = x[k];
          if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, x));
          else if (v && typeof v.type === 'string') walk(v, x);
        }
      };
      walk(st);
      return hit;
    };
    const movable = (st: Node) => {
      if (st.type === 'VariableDeclaration') return st.declarations.every((d: Node) => d.id.type === 'Identifier');
      if (st.type !== 'ExpressionStatement') return false;
      // Game option assignments must stay at the top level.
      const assigns: string[] = [];
      visit(st, (x) => {
        if (x.type === 'AssignmentExpression' && x.left.type === 'MemberExpression') {
          const c = this.chainOf(x.left);
          if (c?.startsWith('Game.')) assigns.push(c);
        }
      });
      return !assigns.length;
    };

    const moved = new Set<Node>();
    const names = new Set<string>(CALLBACK_ONLY);
    for (const sh of this.shadowed) names.delete(sh);
    for (let changed = true; changed; ) {
      changed = false;
      for (const st of body) {
        if (moved.has(st) || st === playStmt || st.type === 'FunctionDeclaration') continue;
        if (!refsAtTop(st, names)) continue;
        if (!movable(st)) return null;
        moved.add(st);
        if (st.type === 'VariableDeclaration') st.declarations.forEach((d: Node) => names.add(d.id.name));
        changed = true;
      }
    }
    if (!moved.size) return null;

    const edits: TextEdit[] = [];
    const lines: string[] = [];
    for (const st of body) {
      if (!moved.has(st)) continue;
      if (st.type === 'VariableDeclaration') {
        for (const d of st.declarations) if (d.init) lines.push(`${d.id.name} = ${text.slice(d.init.start, d.init.end)};`);
        edits.push({ start: st.start, end: st.end, text: `var ${st.declarations.map((d: Node) => d.id.name).join(', ')};` });
      } else {
        const src = text.slice(st.start, st.end);
        lines.push(src.endsWith(';') ? src : `${src};`);
        const ls = lineStart(text, st.start);
        const nl = text.indexOf('\n', st.end);
        const restEmpty = /^[ \t;]*$/.test(text.slice(st.end, nl < 0 ? text.length : nl));
        const aloneOnLine = text.slice(ls, st.start).trim() === '' && restEmpty;
        edits.push(aloneOnLine ? { start: ls, end: nl < 0 ? text.length : nl + 1, text: '' } : { start: st.start, end: st.end, text: '' });
      }
    }
    const indentOf = (pos: number) => text.slice(lineStart(text, pos), pos).match(/^\s*/)![0];
    if (playFn) {
      const inner = indentOf(playStmt!.start) + '  ';
      const block = lines.map((l) => inner + l.replace(/\n/g, '\n' + inner)).join('\n');
      edits.push({ start: playFn.body.start + 1, end: playFn.body.start + 1, text: `\n${block}` });
    } else {
      const block = lines.map((l) => '  ' + l.replace(/\n/g, '\n  ')).join('\n');
      edits.push({ start: text.length, end: text.length, text: `${text.endsWith('\n') ? '' : '\n'}\nGame.Play = function () {\n${block}\n};\n` });
    }
    this.moveFix = { title: playFn ? 'Move the code that uses it into Game.Play' : 'Move the code that uses it into a new Game.Play', edits, preferred: true };
    return this.moveFix;
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
      const isWriteTarget = ctx.parent?.type === 'AssignmentExpression' && ctx.parent.left === n;
      const visible = candidates.filter((c) => {
        const cm = api.objects[owner]?.members[c];
        if (cm?.internal) return false;
        // Only suggest something that can actually be assigned.
        return !isWriteTarget || !cm || (!cm.readonly && cm.kind !== 'method' && cm.kind !== 'object');
      });
      const s = suggest(name, visible.length ? visible : candidates);
      // `preferred` marks fixes safe for "Fix all". A suggestion that only differs in digits
      // (ProtoController5 -> ProtoController1) is a different member, not a typo.
      const digitsOnly = !!s && s.replace(/\d+/g, '#') === name.replace(/\d+/g, '#');
      const fixes: Fix[] | undefined = s && !n.computed ? [{ title: `Change to \`${s}\``, edits: [{ start: n.property.start, end: n.property.end, text: s }], preferred: !digitsOnly }] : undefined;
      if (isWrite && ctx.strict) {
        // Verified with Jint 2.11.58: in strict code the write throws a TypeError.
        this.report({
          rule: 'unknown-member',
          severity: 'error',
          message: `\`${name}\` does not exist on \`${label}\`. In "use strict" code Jint throws on this write, so the handler fails to load (or the instance fails, inside a callback).${s ? ` Did you mean \`${s}\`?` : ''}`,
          start: n.property.start,
          end: n.property.end,
          fixes,
        });
        return;
      }
      // `var args = (Context.Args = "...")` is an idiom from older handlers (and the official
      // guide): the property write is dropped, but the value still reaches the variable.
      const assign = ctx.parent;
      const valueUsed = isWrite && assign && this.parentOf.get(assign)?.type === 'VariableDeclarator';
      if (valueUsed) {
        this.report({
          rule: 'unknown-member',
          severity: 'hint',
          message: `\`${label}.${name}\` is not a Nucleus property, so only the variable receives this value. That is harmless, but \`var x = ...\` alone does the same.`,
          start: n.property.start,
          end: n.property.end,
          tags: ['unnecessary'],
        });
        return;
      }
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
    const setFalse = isWrite && ctx.parent!.right.type === 'Literal' && ctx.parent!.right.value === false;
    if (r?.kind === 'member' && r.member.deprecated && !setFalse) {
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
      if (actual === 'boolean') return this.checkBoolToEnum(label, enumName, value);
      if (actual === 'number') return;
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
        // Verified with Jint 2.11.58: "Value of object[] type is expected" is thrown, so the
        // handler fails to load (or the instance fails, inside Game.Play).
        return mismatch(
          `an array (e.g. \`[${value.raw ?? '...'}]\`), not ${article(actual)}. Jint cannot convert it and throws, so Nucleus fails to load the handler.`,
          [{ title: 'Wrap the value in an array', edits: [{ start: value.start, end: value.end, text: `[${this.text.slice(value.start, value.end)}]` }], preferred: true }],
          'error',
        );
      case 'function':
        if (actual === 'function' || actual === 'expression') return;
        return mismatch(`a function, e.g. \`function () { ... }\`, not ${article(actual)}.`);
    }
  }

  /**
   * Jint converts `true` to 1 and `false` to 0 for enum fields (verified with Jint 2.11.58).
   * Fine for enums like Nucleus.SetWindowPosHook (True = 1), but Nucleus.DPIHandling has
   * True = 0, so `Game.DPIHandling = true` selects Scaled.
   */
  private checkBoolToEnum(label: string, enumName: string, value: Node) {
    const e = api.enums[enumName];
    if (!e) return;
    const b: boolean = value.value;
    const num = b ? 1 : 0;
    const names = Object.keys(e.values);
    const actualKey = names.find((k) => e.values[k] === num);
    const meantKey = names.find((k) => k.toLowerCase() === String(b));
    if (actualKey && actualKey === meantKey) return; // e.g. SetWindowPosHook: true -> True
    if (!actualKey && !b) return; // false -> 0 with no member: "off"
    const fixes: Fix[] = [];
    // Neither fix is applied by "Fix all": both change behaviour, and only the author knows which was meant.
    if (meantKey) fixes.push({ title: `Use Nucleus.${enumName}.${meantKey} (what \`${b}\` suggests)`, edits: [{ start: value.start, end: value.end, text: `Nucleus.${enumName}.${meantKey}` }] });
    if (actualKey) fixes.push({ title: `Use Nucleus.${enumName}.${actualKey} (keeps the current behaviour)`, edits: [{ start: value.start, end: value.end, text: `Nucleus.${enumName}.${actualKey}` }] });
    this.report({
      rule: 'type-mismatch',
      message: `\`${label} = ${b}\` converts to ${num}, which is ${actualKey ? `\`Nucleus.${enumName}.${actualKey}\`` : 'not a defined value'}${meantKey && meantKey !== actualKey ? `, not \`Nucleus.${enumName}.${meantKey}\`` : ''}. Use the enum value you mean.`,
      start: value.start,
      end: value.end,
      fixes,
    });
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
        message: `\`${label}\` takes ${arities.join(' or ')} argument${arities.length === 1 && arities[0] === 1 ? '' : 's'}, but ${count} ${count === 1 ? 'was' : 'were'} given. Jint throws "No public methods with the specified arguments were found".`,
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
    // ExecutableName is needed even with ExecutableNames/ExecutableToLaunch: GameManager.AnyGame
    // (Search disks) reads it without a null check. ExecutableNames alone lets the game be added,
    // so that case is only a warning.
    const missing = REQUIRED.filter((k) => !this.gameAssignedAnywhere.has(`Game.${k}`));
    if (!missing.length) return;
    const names = this.topAssignments.get('Game.ExecutableNames');
    const first = names?.[names.length - 1]?.right?.elements?.[0];
    if (missing.length === 1 && missing[0] === 'ExecutableName' && first?.type === 'Literal' && typeof first.value === 'string') {
      const at = lineStart(this.text, names![names!.length - 1].start);
      this.report({
        rule: 'missing-required',
        // Adding the game by its .exe checks ExecutableNames, but GameManager.AnyGame doesn't.
        severity: 'warning',
        message: 'Also set `Game.ExecutableName`: Nucleus\' "Search disks" reads it without checking, so while this handler is installed, searching disks stops with an error for every game.',
        start: names![names!.length - 1].start,
        end: names![names!.length - 1].end,
        fixes: [{ title: `Add Game.ExecutableName = ${JSON.stringify(first.value)}`, edits: [{ start: at, end: at, text: `Game.ExecutableName = ${JSON.stringify(first.value)};\n` }], preferred: true }],
      });
      return;
    }
    const firstGame = [...this.topAssignments.values()][0]?.[0];
    const at = firstGame ? lineStart(this.text, firstGame.start) : 0;
    const lines = missing.map((k) => `Game.${k} = "${k === 'ExecutableName' ? 'Game.exe' : 'My Game'}";`).join('\n') + '\n';
    this.report({
      rule: 'missing-required',
      message: `Missing required option${missing.length > 1 ? 's' : ''}: ${missing.map((k) => `Game.${k}`).join(', ')}. Nucleus cannot load the handler without ${missing.length > 1 ? 'them' : 'it'}.`,
      start: at,
      end: lineEnd(this.text, at),
      // Not part of "Fix all": it inserts placeholder values only the author can fill in.
      fixes: [{ title: `Add ${missing.map((k) => `Game.${k}`).join(', ')}`, edits: [{ start: at, end: at, text: lines }] }],
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
          // Safe to remove automatically when nothing reads the option in between.
          fixes: onlyStatementOnLine
            ? [{ title: 'Remove this assignment', edits: [{ start: stmtStart, end: stmtEnd, text: '' }], preferred: !this.text.slice(n.end, nodes[nodes.length - 1].start).includes(chain) }]
            : undefined,
        });
      }
    }
  }

  /**
   * Replays DownloadPrompt.ExtractHandler (and the in-app Hub browser and drag & drop, which
   * do the same) on the raw text: every physical line, comments and function bodies included;
   * `line.ToLower().StartsWith("game.executablename")` else ("game.gamename"); the value is
   * `line.Substring(first '"' + 1, last - first - 1)`, which throws with fewer than two '"';
   * each match overwrites the previous one; it stops after two matches.
   */
  private hubScan() {
    const result: Record<'ExecutableName' | 'GameName', { value: string | null; line: number; offset: number; crash: boolean } | undefined> & { matched: number[] } = {
      ExecutableName: undefined,
      GameName: undefined,
      matched: [],
    };
    let found = 0;
    let offset = 0;
    const lines = this.text.split(/\r\n|\n|\r/);
    const ends = this.text.match(/\r\n|\n|\r/g) ?? [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      const key = lower.startsWith('game.executablename') ? 'ExecutableName' : lower.startsWith('game.gamename') ? 'GameName' : null;
      if (key) {
        const first = line.indexOf('"');
        const last = line.lastIndexOf('"');
        const crash = first < 0 || last === first;
        result[key] = { value: crash ? null : line.slice(first + 1, last), line: i, offset, crash };
        result.matched.push(i + 1);
        found++;
        if (crash || found === 2) break; // a crash ends the install
      }
      offset += line.length + (ends[i]?.length ?? 0);
    }
    return result;
  }

  private checkHubInstall() {
    // See hubScan(): what Nucleus reads when installing from the Hub.
    const scan = this.hubScan();
    const reported = new Set<string>();
    const crashed = (['ExecutableName', 'GameName'] as const).find((k) => scan[k]?.crash);
    // When the crashing line is the assignment itself, its own report below (with its fix) says so.
    const crashNodes = crashed ? this.topAssignments.get(`Game.${crashed}`) : undefined;
    const crashNode = crashNodes?.[crashNodes.length - 1];
    const crashOnAssignment = !!crashNode && lineStart(this.text, crashNode.start) === scan[crashed!]!.offset;
    if (crashed && !crashOnAssignment) {
      const c = scan[crashed]!;
      const le = lineEnd(this.text, c.offset);
      this.report({
        rule: 'hub-install-parse',
        severity: 'error',
        message: `Installing this handler from the Hub fails ("Something went wrong"): this line starts with \`Game.${crashed}\`, so Nucleus reads its value from between the first and last double quote, and there aren't two. Put the value in double quotes${crashed === 'GameName' ? '' : ', or move this line below the real `Game.ExecutableName` line'}.`,
        start: c.offset,
        end: le,
      });
      reported.add(crashed);
    } else if (!crashed && this.gameAssignedAnywhere.size && !scan.ExecutableName) {
      this.report({
        rule: 'hub-install-parse',
        severity: 'error',
        message:
          scan.matched.length === 2
            ? `Installing this handler from the Hub fails: Nucleus stops after the first two lines that start with \`Game.GameName\` or \`Game.ExecutableName\` (lines ${scan.matched.join(' and ')}, comments included) and never reads \`Game.ExecutableName\`. Remove the extra line.`
            : 'Installing this handler from the Hub fails: Nucleus looks for a line that starts with `Game.ExecutableName` (no indentation) and finds none.',
        start: 0,
        end: lineEnd(this.text, 0),
      });
      reported.add('ExecutableName');
    }
    for (const key of ['ExecutableName', 'GameName'] as const) {
      if (reported.has(key)) continue;
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
          if (extracted !== v.value) {
            problems.push(`no other double quotes may appear on the line (Nucleus would read \`${extracted}\`)`);
            // Usually a trailing comment: move it to its own line above.
            const after = this.text.slice(n.end, le);
            const ci = after.indexOf('//');
            if (ci >= 0 && /^[\s;]*$/.test(after.slice(0, ci))) {
              const cStart = n.end + ci;
              let trimStart = cStart;
              while (trimStart > n.end && /[ \t]/.test(this.text[trimStart - 1])) trimStart--;
              fixes.push({
                title: 'Move the comment to the line above',
                edits: [
                  { start: ls, end: ls, text: `${this.text.slice(cStart, le)}\n` },
                  { start: trimStart, end: le, text: '' },
                ],
                preferred: true,
              });
            }
          }
        }
      }
      if (key === 'ExecutableName') {
        // `Game.ExecutableNames` also starts with "game.executablename" and is matched first.
        const re = /^game\.executablenames/im;
        const m = re.exec(this.text);
        if (m && m.index < ls) problems.push('`Game.ExecutableNames` appears before it, and Nucleus would read that line instead');
      }
      if (problems.length) {
        const fails = crashOnAssignment && key === crashed;
        this.report({
          rule: 'hub-install-parse',
          ...(fails ? { severity: 'error' as const } : {}),
          message: fails
            ? `Installing this handler from the Hub fails ("Something went wrong"): Nucleus reads \`Game.${key}\` from between the first and last double quote on this line, and there aren't two. ${problems.join('; ').replace(/^./, (c) => c.toUpperCase())}.`
            : `When installed from the Hub, Nucleus will not read \`Game.${key}\` correctly: ${problems.join('; ')}.`,
          start: n.start,
          end: n.end,
          fixes: fixes.length ? fixes : undefined,
        });
        continue;
      }
      // The line itself is fine, but Nucleus may read a different one (an earlier commented-out
      // or duplicate line, or it stopped after two matches before reaching this one).
      const got = scan[key];
      if (crashed) continue; // the install already failed above
      if (v.type === 'Literal' && typeof v.value === 'string' && got?.value !== v.value) {
        const where = got ? `line ${got.line + 1}, which gives \`${got.value}\`` : 'no line: it stops after the first two lines that start with `Game.ExecutableName` or `Game.GameName`';
        this.report({
          rule: 'hub-install-parse',
          message: `When installed from the Hub, Nucleus reads \`Game.${key}\` from ${where}, not from this line. ${key === 'GameName' ? 'The installed handler gets the wrong name.' : 'Nucleus may not find the game.'} Remove or move the other line(s).`,
          start: n.start,
          end: n.end,
        });
      }
    }
  }

  /** Game.AddOption / Game.ShowOptionAsStep, checked against GameOption and the options screen. */
  private optionKeys = new Set<string>();
  private checkOptionCall(n: Node) {
    const r = this.resolve(n.callee);
    if (r?.kind !== 'member' || r.owner !== 'Game' || n.arguments.some((a: Node) => a.type === 'SpreadElement')) return;
    const key = n.arguments[r.name === 'AddOption' ? 2 : 0];
    const keyText = key?.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
    if (r.name === 'AddOption') {
      const value = n.arguments[3];
      if (value && ((value.type === 'Literal' && !value.regex) || value.type === 'ObjectExpression')) {
        this.report({
          rule: 'type-mismatch',
          severity: 'error',
          message: 'The values of `Game.AddOption` must be a list, e.g. `["Low", "High"]` (or `[]` for free text, or a `Nucleus.*` enum value). With anything else, Nucleus\' options screen fails when it shows this option.',
          start: value.start,
          end: value.end,
        });
      }
      if (keyText !== undefined) {
        if (this.optionKeys.has(keyText)) {
          this.report({
            rule: 'duplicate-assignment',
            severity: 'error',
            message: `An option with the key \`${keyText}\` was already added. Option keys must be unique: Nucleus fails when it builds the game profile.`,
            start: key.start,
            end: key.end,
          });
        }
        this.optionKeys.add(keyText);
      }
    } else if (r.name === 'ShowOptionAsStep' && keyText !== undefined && !this.optionKeys.has(keyText)) {
      this.report({
        rule: 'wrong-arguments',
        message: `No option with the key \`${keyText}\` was added before this line. Call \`Game.AddOption(..., "${keyText}", ...)\` first: otherwise Nucleus throws and the handler fails to load.`,
        start: key.start,
        end: key.end,
      });
    }
  }

  /** Callbacks Nucleus never runs, or runs without checking they exist (GenericGameHandler, HotkeyListener). */
  private checkCallbacks() {
    const last = (chain: string) => {
      const nodes = this.topAssignments.get(chain);
      return nodes?.[nodes.length - 1];
    };
    const isTrue = (n: Node | undefined) => n?.right?.type === 'Literal' && n.right.value === true;
    const sse = last('Game.SetupSse');
    if (sse) {
      this.report({ rule: 'callback-misuse', message: '`Game.SetupSse` is never called by Nucleus, so this function never runs.', start: sse.left.start, end: sse.left.end, tags: ['unnecessary'] });
    }
    const before = last('Game.GamePlayBeforeGameSetup');
    const after = last('Game.GamePlayAfterLaunch');
    if (isTrue(before) && isTrue(after)) {
      const later = before!.start > after!.start ? before! : after!;
      this.report({ rule: 'callback-misuse', message: 'With both `Game.GamePlayBeforeGameSetup` and `Game.GamePlayAfterLaunch` set to true, Nucleus never runs `Game.Play`. Keep only one.', start: later.start, end: later.end });
    } else if (isTrue(after)) {
      const play = last('Game.Play')?.right;
      if (play?.type === 'FunctionExpression') {
        visit(play, (x) => {
          if (x.type !== 'AssignmentExpression' || x.left.type !== 'MemberExpression') return;
          const r = this.resolve(x.left);
          if (r?.kind === 'member' && r.owner === 'Context' && r.name === 'StartArguments') {
            this.report({ rule: 'callback-misuse', message: 'With `Game.GamePlayAfterLaunch = true`, `Game.Play` runs after the game has started, so setting `Context.StartArguments` here has no effect. Set the arguments with `Game.StartArguments`, or remove `Game.GamePlayAfterLaunch`.', start: x.start, end: x.end });
          }
        });
      }
    }
    const hotkeys = last('Game.CustomHotkeys')?.right;
    if (hotkeys?.type === 'ArrayExpression') {
      hotkeys.elements.slice(0, 3).forEach((el: Node | null, i: number) => {
        if (!el || this.gameAssignedAnywhere.has(`Game.OnCustomHotKey_${i + 1}`)) return;
        this.report({
          rule: 'callback-misuse',
          severity: 'error',
          message: `Custom hotkey ${i + 1} has no \`Game.OnCustomHotKey_${i + 1}\` function. Nucleus calls it without checking, so pressing the hotkey crashes Nucleus.`,
          start: el.start,
          end: el.end,
        });
      });
    }
  }

  /** Nucleus compares Game.ExecutableName(s) with the file name of the exe the user picks. */
  private checkExeName() {
    for (const chain of ['Game.ExecutableName', 'Game.ExecutableNames']) {
      const nodes = this.topAssignments.get(chain);
      const v = nodes?.[nodes.length - 1]?.right;
      const values: Node[] = v?.type === 'ArrayExpression' ? v.elements.filter(Boolean) : v ? [v] : [];
      for (const e of values) {
        if (e.type !== 'Literal' || typeof e.value !== 'string' || !/[\\/]/.test(e.value)) continue;
        const file = e.value.split(/[\\/]/).pop()!;
        this.report({
          rule: 'type-mismatch',
          severity: 'error',
          message: `\`${chain}\` must be the file name only (\`${file}\`): Nucleus compares it with the file name of the game's .exe, so a path never matches and the game can't be added. Use \`Game.BinariesFolder\` for the folder.`,
          start: e.start,
          end: e.end,
          fixes: file ? [{ title: `Use ${JSON.stringify(file)}`, edits: [{ start: e.start, end: e.end, text: JSON.stringify(file) }] }] : undefined,
        });
      }
    }
  }

  private checkProtoInputLegacy() {
    const proto = [...this.topAssignments.entries()].find(([k]) => k.startsWith('Game.ProtoInput.'));
    if (!proto) return;
    const game = api.objects.Game.members;
    const valueOf = (k: string) => {
      const nodes = this.topAssignments.get(`Game.${k}`);
      const v = nodes?.[nodes.length - 1]?.right;
      return v?.type === 'Literal' ? v.value : v ? 'expr' : undefined;
    };
    // Nucleus only applies the legacy hooks for multi keyboard/mouse sessions
    // (DllsInjector: SupportsMultipleKeyboardsAndMice && HookGetCursorPos, RawInputProcessor).
    if (valueOf('SupportsMultipleKeyboardsAndMice') !== true) return;
    const missing: string[] = [];
    const enabled: string[] = [];
    for (const [k, m] of Object.entries(game)) {
      if (!m.protoInputLegacy) continue;
      const v = valueOf(k);
      if (v === undefined && m.default === 'true') missing.push(k);
      else if (v === true) enabled.push(k);
    }
    if (!missing.length && !enabled.length) return;
    const at = lineStart(this.text, proto[1][0].start);
    const parts = [
      missing.length ? `${missing.map((k) => `Game.${k}`).join(', ')} default${missing.length === 1 ? 's' : ''} to true` : '',
      enabled.length ? `${enabled.map((k) => `Game.${k}`).join(', ')} ${enabled.length === 1 ? 'is' : 'are'} set to true` : '',
    ].filter(Boolean);
    this.report({
      rule: 'protoinput-legacy-hooks',
      message: `This handler uses Proto Input, but ${parts.join(' and ')}. The Proto Input guide says to set the legacy input options to false so they don't run alongside it.`,
      start: proto[1][0].start,
      end: proto[1][0].end,
      fixes: missing.length
        ? [{ title: 'Turn off the legacy input options', edits: [{ start: at, end: at, text: `// Legacy input options: off when using Proto Input\n${missing.map((k) => `Game.${k} = false;`).join('\n')}\n` }] }]
        : undefined,
    });
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

/** True for `a`, `a.b`, `a.b.c`: safe to evaluate more than once. */
function isSimpleRef(n: Node): boolean {
  if (n.type === 'Identifier') return true;
  return n.type === 'MemberExpression' && !n.computed && isSimpleRef(n.object);
}

/** Does code use `this` or `arguments` outside nested (non-arrow) functions? */
function usesThisOrArguments(n: Node): boolean {
  let hit = false;
  const walk = (x: Node) => {
    if (hit || !x || typeof x.type !== 'string') return;
    if (x.type === 'FunctionExpression' || x.type === 'FunctionDeclaration') return;
    if (x.type === 'ThisExpression' || x.type === 'Super' || (x.type === 'Identifier' && x.name === 'arguments') || x.type === 'MetaProperty') {
      hit = true;
      return;
    }
    for (const k of Object.keys(x)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = x[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  };
  walk(n);
  return hit;
}

function arrowFix(text: string, n: Node): Fix[] | undefined {
  if (n.async || usesThisOrArguments(n.body)) return undefined;
  const params = n.params.length ? text.slice(n.params[0].start, n.params[n.params.length - 1].end) : '';
  let end = n.end;
  let bodyText: string;
  if (n.body.type === 'BlockStatement') {
    bodyText = text.slice(n.body.start, n.body.end);
  } else {
    // `() => (expr)`: acorn drops the parentheses from the body's range.
    const before = text.slice(0, n.body.start);
    const open = before.lastIndexOf('=>');
    let bs = n.body.start;
    let be = n.body.end;
    let depth = 0;
    for (let i = open + 2; i < n.body.start; i++) if (text[i] === '(') depth++;
    while (depth > 0) {
      const close = text.indexOf(')', be);
      if (close < 0) return undefined;
      be = close + 1;
      depth--;
    }
    if (be > n.body.end) bs = text.indexOf('(', open + 2); // include the opening parenthesis too
    if (be > end) end = be;
    bodyText = `{ return ${text.slice(bs, be)}; }`;
  }
  return [{ title: 'Convert to `function () {...}`', edits: [{ start: n.start, end, text: `function (${params}) ${bodyText}` }], preferred: true }];
}

function defaultParamFix(text: string, n: Node, fn?: Node): Fix[] | undefined {
  if (!fn || !(fn.type === 'FunctionExpression' || fn.type === 'FunctionDeclaration') || !fn.params.includes(n)) return undefined;
  if (n.left.type !== 'Identifier' || fn.body.type !== 'BlockStatement') return undefined;
  const name = n.left.name;
  const ls = text.lastIndexOf('\n', fn.body.start - 1) + 1;
  const indent = (text.slice(ls, fn.body.start).match(/^\s*/)?.[0] ?? '') + '  ';
  return [
    {
      title: `Set the default inside the function`,
      edits: [
        { start: n.start, end: n.end, text: name },
        { start: fn.body.start + 1, end: fn.body.start + 1, text: `\n${indent}if (${name} === undefined) { ${name} = ${text.slice(n.right.start, n.right.end)}; }` },
      ],
      preferred: true,
    },
  ];
}

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
