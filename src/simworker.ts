// "Try it", Test all and the debugger without blocking the thread that serves people (the VS Code
// extension host, `ncdev lsp`, `ncdev mcp`, `ncdev dap`): one long-lived worker thread owns the vm
// sandbox (src/sandbox-vm.ts) and answers runs by id, one at a time.
// - Lightweight: one worker for the whole process, started on the first run, kept while idle (unref'd,
//   so it never keeps a CLI alive), the simulator's context reused for runs of the same text.
// - A hard time limit: vm's own timeout stops a looping handler inside the worker; if a run still doesn't
//   answer (anything vm's timeout misses), the worker is terminated and a fresh one starts on the next run.
// - Out-of-memory handlers kill only the worker (resourceLimits), not the editor.
// - Cancellation: an AbortSignal drops a queued run before it starts; a running one is given a moment to
//   finish, then its worker is stopped, so a new edit never waits behind an old endless loop.
// Handler code still only runs inside the vm context: the worker adds a thread boundary, nothing more.
import { Worker } from 'node:worker_threads';
import type { SimOptions, SimResult } from './core/sim';
import type { Trace, TraceOptions } from './core/debug';
import { simResultOf, traceOf, SIM_TIMEOUT_MS, TRACE_TIMEOUT_MS, isTimeout } from './sandbox';
import type { VmReply } from './sandbox-vm';
import { failureOf, jobOptions, type MatrixFail, type MatrixPlan, type MatrixResult } from './core/matrix';

declare const __SIM_WORKER__: string; // src/sim-worker-entry.ts, bundled by scripts/build.mjs
declare const __SIM_SANDBOX__: string;

/** Added to a run's own time limit before its worker is stopped: starting a worker and loading the simulator. */
export const HARD_LIMIT_GRACE_MS = 3000;
/** How long a cancelled run that is already running may take before its worker is stopped. */
export const CANCEL_GRACE_MS = 250;

export class CancelledError extends Error {
  readonly name = 'AbortError';
  constructor() {
    super('Cancelled: a newer run replaced this one.');
  }
}
export const isCancelled = (e: unknown) => e instanceof CancelledError;

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface Job {
  id: number;
  kind: 'simulate' | 'trace';
  src: string;
  opts: string;
  timeoutMs: number;
  signal?: AbortSignal;
  resolve(r: VmReply): void;
  reject(e: unknown): void;
  cleanup(): void;
}

export class SimWorker {
  private worker: Worker | undefined;
  private queue: Job[] = [];
  private running: Job | undefined;
  private hardTimer: NodeJS.Timeout | undefined;
  private cancelTimer: NodeJS.Timeout | undefined;
  private nextId = 1;
  /** Workers started so far (tests, measurements). */
  started = 0;
  /** Workers stopped because a run didn't answer in time or was cancelled while running. */
  killed = 0;

  /** Added to a run's time limit before the worker is stopped. */
  hardGraceMs = HARD_LIMIT_GRACE_MS;

  constructor(private readonly code = __SIM_WORKER__, private readonly sandbox = __SIM_SANDBOX__) {}

  async simulate(src: string, opts: SimOptions, o: RunOptions = {}): Promise<SimResult> {
    const timeoutMs = o.timeoutMs ?? SIM_TIMEOUT_MS;
    return simResultOf(await this.run('simulate', src, opts, timeoutMs, o.signal), opts, timeoutMs);
  }

  async trace(src: string, opts: TraceOptions, o: RunOptions = {}): Promise<Trace> {
    const timeoutMs = o.timeoutMs ?? TRACE_TIMEOUT_MS;
    return traceOf(await this.run('trace', src, opts, timeoutMs, o.signal), opts, timeoutMs);
  }

  /** Stops the worker and fails every waiting run. */
  dispose() {
    for (const j of this.queue.splice(0)) (j.cleanup(), j.reject(new CancelledError()));
    if (this.running) this.finish(this.running, undefined, new CancelledError());
    this.kill(false);
  }

  private run(kind: Job['kind'], src: string, opts: SimOptions, timeoutMs: number, signal?: AbortSignal): Promise<VmReply> {
    if (signal?.aborted) return Promise.reject(new CancelledError());
    return new Promise<VmReply>((resolve, reject) => {
      const job: Job = { id: this.nextId++, kind, src: String(src), opts: JSON.stringify(opts), timeoutMs, signal, resolve, reject, cleanup: () => signal?.removeEventListener('abort', onAbort) };
      const onAbort = () => this.cancel(job);
      signal?.addEventListener('abort', onAbort);
      this.queue.push(job);
      this.pump();
    });
  }

  private cancel(job: Job) {
    const i = this.queue.indexOf(job);
    if (i >= 0) {
      this.queue.splice(i, 1);
      job.cleanup();
      job.reject(new CancelledError());
      return;
    }
    if (this.running !== job) return;
    // Already running: most runs take milliseconds, so let it finish; a long one is stopped.
    clearTimeout(this.cancelTimer);
    this.cancelTimer = setTimeout(() => {
      if (this.running !== job) return;
      this.finish(job, undefined, new CancelledError());
      this.kill(true);
      this.pump();
    }, CANCEL_GRACE_MS);
  }

  private start(): Worker {
    const w = new Worker(this.code, { eval: true, workerData: { sandbox: this.sandbox }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    this.started++;
    w.on('message', (m: { id: number; reply: VmReply }) => {
      const job = this.running;
      if (!job || job.id !== m.id || w !== this.worker) return;
      this.finish(job, m.reply);
      this.pump();
    });
    const died = (why: string) => {
      if (w !== this.worker) return;
      this.worker = undefined;
      const job = this.running;
      if (job) this.finish(job, { ok: false, error: why });
      this.pump();
    };
    w.on('error', (e: any) => died(e?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'The handler used too much memory (over 512 MB) and was stopped. Nucleus would likely crash here.' : `The simulator stopped: ${e?.message ?? e}`));
    w.on('exit', () => died('The simulator stopped unexpectedly.'));
    return w;
  }

  private pump() {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) {
      this.worker?.unref(); // idle: never keeps the process alive
      return;
    }
    this.running = job;
    const w = (this.worker ??= this.start());
    w.ref(); // a run is waiting for its answer
    // The hard limit: vm's timeout should answer first; if it doesn't, stop the worker.
    this.hardTimer = setTimeout(() => {
      if (this.running !== job) return;
      this.finish(job, { ok: false, error: 'Script execution timed out (the simulator was stopped).' });
      this.kill(true);
      this.pump();
    }, job.timeoutMs + this.hardGraceMs);
    w.postMessage({ id: job.id, kind: job.kind, src: job.src, opts: job.opts, timeoutMs: job.timeoutMs });
  }

  private finish(job: Job, reply: VmReply | undefined, error?: unknown) {
    if (this.running === job) this.running = undefined;
    clearTimeout(this.hardTimer);
    clearTimeout(this.cancelTimer);
    job.cleanup();
    if (reply) job.resolve(reply);
    else job.reject(error);
  }

  private kill(count: boolean) {
    const w = this.worker;
    this.worker = undefined;
    if (!w) return;
    if (count) this.killed++;
    void w.terminate();
  }
}

let shared: SimWorker | undefined;
/** The process's one simulator worker. */
export const simWorker = (): SimWorker => (shared ??= new SimWorker());

export interface MatrixProgress {
  done: number;
  total: number;
}

/** "Test all combinations" through the worker: in batches (queued together, so the worker never waits on
 *  the main thread), with progress after each batch and cancellation between runs. After `maxTimeouts`
 *  runs that didn't finish, the rest are marked as not run instead of waiting seconds for each. */
export async function runMatrixInWorker(
  plan: MatrixPlan,
  src: string,
  base: Partial<SimOptions> = {},
  o: { signal?: AbortSignal; onProgress?: (p: MatrixProgress) => void; batch?: number; worker?: SimWorker; timeoutMs?: number; maxTimeouts?: number } = {},
): Promise<MatrixResult & { timedOut: number; skipped: number }> {
  const worker = o.worker ?? simWorker();
  const batch = o.batch ?? 8;
  const maxTimeouts = o.maxTimeouts ?? 2;
  const cells = new Map<string, MatrixFail[]>();
  let failed = 0;
  let timedOut = 0;
  let skipped = 0;
  const total = plan.jobs.length;
  for (let i = 0; i < total; i += batch) {
    if (o.signal?.aborted) throw new CancelledError();
    const slice = plan.jobs.slice(i, i + batch);
    const results =
      timedOut >= maxTimeouts
        ? slice.map(() => undefined)
        : await Promise.all(slice.map((j) => worker.simulate(src, jobOptions(j, base), { signal: o.signal, timeoutMs: o.timeoutMs })));
    slice.forEach((j, k) => {
      const key = `${j.players}|${j.kb}`;
      const list = cells.get(key) ?? [];
      const r = results[k];
      const why = r ? failureOf(r) : 'Not run: earlier combinations did not finish in time.';
      if (!r) skipped++;
      else if (isTimeout(r)) timedOut++;
      if (why) (list.push({ width: j.width, height: j.height, why }), failed++);
      cells.set(key, list);
    });
    o.onProgress?.({ done: Math.min(total, i + batch), total });
  }
  return { plan, cells, failed, timedOut, skipped };
}
