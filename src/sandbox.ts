// Runs the "Try it" simulation for Node hosts (CLI, VS Code) without giving handler code access
// to Node. The whole simulator is evaluated inside a new `vm` context, so every object the
// handler can reach (Game, Context, the fake System, errors, arrays) belongs to that context:
// there is no host object to climb out through (`x.constructor.constructor("return process")`
// only finds the context's own Function). Only strings go in and come out. A time limit stops
// handlers that never finish. The vm part is src/sandbox-vm.ts; src/simworker.ts runs it in a worker
// thread for editors and servers, so a looping handler never blocks the thread that serves people.
import fs from 'node:fs';
import path from 'node:path';
import { vmRunner, type VmReply, type VmRunner } from './sandbox-vm';
import { parsePluginsInfo } from './core/sim';
import type { SimOptions, SimResult } from './core/sim';
import { unpackTrace } from './core/debug';
import type { Trace, TraceOptions } from './core/debug';

/** Plugin globals for a handler file: <handler folder>/pluginsInfo.txt, where Game.Folder points. */
export function pluginsFor(handlerFile: string): Record<string, string[]> | undefined {
  const file = path.join(path.dirname(handlerFile), path.basename(handlerFile, path.extname(handlerFile)), 'pluginsInfo.txt');
  try {
    return parsePluginsInfo(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

declare const __SIM_SANDBOX__: string; // the bundled src/sim-sandbox-entry.ts, injected by scripts/build.mjs

export const SIM_TIMEOUT_MS = 2000;
/** Tracing runs every statement through the debugger's hooks: slower than a plain run. */
export const TRACE_TIMEOUT_MS = 6000;

let runner: VmRunner | undefined;
const vmr = () => (runner ??= vmRunner(__SIM_SANDBOX__));

/** Synchronous, on the calling thread: for one-shot runs (the CLI) and tests. Editors and servers use
 *  src/simworker.ts instead, which runs the same code in a worker thread that can be stopped. */
export function simulateIsolated(src: string, opts: SimOptions, timeoutMs = SIM_TIMEOUT_MS): SimResult {
  return simResultOf(vmr().simulate(String(src), JSON.stringify(opts), timeoutMs), opts, timeoutMs);
}

/** core/debug.ts traceHandler() in the same isolated context as simulateIsolated(). A run that
 *  doesn't finish in time gives what it recorded until then, with `error` saying so. */
export function traceIsolated(src: string, opts: TraceOptions, timeoutMs = TRACE_TIMEOUT_MS): Trace {
  return traceOf(vmr().trace(String(src), JSON.stringify(opts), timeoutMs), opts, timeoutMs);
}

/** The message of a run that didn't finish in time (also matched by isTimeout()). */
export const timeoutMessage = (timeoutMs: number) => `The handler did not finish within ${timeoutMs / 1000} s (an endless loop?). Nucleus would hang here.`;
/** True for a result whose run was stopped because it took too long. */
export const isTimeout = (r: Pick<SimResult, 'loadError'>) => /did not finish within/.test(r.loadError ?? '');

/** A failed run as a result: the handler doesn't load, with why. */
export function failure(opts: Pick<SimOptions, 'players'>, error: string, timeoutMs: number): SimResult {
  const msg = /timed out/i.test(error) ? timeoutMessage(timeoutMs) : error;
  return { loaded: false, loadError: msg, ignored: [], options: [], players: [], callbacks: [], hasPlay: false, playerCount: opts.players };
}

/** A runner's reply (src/sandbox-vm.ts, here or in the worker) as a SimResult. */
export function simResultOf(r: VmReply, opts: SimOptions, timeoutMs: number): SimResult {
  return r.ok ? JSON.parse(r.out) : failure(opts, r.error, timeoutMs);
}

/** A runner's reply as a Trace; a run cut off keeps what it recorded until then. */
export function traceOf(r: VmReply, opts: TraceOptions, timeoutMs: number): Trace {
  if (r.ok) return unpackTrace(r.out);
  const result = failure(opts, r.error, timeoutMs);
  const t: Omit<Trace, 'result'> = r.partial ? unpackTrace(r.partial) : { steps: [], calls: [], truncated: false, truncatedPhases: [], maxSteps: opts.maxSteps ?? 0 };
  return { ...t, result, error: result.loadError };
}
