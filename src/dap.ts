// A Debug Adapter (DAP) for handlers (splitscreenme-vscode#11): VS Code's own Run and Debug view, breakpoints, stepping,
// Variables, Watch and the Debug Console, over the debugger the workbench and `nucleus debug` use (core/debug.ts).
// The handler runs once, in the sandbox (in the simulator's worker thread, src/simworker.ts, so a looping handler
// never blocks the editor), recording every statement; stepping then moves through that
// recording, so Back and Reverse Continue work too. Nothing here imports `vscode`: extension.ts wraps it as an inline
// adapter, and another editor could run it over stdio.
import fs from 'node:fs';
import { describeStep, evaluateWatch, callsBefore, nextStop, type Breakpoint, type StepMode, type Trace, type ValueView } from './core/debug';
import { EVERY_KEYBOARD } from './core/sim';
import { pluginsFor } from './sandbox';
import { simWorker } from './simworker';
import type { TraceOptions } from './core/debug';

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

  /** While a request is answered asynchronously (launch), the ones after it wait their turn. */
  private busy: Promise<void> | undefined;

  /** `tracer`: how to run the handler; the simulator's worker by default (tests may pass the synchronous traceIsolated). */
  constructor(
    private readonly send: (msg: unknown) => void,
    private readonly tracer: (src: string, opts: TraceOptions) => Trace | Promise<Trace> = (src, opts) => simWorker().trace(src, opts),
  ) {}

  private respond(req: Msg, body: unknown = {}, error?: string) {
    this.send({ seq: this.seq++, type: 'response', request_seq: req.seq, command: req.command, success: !error, ...(error ? { message: error } : {}), body });
  }
  private event(event: string, body: unknown = {}) {
    this.send({ seq: this.seq++, type: 'event', event, body });
  }
  private output(text: string, category = 'console') {
    this.event('output', { category, output: text.endsWith('\n') ? text : `${text}\n` });
  }

  /** Handles one request, in order: returns a promise while an earlier or this request is still being answered. */
  handle(req: Msg): void | Promise<void> {
    if (this.busy) return this.queue(this.busy.then(() => this.handleNow(req)));
    return this.handleNow(req);
  }

  private queue(p: Promise<void>): Promise<void> {
    const mine = (this.busy = p.finally(() => {
      if (this.busy === mine) this.busy = undefined;
    }));
    return mine;
  }

  private handleNow(req: Msg): void | Promise<void> {
    const fail = (e: any) => this.respond(req, {}, String(e?.message ?? e));
    try {
      const r = this.dispatch(req);
      if (r instanceof Promise) return this.queue(r.catch(fail));
    } catch (e: any) {
      fail(e);
    }
  }

  private dispatch(req: Msg): void | Promise<void> {
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
        const launched = (trace: Trace) => {
          this.trace = trace;
          this.output(`Simulated: the handler runs the way Nucleus runs it (${players} player${players === 1 ? '' : 's'}, ${res[1]}×${res[2]}), but files, the registry and the game are pretend. ${this.trace.steps.length} statements recorded.`);
          if (this.trace.truncated) this.output(`Not every statement was recorded${this.trace.truncatedPhases.length ? `: ${this.trace.truncatedPhases.join('; ')}` : ''}.`, 'important');
          this.respond(req);
        };
        const t = this.tracer(src, { players, width: Number(res[1]), height: Number(res[2]), keyboardPlayer, plugins: pluginsFor(args.program) });
        if (t instanceof Promise) return t.then(launched);
        return launched(t);
      }
      case 'setBreakpoints': {
        const bps: { line: number; condition?: string }[] = a.breakpoints ?? [];
        this.breakpoints = bps.map((b) => ({ line: b.line, ...(b.condition ? { condition: b.condition } : {}) }));
        // A line past the end of the file can never be hit: say so instead of showing it as set.
        let lines = Infinity;
        try { if (a.source?.path) lines = fs.readFileSync(a.source.path, 'utf8').split('\n').length; } catch { /* unsaved or unknown: trust the editor */ }
        return this.respond(req, {
          breakpoints: bps.map((b) => (b.line >= 1 && b.line <= lines ? { verified: true, line: b.line } : { verified: false, line: b.line, message: `The file has ${lines} lines.` })),
        });
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
        // Short, where it matters: "Game.Play · player 2 of 4", "top of the file", "Game.OnStop · last player's Context".
        const ph = step.phase;
        const where = ph.kind === 'play' ? `player ${(ph.player ?? 0) + 1} of ${ph.players}` : ph.kind === 'top' ? '' : ph.player !== undefined ? `player ${ph.player + 1}'s Context` : '';
        const frames = (step.stack.length ? step.stack : [{ name: 'top of the file', line: step.line }]).map((f, i) => ({
          id: i,
          name: i === 0 && where ? `${f.name} · ${where}` : f.name,
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

/** `nucleus dap`: the adapter on stdin/stdout (Content-Length framed, like DAP clients expect). Resolves on disconnect. */
export function serveDap(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<number> {
  return new Promise((resolve) => {
    const write = (msg: unknown) => {
      const body = Buffer.from(JSON.stringify(msg), 'utf8');
      output.write(`Content-Length: ${body.length}\r\n\r\n`);
      output.write(body);
    };
    const session = new HandlerDebugSession(write);
    let buf = Buffer.alloc(0);
    input.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const sep = buf.indexOf('\r\n\r\n');
        if (sep < 0) break;
        const m = buf.subarray(0, sep).toString('ascii').match(/content-length:\s*(\d+)/i);
        if (!m) {
          buf = buf.subarray(sep + 4);
          continue;
        }
        const len = Number(m[1]);
        if (buf.length < sep + 4 + len) break;
        let msg: any;
        try {
          msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString('utf8'));
        } catch {
          msg = null;
        }
        buf = buf.subarray(sep + 4 + len);
        if (!msg) continue;
        session.handle(msg);
        if (msg.command === 'disconnect') return resolve(0);
      }
    });
    input.on('end', () => resolve(0));
  });
}
