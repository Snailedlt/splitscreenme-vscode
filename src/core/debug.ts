// The handler debugger's engine: runs a handler the way "Try it" does (core/sim.ts) and records a
// trace of every statement it executes, with the variables visible there, which player and phase
// (top of the file, Game.Play for player N of M, OnFinishedSetup, OnStop, Proto Input callbacks)
// was running, the call stack and the calls made so far. A debugger UI then "steps" through the
// recorded trace (forwards and backwards) instead of pausing a live run: JavaScript can't pause
// synchronously, and a trace is deterministic.
//
// How: before running, the source gets a hook call before each statement
// (`__dbg.s(<id>, function () { return [a, b]; })`, the getter reads the locals in place) and a
// `__dbg.e(<id>); try { … } finally { __dbg.x(); }` around each function body for the call stack.
// The hooks only read: no getter of the handler's own objects is run, nothing is written, and the
// simulation's result is the same with and without them (src/test/debug.test.ts checks this).
//
// Like simulate(), this runs the handler's code: in Node use traceIsolated() from src/sandbox.ts.
// Pure: no Node or DOM APIs (the browser workbench runs it in its worker).
import * as acorn from 'acorn';
import { simulate, dotnetLabels } from './sim';
import type { SimOptions, SimResult, SimPhase, SimEnv, SimHooks } from './sim';
import { parseLikeJint } from './jsparse';

export type Phase = SimPhase;

/** A value as the debugger shows it. `value` is the raw value for primitives (used by conditions). */
export interface ValueView {
  /** string, number, boolean, null, undefined, function, array, object, .NET, getter */
  type: string;
  /** Short display text, e.g. `"-windowed"`, `[1, 2, 3]`, `Context` */
  text: string;
  value?: string | number | boolean | null;
  /** Arrays and strings */
  length?: number;
  /** Members/elements, one level deep (bounded) */
  children?: Record<string, ValueView>;
  /** Some members/elements were left out */
  more?: number;
}

export interface Frame {
  /** "Game.Play", "helper", "top of the file" */
  name: string;
  /** Where this frame is now (the current line for the innermost frame, the calling line for the others) */
  line: number;
}

export interface Step {
  /** 1-based line and column of the statement about to run */
  line: number;
  column: number;
  phase: Phase;
  /** Handler functions active (0: top of the file) */
  depth: number;
  /** Innermost first */
  stack: Frame[];
  /** Variables of the current function (params, var/let/const, inner functions, catch variables) */
  locals: Record<string, ValueView>;
  /** Top-level variables and functions, plus globals the handler created without `var` */
  globals: Record<string, ValueView>;
  /** Key Context fields (only while Nucleus has set a Context: Game.Play and later) */
  context?: Record<string, ValueView>;
  player?: Record<string, ValueView>;
  /** Game options set to something other than Nucleus' default, by path ("Game.SymlinkGame") */
  options: Record<string, ValueView>;
  /** How many entries of Trace.calls happened before this step */
  effects: number;
  /** Set on the extra step recorded where an uncaught error ended the phase (same place as the step before) */
  error?: string;
}

export interface TraceCall {
  /** Index of the step during which it happened (-1: before the first) */
  step: number;
  /** e.g. `Context.ModifySaveFile("a.ini", …)` */
  call: string;
  /** Plain language for the calls that change something ("Changes a.ini: Fullscreen = 0"), as Try it shows */
  effect?: string;
}

export interface Trace {
  steps: Step[];
  /** Every call the handler made to Nucleus/.NET, in order */
  calls: TraceCall[];
  /** Not every statement is recorded: more than maxSteps ran in all, or more than maxStepsPerPhase in a
   *  phase (then only its first ones are; later phases are still recorded). The run itself went on unchanged. */
  truncated: boolean;
  /** The phases that weren't recorded to the end, e.g. "for player 1 of 4, in Game.Play" */
  truncatedPhases: string[];
  maxSteps: number;
  /** The handler didn't load, didn't finish, or couldn't be instrumented */
  error?: string;
  /** The same result as simulate() gives for this handler */
  result: SimResult;
}

export interface TraceOptions extends SimOptions {
  /** Statements recorded in all (default 20000) */
  maxSteps?: number;
  /** Statements recorded per phase (top of the file, each player's Game.Play, each callback; default 5000),
   *  so a long loop for player 1 still leaves player 2 to look at */
  maxStepsPerPhase?: number;
}

export const DEFAULT_MAX_STEPS = 20000;
export const DEFAULT_MAX_STEPS_PER_PHASE = 5000;

// ---------------------------------------------------------------------------------------------
// Instrumentation

interface StmtMeta {
  line: number;
  column: number;
  names: string[];
}
interface FnMeta {
  name: string;
  line: number;
}
export interface Instrumented {
  code: string;
  stmts: StmtMeta[];
  fns: FnMeta[];
  globals: string[];
}

const isFn = (n: any) => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression');

/** Names declared in a function (or the program) itself: params, var/let/const, function declarations. */
function scopeNames(fn: any): string[] {
  const names = new Set<string>();
  for (const p of fn.params ?? []) if (p.type === 'Identifier') names.add(p.name);
  const visit = (n: any) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') names.add(n.id.name);
    if (n.type === 'FunctionDeclaration') {
      if (n.id) names.add(n.id.name);
      return;
    }
    if (n.type === 'FunctionExpression') return;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  for (const st of fn.type === 'Program' ? fn.body : fn.body.body) visit(st);
  names.delete('arguments');
  return [...names];
}

const steppable = (st: any) => !(st.type === 'FunctionDeclaration' || st.type === 'EmptyStatement' || st.type === 'BlockStatement' || (st.type === 'ExpressionStatement' && st.directive !== undefined));

/** The source with debugger hooks, or null when it can't be parsed (the run then goes on without them). */
export function instrument(src: string): Instrumented | null {
  const opts: acorn.Options = { ecmaVersion: 2020, allowReturnOutsideFunction: true, locations: true };
  let program: any;
  let text: string;
  try {
    ({ program, text } = parseLikeJint(src, opts));
  } catch {
    return null;
  }
  // rank orders insertions at the same offset: closing braces, then function-body ends, then
  // function-body starts, then statement hooks.
  const ins: { at: number; rank: number; seq: number; text: string }[] = [];
  const add = (at: number, rank: number, t: string) => ins.push({ at, rank, seq: ins.length, text: t });
  const stmts: StmtMeta[] = [];
  const fns: FnMeta[] = [];
  interface Ctx {
    names: string[];
    catches: string[];
  }
  const hook = (st: any, ctx: Ctx) => {
    const names = [...new Set([...ctx.names, ...ctx.catches])];
    const id = stmts.push({ line: st.loc.start.line, column: st.loc.start.column + 1, names }) - 1;
    return `__dbg.s(${id}${names.length ? `, function () { return [${names.join(', ')}]; }` : ''});`;
  };
  const list = (body: any[], ctx: Ctx) => {
    for (const st of body) {
      if (steppable(st)) add(st.start, 3, hook(st, ctx));
      visit(st, ctx);
    }
  };
  // A statement standing alone (the body of an if, a loop, with): wrapped in braces with its hook.
  const single = (st: any, ctx: Ctx) => {
    if (st && steppable(st)) {
      add(st.start, 3, `{ ${hook(st, ctx)} `);
      add(st.end, 0, ' }');
    }
    visit(st, ctx);
  };
  const fn = (n: any, hint: string | undefined) => {
    const id = fns.push({ name: n.id?.name ?? hint ?? 'anonymous function', line: n.loc.start.line }) - 1;
    const body = n.body.body as any[];
    let k = 0;
    while (k < body.length && body[k].type === 'ExpressionStatement' && body[k].directive !== undefined) k++;
    if (k === body.length) return; // nothing to stop at (and `{}` has no room between its braces)
    add(k ? body[k - 1].end : n.body.start + 1, 2, ` __dbg.e(${id}); try {`);
    add(n.body.end - 1, 1, ' } finally { __dbg.x(); } ');
    list(body.slice(k), { names: scopeNames(n), catches: [] });
  };
  const nameOf = (n: any): string | undefined =>
    n.type === 'Identifier' ? n.name : n.type === 'MemberExpression' && !n.computed ? (nameOf(n.object) ? `${nameOf(n.object)}.${n.property.name}` : n.property.name) : n.type === 'Literal' ? String(n.value) : undefined;
  function visit(n: any, ctx: Ctx, hint?: string): void {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
        return fn(n, hint);
      case 'BlockStatement':
        return list(n.body, ctx);
      case 'IfStatement':
        visit(n.test, ctx);
        single(n.consequent, ctx);
        if (n.alternate) single(n.alternate, ctx);
        return;
      case 'ForStatement':
        visit(n.init, ctx);
        visit(n.test, ctx);
        visit(n.update, ctx);
        return single(n.body, ctx);
      case 'ForInStatement':
      case 'ForOfStatement':
        visit(n.left, ctx);
        visit(n.right, ctx);
        return single(n.body, ctx);
      case 'WhileStatement':
      case 'DoWhileStatement':
        visit(n.test, ctx);
        return single(n.body, ctx);
      case 'WithStatement':
        visit(n.object, ctx);
        return single(n.body, ctx);
      case 'SwitchStatement':
        visit(n.discriminant, ctx);
        for (const c of n.cases) {
          visit(c.test, ctx);
          list(c.consequent, ctx);
        }
        return;
      case 'TryStatement':
        visit(n.block, ctx);
        if (n.handler) {
          const p = n.handler.param;
          visit(n.handler.body, p?.type === 'Identifier' ? { ...ctx, catches: [...ctx.catches, p.name] } : ctx);
        }
        visit(n.finalizer, ctx);
        return;
      case 'LabeledStatement':
        // Never wrapped: `continue label` needs the loop right after the label.
        return visit(n.body, ctx);
      case 'AssignmentExpression':
        visit(n.left, ctx);
        return visit(n.right, ctx, nameOf(n.left));
      case 'VariableDeclarator':
        return visit(n.init, ctx, n.id.type === 'Identifier' ? n.id.name : undefined);
      case 'Property':
        if (!n.computed) visit(n.key, ctx);
        return visit(n.value, ctx, isFn(n.value) ? nameOf(n.key) : undefined);
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((x) => visit(x, ctx));
      else if (v && typeof v.type === 'string') visit(v, ctx);
    }
  }
  const body = program.body as any[];
  let k = 0;
  while (k < body.length && body[k].type === 'ExpressionStatement' && body[k].directive !== undefined) k++;
  const globals = scopeNames(program);
  if (globals.length) add(k ? body[k - 1].end : 0, 2, ` __dbg.g(function () { return [${globals.join(', ')}]; });`);
  list(body.slice(k), { names: [], catches: [] });

  ins.sort((a, b) => a.at - b.at || a.rank - b.rank || a.seq - b.seq);
  let code = '';
  let pos = 0;
  for (const i of ins) {
    code += text.slice(pos, i.at) + i.text;
    pos = i.at;
  }
  code += text.slice(pos);
  try {
    acorn.parse(code, { ecmaVersion: 2020, allowReturnOutsideFunction: true });
  } catch {
    return null; // never run something that wouldn't parse where the original does
  }
  return { code, stmts, fns, globals };
}

// ---------------------------------------------------------------------------------------------
// Values

const MAX_TEXT = 120;
const MAX_CHILDREN = 25;
const MAX_STRING = 2000;
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + '…' : s);

/** A value as a short, bounded view. Never runs the handler's getters or calls anything. */
export function viewOf(v: unknown, depth = 1): ValueView {
  if (v === null) return { type: 'null', text: 'null', value: null };
  switch (typeof v) {
    case 'undefined':
      return { type: 'undefined', text: 'undefined' };
    case 'string':
      return { type: 'string', text: clip(JSON.stringify(v)), value: v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v, length: v.length };
    case 'number':
      return Number.isFinite(v) ? { type: 'number', text: String(v), value: v } : { type: 'number', text: String(v) };
    case 'boolean':
      return { type: 'boolean', text: String(v), value: v };
    case 'bigint':
      return { type: 'number', text: String(v), value: String(v) };
    case 'symbol':
      return { type: 'symbol', text: 'symbol' };
  }
  const o = v as object;
  const label = dotnetLabels.get(o);
  if (label !== undefined) return { type: '.NET', text: label };
  if (typeof o === 'function') {
    const name = Object.getOwnPropertyDescriptor(o, 'name')?.value;
    return { type: 'function', text: `function ${typeof name === 'string' ? name : ''}()` };
  }
  const own = Object.getOwnPropertyDescriptor(o, '__label');
  if (own && typeof own.value === 'string') return { type: '.NET', text: own.value }; // new Nucleus.IniSaveInfo(...)
  const isArray = Array.isArray(o);
  let keys: string[];
  try {
    keys = Object.keys(o);
  } catch {
    return { type: 'object', text: '{…}' };
  }
  if (isArray) keys = keys.filter((k) => /^\d+$/.test(k));
  const total = isArray ? (o as unknown[]).length : keys.length;
  const shown = keys.slice(0, MAX_CHILDREN);
  const children: Record<string, ValueView> = {};
  const parts: string[] = [];
  for (const k of shown) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    const c: ValueView = !d ? viewOf(undefined, 0) : 'value' in d ? (depth > 0 ? viewOf(d.value, depth - 1) : shallow(d.value)) : { type: 'getter', text: '(getter, not run)' };
    children[k] = c;
    parts.push(isArray ? c.text : `${k}: ${c.text}`);
  }
  const rest = total - shown.length;
  const inner = parts.join(', ') + (rest > 0 ? ', …' : '');
  const out: ValueView = isArray ? { type: 'array', text: clip(`[${inner}]`), length: total } : { type: 'object', text: clip(`{${inner}}`) };
  if (depth > 0) out.children = children;
  if (rest > 0) out.more = rest;
  return out;
}
function shallow(v: unknown): ValueView {
  if (v !== null && typeof v === 'object') {
    const label = dotnetLabels.get(v) ?? Object.getOwnPropertyDescriptor(v, '__label')?.value;
    if (typeof label === 'string') return { type: '.NET', text: label };
    return Array.isArray(v) ? { type: 'array', text: `[…] (${v.length})`, length: v.length } : { type: 'object', text: '{…}' };
  }
  return viewOf(v, 0);
}

/** The Context and Player fields the debugger shows (Context has 200+ members; these are the ones handlers use). */
export const CONTEXT_FIELDS = [
  'PlayerID', 'Nickname', 'NumberOfPlayers', 'Width', 'Height', 'PosX', 'PosY', 'MonitorWidth', 'MonitorHeight',
  'IsKeyboardPlayer', 'GamepadId', 'StartArguments', 'ExePath', 'RootFolder', 'RootInstallFolder',
  'UserProfileConfigPath', 'UserProfileSavePath', 'DocumentsConfigPath', 'DocumentsSavePath', 'Options',
];
export const PLAYER_FIELDS = ['PlayerID', 'Nickname', 'IsKeyboardPlayer', 'IsXInput', 'IsRawKeyboard', 'IsRawMouse', 'GamepadId', 'SteamID', 'MonitorBounds'];
const NUCLEUS_GLOBALS = ['Game', 'Hub', 'Nucleus', 'System', 'importNamespace', 'Context', 'Player', 'PlayerList', 'Handler', 'ProtoInput'];

// ---------------------------------------------------------------------------------------------
// Recording

let current: { trace: Trace } | null = null;

/** The trace recorded so far by the run in progress (or the last one): for a run cut off by a time limit. */
export function partialTrace(): Trace | null {
  return current?.trace ?? null;
}

/**
 * Runs the handler like simulate() and records every statement it executes. `trace.result` is
 * exactly what simulate() returns. Runs the handler's code: in Node use traceIsolated() (src/sandbox.ts).
 */
export function traceHandler(src: string, opts: TraceOptions): Trace {
  const maxSteps = Math.max(1, opts.maxSteps ?? DEFAULT_MAX_STEPS);
  const perPhase = Math.max(1, opts.maxStepsPerPhase ?? DEFAULT_MAX_STEPS_PER_PHASE);
  const simOpts: SimOptions = { players: opts.players, width: opts.width, height: opts.height, keyboardPlayer: opts.keyboardPlayer, ...(opts.plugins ? { plugins: opts.plugins } : {}) };
  const trace: Trace = { steps: [], calls: [], truncated: false, truncatedPhases: [], maxSteps, result: undefined as unknown as SimResult };
  current = { trace };
  const inst = instrument(src);
  if (!inst) trace.error = "The debugger couldn't read this handler, so it ran without stopping anywhere.";
  const builtins = new Set([...NUCLEUS_GLOBALS, ...Object.keys(opts.plugins ?? {})]);
  const pool = new Map<string, any>();
  const intern = <T>(x: T): T => {
    const key = JSON.stringify(x);
    const hit = pool.get(key);
    if (hit) return hit;
    pool.set(key, x);
    return x;
  };
  let phase: Phase = intern({ kind: 'top', name: 'top of the file' } as Phase);
  let env: SimEnv | undefined;
  let frames: Frame[] = [];
  let topLine = 0;
  let inPhase = 0;
  let phaseCut = false;
  let lastMeta: StmtMeta | undefined;
  let readGlobals: (() => unknown[]) | undefined;
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const fields = (obj: unknown, names: string[]) => {
    const out: Record<string, ValueView> = {};
    for (const f of names) out[f] = viewOf((obj as any)[f], 1);
    return intern(out);
  };
  const record = (meta: StmtMeta, values: unknown[]) => {
    const scope = env!.scope;
    const locals: Record<string, ValueView> = {};
    meta.names.forEach((n, i) => (locals[n] = viewOf(values[i])));
    const globals: Record<string, ValueView> = {};
    if (readGlobals) {
      const g = readGlobals();
      inst!.globals.forEach((n, i) => (globals[n] = viewOf(g[i])));
    }
    for (const k of Object.keys(scope)) if (!builtins.has(k) && !has(globals, k)) globals[k] = viewOf(scope[k]);
    const options: Record<string, ValueView> = {};
    for (const o of env!.options()) options[o.path] = viewOf(o.value);
    const stack: Frame[] = frames.map((f) => ({ name: f.name, line: f.line })).reverse();
    if (phase.kind === 'top') stack.push({ name: 'top of the file', line: frames.length ? topLine : meta.line });
    const step: Step = {
      line: meta.line,
      column: meta.column,
      phase,
      depth: frames.length,
      stack: intern(stack),
      locals: intern(locals),
      globals: intern(globals),
      options: intern(options),
      effects: trace.calls.length,
    };
    if (has(scope, 'Context')) step.context = fields(scope.Context, CONTEXT_FIELDS);
    if (has(scope, 'Player')) step.player = fields(scope.Player, PLAYER_FIELDS);
    trace.steps.push(step);
  };
  const runtime = Object.freeze({
    s(id: number, get?: () => unknown[]) {
      const meta = inst!.stmts[id];
      if (!meta || !env) return;
      if (frames.length) frames[frames.length - 1].line = meta.line;
      else topLine = meta.line;
      lastMeta = meta;
      if (phaseCut) return;
      if (trace.steps.length >= maxSteps || inPhase >= perPhase) {
        trace.truncated = phaseCut = true;
        trace.truncatedPhases.push(describePhase(phase));
        return;
      }
      inPhase++;
      try {
        record(meta, get ? get() : []);
      } catch {
        // a view that can't be read is left out; the handler goes on unchanged
      }
    },
    e(id: number) {
      const f = inst!.fns[id];
      frames.push({ name: f?.name ?? 'function', line: f?.line ?? 0 });
    },
    x() {
      frames.pop();
    },
    g(get: () => unknown[]) {
      readGlobals = get;
    },
  });
  const hooks: SimHooks = {
    instrument: (s) => inst?.code ?? s,
    runtime,
    phase(p, e) {
      phase = intern({ ...p });
      env = e;
      frames = [];
      inPhase = 0;
      lastMeta = undefined;
      if (trace.steps.length < maxSteps) phaseCut = false;
    },
    error(message) {
      const last = trace.steps[trace.steps.length - 1];
      if (!last || last.phase !== phase || last.error) return;
      // Cut off before the error: the last recorded step's values, at the line that failed.
      const where = phaseCut && lastMeta ? { line: lastMeta.line, column: lastMeta.column } : {};
      trace.steps.push({ ...last, ...where, effects: trace.calls.length, error: message });
    },
    call(line, effect) {
      // Kept while a phase's statements are cut off too: "what the handler did so far" stays complete.
      if (trace.calls.length >= maxSteps) return void (trace.truncated = true);
      trace.calls.push({ step: trace.steps.length - 1, call: line, ...(effect ? { effect } : {}) });
    },
  };
  trace.result = simulate(src, simOpts, inst ? hooks : undefined);
  if (!trace.result.loaded) trace.error = trace.result.loadError;
  return trace;
}

// ---------------------------------------------------------------------------------------------
// Moving through a trace

export interface Breakpoint {
  line: number;
  /** e.g. `Context.PlayerID == 1` (see evaluateWatch for what is allowed) */
  condition?: string;
}
/** continue: to the next breakpoint (or error with stopOnErrors); into: the next statement;
 *  over: the next line in this function (or the caller, or the next phase); out: back in the caller (or the next phase);
 *  back: one statement back; reverse: back to the previous breakpoint (or error). */
export type StepMode = 'continue' | 'over' | 'into' | 'out' | 'back' | 'reverse';
export interface StopOptions {
  mode: StepMode;
  breakpoints?: Breakpoint[];
  /** Also stop on errors in 'continue'/'reverse' (stepping always stops where an error ends a phase) */
  stopOnErrors?: boolean;
}
export interface Stop {
  index: number;
  reason: 'breakpoint' | 'step' | 'error';
  breakpoint?: Breakpoint;
  /** The breakpoint's condition couldn't be evaluated (it stops there, so you can fix it) */
  conditionError?: string;
}

const samePhase = (a: Phase, b: Phase) => a === b || (a.kind === b.kind && a.name === b.name && a.player === b.player);

/** The breakpoint that stops at step `i`: each line stops once per visit, even with several statements on it. */
function breakpointAt(trace: Trace, i: number, bps: Breakpoint[]): Stop | null {
  const s = trace.steps[i];
  const prev = trace.steps[i - 1];
  if (s.error) return null;
  if (prev && prev.line === s.line && prev.depth === s.depth && samePhase(prev.phase, s.phase) && !prev.error) return null;
  for (const bp of bps) {
    if (bp.line !== s.line) continue;
    if (!bp.condition?.trim()) return { index: i, reason: 'breakpoint', breakpoint: bp };
    const r = evaluateWatch(trace, i, bp.condition);
    if (r.error) return { index: i, reason: 'breakpoint', breakpoint: bp, conditionError: r.error };
    if (truthy(r.value!)) return { index: i, reason: 'breakpoint', breakpoint: bp };
  }
  return null;
}

/** Where to stop next from step `from` (-1: before the first step). null: the run ends (or, backwards, nothing before). */
export function nextStop(trace: Trace, from: number, o: StopOptions): Stop | null {
  const steps = trace.steps;
  const bps = o.breakpoints ?? [];
  if (o.mode === 'back') return from - 1 >= 0 && from - 1 < steps.length ? { index: from - 1, reason: steps[from - 1].error ? 'error' : 'step' } : null;
  if (o.mode === 'reverse') {
    for (let j = Math.min(from, steps.length) - 1; j >= 0; j--) {
      if (o.stopOnErrors && steps[j].error) return { index: j, reason: 'error' };
      const bp = breakpointAt(trace, j, bps);
      if (bp) return bp;
    }
    return null;
  }
  const cur = from >= 0 ? steps[from] : undefined;
  for (let j = from + 1; j < steps.length; j++) {
    const s = steps[j];
    if (s.error && (o.stopOnErrors || o.mode !== 'continue')) return { index: j, reason: 'error' };
    const bp = breakpointAt(trace, j, bps);
    if (bp) return bp;
    if (o.mode === 'continue') continue;
    if (!cur || o.mode === 'into') return { index: j, reason: 'step' };
    const otherPhase = !samePhase(s.phase, cur.phase);
    if (o.mode === 'over' && (otherPhase || s.depth < cur.depth || (s.depth === cur.depth && s.line !== cur.line))) return { index: j, reason: 'step' };
    if (o.mode === 'out' && (otherPhase || s.depth < cur.depth)) return { index: j, reason: 'step' };
  }
  return null;
}

/** The calls made before step `i` (what the handler did so far), with their plain-language effects. */
export function callsBefore(trace: Trace, i: number): TraceCall[] {
  return trace.calls.slice(0, trace.steps[i]?.effects ?? trace.calls.length);
}

// ---------------------------------------------------------------------------------------------
// Watch expressions and conditions: evaluated over the recorded views, never by running code.

const raw = (v: ValueView): unknown => (v.type === 'undefined' || v.type === 'default' ? undefined : 'value' in v ? v.value : v.type === 'number' ? Number(v.text) : v.text);
const truthy = (v: ValueView): boolean =>
  'value' in v ? !!v.value : v.type === 'number' ? !Number.isNaN(Number(v.text)) : v.type !== 'undefined' && v.type !== 'null' && v.type !== 'default';
const DEFAULT: ValueView = { type: 'default', text: "not set (Nucleus' default)" };

/**
 * Evaluates a watch expression or breakpoint condition at step `i`, over the recorded values only:
 * names (locals, then globals, Context, Player, Game options), member access (`a.b`, `a[0]`,
 * `a["b"]`; .NET members with Jint's first-letter rule), literals, `! - + typeof`,
 * `== != === !== < > <= >= + - * / %`, `&& ||` and `? :`. Nothing of the handler runs.
 */
export function evaluateWatch(trace: Trace, i: number, expr: string): { value?: ValueView; error?: string } {
  const step = trace.steps[i];
  if (!step) return { error: 'No step there.' };
  let node: any;
  try {
    node = acorn.parseExpressionAt(expr, 0, { ecmaVersion: 5 });
    if (expr.slice(node.end).trim()) throw new Error(`Unexpected "${expr.slice(node.end).trim()}"`);
  } catch (e: any) {
    return { error: `Can't read this expression: ${String(e?.message ?? e).replace(/ \(\d+:\d+\)$/, '')}` };
  }
  try {
    const r = ev(node, step);
    return { value: r.kind === 'game' ? gameView(step, r.path) : r.view };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

type Ev = { kind: 'view'; view: ValueView } | { kind: 'game'; path: string };
const NOT_ALLOWED = (what: string) => new Error(`${what} isn't allowed here: watches only read recorded values (names, members, comparisons).`);

function gameView(step: Step, path: string): ValueView {
  if (step.options[path]) return step.options[path];
  const prefix = path + '.';
  const kids = Object.entries(step.options).filter(([k]) => k.startsWith(prefix));
  if (!kids.length) return DEFAULT;
  const children = Object.fromEntries(kids.map(([k, v]) => [k.slice(prefix.length), v]));
  return { type: '.NET', text: path, children };
}

function member(obj: ValueView, key: string, label: string): ValueView {
  if (key === 'length' && obj.length !== undefined) return viewOf(obj.length);
  if (obj.type === 'undefined' || obj.type === 'null' || obj.type === 'default') throw new Error(`Can't read "${key}": ${label} is ${obj.type === 'default' ? 'not set' : obj.type}.`);
  const c = obj.children;
  if (c) {
    if (key in c) return c[key];
    if (obj.type === '.NET') {
      const alt = key[0] === key[0].toUpperCase() ? key[0].toLowerCase() + key.slice(1) : key[0].toUpperCase() + key.slice(1);
      if (alt in c) return c[alt];
      if (label === 'Context' || label === 'Player') throw new Error(`The debugger doesn't record ${label}.${key}. It shows: ${Object.keys(c).join(', ')}.`);
    }
    if (obj.more) throw new Error(`${label}.${key} isn't recorded (only the first ${MAX_CHILDREN} members are).`);
    return viewOf(undefined);
  }
  if (obj.type === 'object' || obj.type === 'array') throw new Error(`${label}.${key} isn't recorded (values are kept one level deep).`);
  return viewOf(undefined);
}

function ev(n: any, step: Step): Ev {
  const v = (view: ValueView): Ev => ({ kind: 'view', view });
  const val = (x: any): ValueView => {
    const r = ev(x, step);
    return r.kind === 'game' ? gameView(step, r.path) : r.view;
  };
  switch (n.type) {
    case 'Literal':
      if (n.regex) throw NOT_ALLOWED('A regular expression');
      return v(viewOf(n.value));
    case 'Identifier': {
      const name = n.name as string;
      if (name in step.locals) return v(step.locals[name]);
      if (name in step.globals) return v(step.globals[name]);
      if (name === 'Context' && step.context) return v({ type: '.NET', text: 'Context', children: step.context });
      if (name === 'Player' && step.player) return v({ type: '.NET', text: 'Player', children: step.player });
      if (name === 'Game') return { kind: 'game', path: 'Game' };
      if (name === 'undefined') return v(viewOf(undefined));
      if (name === 'NaN' || name === 'Infinity') return v(viewOf(Number(name)));
      if (name === 'Context' || name === 'Player') throw new Error(`${name} isn't set here: Nucleus sets it for Game.Play and the callbacks, not while the handler loads.`);
      throw new Error(`"${name}" isn't defined here.`);
    }
    case 'MemberExpression': {
      const key = n.computed ? raw(val(n.property)) : n.property.name;
      if (typeof key !== 'string' && typeof key !== 'number') throw new Error("Can't use that as a member name.");
      const o = ev(n.object, step);
      if (o.kind === 'game' && !step.options[o.path]) return { kind: 'game', path: `${o.path}.${key}` };
      const obj = o.kind === 'game' ? step.options[o.path] : o.view;
      return v(member(obj, String(key), o.kind === 'game' ? o.path : n.object.type === 'Identifier' ? n.object.name : obj.text));
    }
    case 'UnaryExpression': {
      const a = val(n.argument);
      switch (n.operator) {
        case '!':
          return v(viewOf(!truthy(a)));
        case '-':
          return v(viewOf(-(raw(a) as number)));
        case '+':
          return v(viewOf(+(raw(a) as number)));
        case 'typeof':
          return v(viewOf(a.type === 'default' ? 'undefined' : a.type === 'array' || a.type === 'null' || a.type === '.NET' ? 'object' : a.type === 'getter' ? 'unknown' : a.type));
      }
      throw NOT_ALLOWED(`"${n.operator}"`);
    }
    case 'BinaryExpression': {
      const a = raw(val(n.left)) as any;
      const b = raw(val(n.right)) as any;
      switch (n.operator) {
        // eslint-disable-next-line eqeqeq
        case '==': return v(viewOf(a == b));
        // eslint-disable-next-line eqeqeq
        case '!=': return v(viewOf(a != b));
        case '===': return v(viewOf(a === b));
        case '!==': return v(viewOf(a !== b));
        case '<': return v(viewOf(a < b));
        case '>': return v(viewOf(a > b));
        case '<=': return v(viewOf(a <= b));
        case '>=': return v(viewOf(a >= b));
        case '+': return v(viewOf(a + b));
        case '-': return v(viewOf(a - b));
        case '*': return v(viewOf(a * b));
        case '/': return v(viewOf(a / b));
        case '%': return v(viewOf(a % b));
      }
      throw NOT_ALLOWED(`"${n.operator}"`);
    }
    case 'LogicalExpression': {
      const a = val(n.left);
      if (n.operator === '&&') return v(truthy(a) ? val(n.right) : a);
      return v(truthy(a) ? a : val(n.right));
    }
    case 'ConditionalExpression':
      return v(truthy(val(n.test)) ? val(n.consequent) : val(n.alternate));
    case 'CallExpression':
    case 'NewExpression':
      throw NOT_ALLOWED('Calling a function');
    case 'AssignmentExpression':
    case 'UpdateExpression':
      throw NOT_ALLOWED('Changing a value');
  }
  throw NOT_ALLOWED('That kind of expression');
}

// ---------------------------------------------------------------------------------------------
// Plain language

/** Where the run is, in words, e.g. "for player 2 of 4, in Game.Play". */
export function describePhase(p: Phase): string {
  if (p.kind === 'top') return 'while Nucleus loads the handler (top of the file)';
  if (p.kind === 'play') return `for player ${(p.player ?? 0) + 1} of ${p.players}, in Game.Play`;
  return `in ${p.name}${p.player !== undefined ? ` (it sees the last player's Context: player ${p.player + 1} of ${p.players})` : ''}`;
}

/** e.g. "Paused before line 14 for player 2 of 4, in Game.Play, inside helper()." */
export function describeStep(step: Step): string {
  const fn = step.stack[0];
  const inside = step.depth > 0 && fn && fn.name !== step.phase.name ? `, inside ${fn.name}()${step.stack[1] && step.stack[1].name !== step.phase.name ? `, called from ${step.stack[1].name}()` : ''}` : '';
  if (!step.error) return `Paused before line ${step.line} ${describePhase(step.phase)}${inside}.`;
  const after =
    step.phase.kind === 'top'
      ? " Nucleus can't load the handler past this line."
      : step.phase.kind === 'play' || step.phase.name === 'Game.OnFinishedSetup'
        ? ' Nucleus ends the session here.'
        : step.phase.name === 'Game.OnStop'
          ? ' Nucleus skips its cleanup after this.'
          : '';
  return `Stopped at line ${step.line} ${describePhase(step.phase)}${inside}: ${step.error}.${after}`.replace(/\.\./g, '.');
}

// ---------------------------------------------------------------------------------------------
// Transfer: steps share their views (most don't change from one step to the next), so a trace is
// sent as a pool of distinct views plus steps that point into it.

const SHARED = ['phase', 'stack', 'locals', 'globals', 'context', 'player', 'options'] as const;

export function packTrace(t: Trace): string {
  const pool: unknown[] = [];
  const index = new Map<unknown, number>();
  const ref = (x: unknown) => {
    let i = index.get(x);
    if (i === undefined) index.set(x, (i = pool.push(x) - 1));
    return i;
  };
  const steps = t.steps.map((s) => {
    const o: any = { ...s };
    for (const k of SHARED) if (s[k] !== undefined) o[k] = ref(s[k]);
    return o;
  });
  return JSON.stringify({ ...t, steps, pool });
}

export function unpackTrace(json: string): Trace {
  const { pool, ...t } = JSON.parse(json);
  for (const s of t.steps) for (const k of SHARED) if (typeof s[k] === 'number') s[k] = pool[s[k]];
  return t as Trace;
}
