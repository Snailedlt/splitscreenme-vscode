// Runs the "Try it" simulation for Node hosts (CLI, VS Code) without giving handler code access
// to Node. The whole simulator is evaluated inside a new `vm` context, so every object the
// handler can reach (Game, Context, the fake System, errors, arrays) belongs to that context:
// there is no host object to climb out through (`x.constructor.constructor("return process")`
// only finds the context's own Function). Only strings go in and come out. A time limit stops
// handlers that never finish.
import vm from 'node:vm';
import type { SimOptions, SimResult } from './core/sim';

declare const __SIM_SANDBOX__: string; // the bundled src/sim-sandbox-entry.ts, injected by scripts/build.mjs

export const SIM_TIMEOUT_MS = 2000;

let context: vm.Context | undefined;
function getContext(): vm.Context {
  if (context) return context;
  // A context whose global object has no host-side object behind it.
  const dontContextify = (vm as any).constants?.DONT_CONTEXTIFY;
  const ctx = dontContextify !== undefined ? vm.createContext(dontContextify) : vm.createContext(Object.create(null));
  vm.runInContext(__SIM_SANDBOX__, ctx, { filename: 'nucleus-simulator.js' });
  return (context = ctx);
}

export function simulateIsolated(src: string, opts: SimOptions, timeoutMs = SIM_TIMEOUT_MS): SimResult {
  const ctx = getContext();
  const g = vm.runInContext('globalThis', ctx);
  g.__src = String(src);
  g.__opts = JSON.stringify(opts);
  try {
    const out = vm.runInContext('__nucleusSimulate(__src, __opts)', ctx, { timeout: timeoutMs, filename: 'handler.js' });
    return JSON.parse(String(out));
  } catch (e: any) {
    // Timeouts (and anything else that escapes the simulator) become a load failure.
    context = undefined; // start from a clean context next time
    const msg = /timed out/i.test(String(e?.message)) ? `The handler did not finish within ${timeoutMs / 1000} s (an endless loop?). Nucleus would hang here.` : String(e?.message ?? e);
    return { loaded: false, loadError: msg, ignored: [], options: [], players: [], callbacks: [], hasPlay: false };
  } finally {
    if (context) {
      delete g.__src;
      delete g.__opts;
    }
  }
}
