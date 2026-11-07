// Bundled (as an IIFE string) into the CLI and the extension and evaluated inside a fresh
// `vm` context by src/sandbox.ts. Only strings cross the boundary.
import { simulate } from './core/sim';
import { traceHandler, partialTrace, packTrace } from './core/debug';

(globalThis as any).__nucleusSimulate = (src: string, opts: string): string => JSON.stringify(simulate(src, JSON.parse(opts)));
(globalThis as any).__nucleusTrace = (src: string, opts: string): string => packTrace(traceHandler(src, JSON.parse(opts)));
// After a time limit cut a trace off: what it recorded until then.
(globalThis as any).__nucleusTracePartial = (): string => {
  const t = partialTrace();
  return t ? packTrace(t) : '';
};
