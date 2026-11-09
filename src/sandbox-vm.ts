// The vm side of the "Try it" sandbox: evaluates the bundled simulator (src/sim-sandbox-entry.ts) in a
// context of its own and runs handlers there. Used directly by src/sandbox.ts (synchronous, for the CLI's
// one-shot runs and tests) and inside the worker thread (src/sim-worker-entry.ts, src/simworker.ts), so it
// imports nothing but `vm`: it is bundled into the worker's code. Only strings go in and come out.
import vm from 'node:vm';

export type VmReply = { ok: true; out: string } | { ok: false; error: string; partial?: string };

export interface VmRunner {
  simulate(src: string, opts: string, timeoutMs: number): VmReply;
  trace(src: string, opts: string, timeoutMs: number): VmReply;
}

/** A runner over one copy of the simulator's code. */
export function vmRunner(sandboxCode: string): VmRunner {
  let context: vm.Context | undefined;
  let contextFor: string | undefined;
  /** The simulator's context, kept only for runs of the same handler text (Test all runs one handler many times).
   *  Handler code can change the context's own built-ins (`Array.prototype.push = …`), so another handler, or the
   *  next version of this one, always gets a fresh context: one run can never change what the next one sees. */
  const getContext = (src: string): vm.Context => {
    if (context && contextFor === src) return context;
    context = undefined;
    contextFor = src;
    // A context whose global object has no host-side object behind it.
    const dontContextify = (vm as any).constants?.DONT_CONTEXTIFY;
    const ctx = dontContextify !== undefined ? vm.createContext(dontContextify) : vm.createContext(Object.create(null));
    vm.runInContext(sandboxCode, ctx, { filename: 'nucleus-simulator.js' });
    return (context = ctx);
  };
  const run = (fn: '__nucleusSimulate' | '__nucleusTrace', src: string, opts: string, timeoutMs: number): VmReply => {
    const ctx = getContext(String(src));
    const g = vm.runInContext('globalThis', ctx);
    g.__src = String(src);
    g.__opts = String(opts);
    try {
      return { ok: true, out: String(vm.runInContext(`${fn}(__src, __opts)`, ctx, { timeout: timeoutMs, filename: 'handler.js' })) };
    } catch (e: any) {
      let partial: string | undefined;
      if (fn === '__nucleusTrace') {
        try {
          partial = String(vm.runInContext('__nucleusTracePartial()', ctx, { timeout: 2000 })) || undefined;
        } catch {
          // nothing recorded
        }
      }
      context = undefined; // start from a clean context next time
      return { ok: false, error: String(e?.message ?? e), partial };
    } finally {
      if (context) {
        delete g.__src;
        delete g.__opts;
      }
    }
  };
  return {
    simulate: (src, opts, timeoutMs) => run('__nucleusSimulate', src, opts, timeoutMs),
    trace: (src, opts, timeoutMs) => run('__nucleusTrace', src, opts, timeoutMs),
  };
}
