// Bundled (as an IIFE string) into the CLI and the extension and evaluated inside a fresh
// `vm` context by src/sandbox.ts. Only strings cross the boundary.
import { simulate } from './core/sim';

(globalThis as any).__nucleusSimulate = (src: string, opts: string): string => JSON.stringify(simulate(src, JSON.parse(opts)));
