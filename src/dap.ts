// A Debug Adapter (DAP) for handlers (splitscreenme-vscode#11): VS Code's own Run and Debug view, breakpoints, stepping,
// Variables, Watch and the Debug Console, over the debugger the workbench and `nucleus debug` use (core/debug.ts).
// The handler runs once, in the sandbox (traceIsolated), recording every statement; stepping then moves through that
// recording, so Back and Reverse Continue work too. Nothing here imports `vscode`: extension.ts wraps it as an inline
// adapter, and another editor could run it over stdio.
import fs from 'node:fs';
import { describePhase, describeStep, evaluateWatch, callsBefore, nextStop, type Breakpoint, type StepMode, type Trace, type ValueView } from './core/debug';
import { EVERY_KEYBOARD } from './core/sim';
import { pluginsFor, traceIsolated } from './sandbox';

/** launch.json for `"type": "nucleus"`. */
export interface LaunchArgs {
  /** The handler file. */
  program: string;
  /** Players to set up (default 2). */
  players?: number;
  /** Who has the keyboard and mouse: a player number (1-based), "all" (each their own) or "none" (default 1). */
  keyboard?: number | 'all' | 'none';
  /** The monitor, e.g. "1920x1080" (default). */
  resolution?: string;
  /** Pause on the first statement (default false: run to a breakpoint or an error). */
  stopOnEntry?: boolean;
  /** The handler's text when it isn't saved yet (the editor fills it in). */
  source?: string;
}

type Msg = { seq: number; type: string; command?: string; arguments?: any; event?: string };
const THREAD = 1;

export class HandlerDebugSession {
  private seq = 1;
  private trace: Trace | undefined;
  private at = -1;
  private program = '';
  private breakpoints: Breakpoint[] = [];
  private stopOnErrors = true;
  private stopOnEntry = false;
  /** Variables references: 1000+ are scopes or values handed out for the current stop. */
  private refs = new Map<number, Record<string, ValueView>>();
  private nextRef = 1000;

  constructor(private readonly send: (msg: unknown) => void) {}

  private respond(req: Msg, body: unknown = {}, error?: string) {
    this.send({ seq: this.seq++, type: 'response', request_seq: req.seq, command: req.command, success: !error, ...(error ? { message: error } : {}), body });
  }
  private event(event: string, body: unknown = {}) {
    this.send({ seq: this.seq++, type: 'event', event, body });
  }
  private output(text: string, category = 'console') {
    this.event('output', { category, output: text.endsWith('\n') ? text : `${text}\n` });
  }

  handle(req: Msg) {
    try {
      this.dispatch(req);
    } catch (e: any) {
      this.respond(req, {}, String(e?.message ?? e));
    }
  }

  private dispatch(req: Msg) {
    const a = req.arguments ?? {};
    switch (req.command) {
      case 'initialize':
        this.respond(req, {
          supportsConfigurationDoneRequest: true,
          supportsConditionalBreakpoints: true,
          supportsEvaluateForHovers: true,
          supportsStepBack: true,
          supportsTerminateRequest: true,
          exceptionBreakpointFilters: [{ filter: 'errors', label: 'Stop where an error ends the run', default: true }],
        });
        this.event('initialized');
        return;
      case 'launch': {
        const args = a as LaunchArgs;
        if (!args.program) return this.respond(req, {}, 'No handler to debug: set "program" in launch.json, e.g. "${file}".');
        this.program = args.program;
        this.stopOnEntry = !!args.stopOnEntry;
        const src = (args.source ?? fs.readFileSync(args.program, 'utf8')).replace(/^﻿/, '');
        const players = Math.min(16, Math.max(1, Number(args.players ?? 2) || 2));
        const res = /^(\d+)x(\d+)$/.exec(args.resolution ?? '1920x1080') ?? ['', '1920', '1080'];
        const kb = args.keyboard ?? 1;
        const keyboardPlayer = kb === 'none' ? -1 : kb === 'all' ? EVERY_KEYBOARD : Math.min(players, Math.max(1, Number(kb) || 1)) - 1;
        this.trace = traceIsolated(src, { players, width: Number(res[1]), height: Number(res[2]), keyboardPlayer, plugins: pluginsFor(args.program) });
        this.output(`Simulated: the handler runs the way Nucleus runs it (${players} player${players === 1 ? '' : 's'}, ${res[1]}×${res[2]}), but files, the registry and the game are pretend. ${this.trace.steps.length} statements recorded.`);
        if (this.trace.truncated) this.output(`Not every statement was recorded${this.trace.truncatedPhases.length ? `: ${this.trace.truncatedPhases.join('; ')}` : ''}.`, 'important');
        return this.respond(req);
      }
      case 'setBreakpoints': {
        const bps: { line: number; condition?: string }[] = a.breakpoints ?? [];
        this.breakpoints = bps.map((b) => ({ line: b.line, ...(b.condition ? { condition: b.condition } : {}) }));
        return this.respond(req, { breakpoints: bps.map((b) => ({ verified: true, line: b.line })) });
      }
      case 'setExceptionBreakpoints':
        this.stopOnErrors = (a.filters ?? []).includes('errors');
        return this.respond(req);
      case 'configurationDone':
        this.respond(req);
        return this.move(this.stopOnEntry ? 'into' : 'continue', true);
      case 'threads':
        return this.respond(req, { threads: [{ id: THREAD, name: 'Nucleus (simulated)' }] });
      case 'continue':
        this.respond(req, { allThreadsContinued: true });
        return this.move('continue');
      case 'next':
        this.respond(req);
        return this.move('over');
      case 'stepIn':
        this.respond(req);
        return this.move('into');
      case 'stepOut':
        this.respond(req);
        return this.move('out');
      case 'stepBack':
        this.respond(req);
        return this.move('back');
      case 'reverseContinue':
        this.respond(req);
        return this.move('reverse');
      case 'pause':
        return this.respond(req);
      case 'stackTrace': {
        const step = this.trace?.steps[this.at];
        if (!step) return this.respond(req, { stackFrames: [], totalFrames: 0 });
        const where = describePhase(step.phase);
        const frames = (step.stack.length ? step.stack : [{ name: 'top of the file', line: step.line }]).map((f, i) => ({
          id: i,
          name: i === 0 ? `${f.name}, ${where}` : f.name,
          line: i === 0 ? step.line : f.line,
          column: i === 0 ? step.column : 1,
          source: { path: this.program, name: this.program.split(/[\\/]/).pop() },
        }));
        return this.respond(req, { stackFrames: frames, totalFrames: frames.length });
      }
      case 'scopes': {
        const step = this.trace?.steps[this.at];
        if (!step) return this.respond(req, { scopes: [] });
        const scopes: { name: string; vars: Record<string, ValueView> | undefined; expensive?: boolean }[] = [
          { name: 'Variables', vars: step.locals },
          { name: 'Handler variables', vars: step.globals },
          { name: 'Context', vars: step.context },
          { name: 'Player', vars: step.player },
          { name: 'Game options set', vars: step.options },
          { name: 'Done so far', vars: this.doneSoFar() },
        ];
        return this.respond(req, {
          scopes: scopes.filter((s) => s.vars && Object.keys(s.vars).length).map((s) => ({ name: s.name, variablesReference: this.ref(s.vars!), expensive: false })),
        });
      }
      case 'variables': {
        const vars = this.refs.get(a.variablesReference) ?? {};
        return this.respond(req, { variables: Object.entries(vars).map(([name, v]) => this.variable(name, v)) });
      }
      case 'evaluate': {
        if (!this.trace || this.at < 0) return this.respond(req, {}, 'Not paused.');
        const r = evaluateWatch(this.trace, this.at, String(a.expression ?? ''));
        if (r.error) return this.respond(req, {}, r.error);
        const v = r.value!;
        return this.respond(req, { result: v.text, type: v.type, variablesReference: v.children ? this.ref(v.children) : 0 });
      }
      case 'disconnect':
      case 'terminate':
        this.respond(req);
        if (req.command === 'terminate') this.event('terminated');
        return;
      default:
        return this.respond(req, {}, `Not supported: ${req.command}`);
    }
  }

  private ref(vars: Record<string, ValueView>): number {
    const id = this.nextRef++;
    this.refs.set(id, vars);
    return id;
  }
  private variable(name: string, v: ValueView) {
    return { name, value: v.text, type: v.type, variablesReference: v.children && Object.keys(v.children).length ? this.ref(v.children) : 0 };
  }
  /** What Nucleus would have done up to the current statement, as values. */
  private doneSoFar(): Record<string, ValueView> | undefined {
    if (!this.trace || this.at < 0) return undefined;
    const did = callsBefore(this.trace, this.at).filter((c) => c.effect);
    return Object.fromEntries(did.map((c, i) => [String(i + 1), { type: 'string', text: c.effect! }]));
  }

  private move(mode: StepMode, first = false) {
    const trace = this.trace;
    if (!trace) return this.event('terminated');
    this.refs.clear();
    const stop = nextStop(trace, first ? -1 : this.at, { mode, breakpoints: this.breakpoints, stopOnErrors: this.stopOnErrors });
    if (!stop) {
      if (mode === 'back' || mode === 'reverse') {
        // Nothing before: stay on the first statement.
        this.at = Math.max(0, this.at);
        return this.event('stopped', { reason: 'entry', threadId: THREAD, allThreadsStopped: true, description: 'Start of the run' });
      }
      if (trace.error) this.output(trace.error, 'stderr');
      else this.output(first && !this.breakpoints.length ? 'No errors. Set a breakpoint (click beside a line number) to pause there.' : 'The run finished.');
      return this.event('terminated');
    }
    this.at = stop.index;
    const step = trace.steps[stop.index];
    const text = describeStep(step) + (stop.conditionError ? ` (the breakpoint's condition failed: ${stop.conditionError})` : '');
    this.event('stopped', {
      reason: stop.reason === 'error' ? 'exception' : stop.reason === 'breakpoint' ? 'breakpoint' : first ? 'entry' : 'step',
      threadId: THREAD,
      allThreadsStopped: true,
      description: text,
      ...(stop.reason === 'error' ? { text: step.error } : {}),
    });
    if (stop.reason !== 'step') this.output(text);
  }
}
