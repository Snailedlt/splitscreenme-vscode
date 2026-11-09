// The worker thread of src/simworker.ts, bundled to a string (`__SIM_WORKER__`, scripts/build.mjs) and
// started with `eval: true`, so it works from any bundle, the standalone ncdev included (a Node single
// executable has no separate files to point a worker at). It only owns the vm sandbox
// (src/sandbox-vm.ts): handler code still runs only inside the vm context, now in this thread.
import { parentPort, workerData } from 'node:worker_threads';
import { vmRunner } from './sandbox-vm';

const run = vmRunner(String(workerData.sandbox));
parentPort!.on('message', (m: { id: number; kind: 'simulate' | 'trace'; src: string; opts: string; timeoutMs: number }) => {
  const reply = m.kind === 'trace' ? run.trace(m.src, m.opts, m.timeoutMs) : run.simulate(m.src, m.opts, m.timeoutMs);
  parentPort!.postMessage({ id: m.id, reply });
});
