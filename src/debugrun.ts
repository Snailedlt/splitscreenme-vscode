// The debugger run to the end, as text and data: every stop (breakpoints, errors, or each statement with `step`)
// with its variables, call stack, watches and what the handler did so far. `ncdev debug` and the MCP server's
// nucleus_debug share it. Handler code runs only in the isolated sandbox (src/sandbox.ts traceIsolated).
import { traceIsolated } from './sandbox';
import { nextStop, describeStep, evaluateWatch, callsBefore, type Breakpoint, type Stop, type TraceOptions, type ValueView } from './core/debug';

/** "14" or "14 if Context.PlayerID == 1"; undefined if it isn't one. */
export function parseBreakpoint(b: string): Breakpoint | undefined {
  const m = /^\s*(\d+)\s*(?:if\s+(.+))?$/s.exec(b);
  return m && Number(m[1]) >= 1 ? { line: Number(m[1]), ...(m[2] ? { condition: m[2].trim() } : {}) } : undefined;
}

export interface DebugRun {
  text: string;
  data: Record<string, unknown>;
  /** The handler threw, or stopped on an error. */
  failed: boolean;
}

const MAX_STOPS = 200;

export function runDebug(src: string, opts: TraceOptions, o: { breakpoints: Breakpoint[]; watches: string[]; step?: boolean }): DebugRun {
  const lineCount = src.split('\n').length;
  const past = o.breakpoints.filter((b) => b.line > lineCount);
  const trace = traceIsolated(src, opts);
  const mode = o.step ? 'into' : 'continue';
  const stops: Stop[] = [];
  for (let s = nextStop(trace, -1, { mode, breakpoints: o.breakpoints, stopOnErrors: true }); s && stops.length < MAX_STOPS; ) {
    stops.push(s);
    s = nextStop(trace, s.index, { mode, breakpoints: o.breakpoints, stopOnErrors: true });
  }
  const show = (v: ValueView) => `${v.text}${v.type === '.NET' || v.type === 'function' || v.type === 'null' || v.type === 'undefined' || v.type === 'default' ? '' : ` (${v.type})`}`;
  const items = stops.map((s) => {
    const step = trace.steps[s.index];
    return { ...s, step, description: describeStep(step), watches: o.watches.map((w) => ({ expr: w, ...evaluateWatch(trace, s.index, w) })), did: callsBefore(trace, s.index).filter((c) => c.effect).map((c) => c.effect!) };
  });
  const out: string[] = [];
  if (trace.error && !trace.steps.length) out.push(trace.error);
  for (const it of items) {
    out.push(`${it.description}${it.conditionError ? ` (the breakpoint's condition failed: ${it.conditionError})` : ''}`);
    const locals = Object.entries(it.step.locals);
    if (locals.length) out.push(`  Variables: ${locals.map(([k, v]) => `${k} = ${show(v)}`).join(', ')}`);
    if (it.step.stack.length > 1) out.push(`  Call stack: ${it.step.stack.map((f) => `${f.name} (line ${f.line})`).join(' < ')}`);
    for (const w of it.watches) out.push(`  ${w.expr} = ${w.error ? `(${w.error})` : show(w.value!)}`);
    if (it.did.length && !o.step) out.push(`  So far: ${it.did.join('; ')}`);
  }
  for (const b of past) out.push(`Line ${b.line} is past the end of the handler (${lineCount} lines), so that breakpoint can't be hit.`);
  if (!items.length && !trace.error) out.push(o.breakpoints.length ? `No breakpoint was hit (${trace.steps.length} statements ran).` : `No errors (${trace.steps.length} statements ran). Add a breakpoint to stop somewhere.`);
  if (stops.length >= MAX_STOPS) out.push(`(only the first ${MAX_STOPS} stops are shown)`);
  if (trace.truncated) out.push(`Not every statement was recorded (limits: ${trace.maxSteps} in all, fewer per phase)${trace.truncatedPhases.length ? `: ${trace.truncatedPhases.join('; ')}` : ''}.`);
  if (trace.error && trace.steps.length) out.push(trace.error);
  return {
    text: out.join('\n'),
    data: { stops: items, steps: trace.steps.length, truncated: trace.truncated, truncatedPhases: trace.truncatedPhases, error: trace.error, result: trace.result },
    failed: !!trace.error || items.some((i) => i.reason === 'error'),
  };
}
