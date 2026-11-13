// The simulator's worker thread (src/simworker.ts): runs never block the main thread, can be cancelled,
// a stuck worker is stopped and replaced, and handler code still can't reach Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimWorker, isCancelled, runMatrixInWorker } from '../simworker';
import { simulateIsolated, isTimeout } from '../sandbox';
import { planMatrix } from '../core/matrix';

const HEADER = 'Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\n';
const OPTS = { players: 2, width: 1920, height: 1080, keyboardPlayer: 0 };
const LOOP = HEADER + 'Game.Play = function () { while (true) {} };\n';
const OK = HEADER + 'Game.Play = function () { Context.StartArguments = "-id " + Context.PlayerID; };\n';

test('worker: the same results as the synchronous sandbox', async () => {
  const w = new SimWorker();
  try {
    assert.deepEqual(await w.simulate(OK, OPTS), simulateIsolated(OK, OPTS));
    const t = await w.trace(OK, OPTS);
    assert.equal(t.result.players[1].startArguments, '-id 1');
    assert.ok(t.steps.length > 0);
  } finally {
    w.dispose();
  }
});

test('worker: the main thread stays responsive while a handler loops', async () => {
  const w = new SimWorker();
  try {
    await w.simulate(OK, OPTS); // warm up: worker started, simulator loaded
    // A 10 ms timer on the main thread, while the handler loops for 1.5 s in the worker.
    let ticks = 0;
    let worstGap = 0;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      worstGap = Math.max(worstGap, now - last);
      last = now;
      ticks++;
    }, 10);
    const t0 = Date.now();
    const r = await w.simulate(LOOP, OPTS, { timeoutMs: 1500 });
    const took = Date.now() - t0;
    clearInterval(timer);
    assert.ok(isTimeout(r), r.loadError);
    assert.ok(took >= 1400, `ran ${took} ms`);
    assert.ok(ticks >= 50, `the timer fired ${ticks} times in ${took} ms`);
    assert.ok(worstGap < 200, `the longest the main thread was blocked: ${worstGap} ms`);
    console.log(`# main thread while a handler looped ${took} ms: timer fired ${ticks}× (every 10 ms), longest gap ${worstGap} ms`);
    // The synchronous sandbox, for comparison, blocks the whole time.
    let syncTicks = 0;
    const t2 = setInterval(() => syncTicks++, 10);
    simulateIsolated(LOOP, OPTS, 300);
    await new Promise((r) => setImmediate(r));
    clearInterval(t2);
    assert.ok(syncTicks <= 1, `synchronous: ${syncTicks}`);
    // And the worker still works afterwards.
    assert.equal((await w.simulate(OK, OPTS)).players[0].startArguments, '-id 0');
  } finally {
    w.dispose();
  }
});

test('worker: a newer run cancels the older ones; a cancelled endless loop is stopped quickly', async () => {
  const w = new SimWorker();
  try {
    await w.simulate(OK, OPTS);
    const old = new AbortController();
    const looping = w.simulate(LOOP, OPTS, { signal: old.signal, timeoutMs: 10_000 });
    const queued = w.simulate(OK, OPTS, { signal: old.signal });
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    const both = Promise.all([assert.rejects(looping, (e) => isCancelled(e)), assert.rejects(queued, (e) => isCancelled(e))]);
    old.abort();
    await both;
    const r = await w.simulate(OK, OPTS);
    assert.equal(r.players[0].startArguments, '-id 0');
    assert.ok(Date.now() - t0 < 2000, `the next run waited ${Date.now() - t0} ms`);
    assert.equal(w.killed, 1, 'the looping worker was stopped');
    // Already aborted: never queued.
    await assert.rejects(w.simulate(OK, OPTS, { signal: AbortSignal.abort() }), (e) => isCancelled(e));
  } finally {
    w.dispose();
  }
});

test('worker: a worker that never answers is stopped by the hard limit and replaced', async () => {
  // Stands in for anything vm's own timeout misses: a worker stuck outside the vm.
  const w = new SimWorker('require("node:worker_threads").parentPort.on("message", () => { for (;;) {} });', '');
  w.hardGraceMs = 400;
  try {
    const t0 = Date.now();
    const r = await w.simulate(OK, OPTS, { timeoutMs: 100 });
    const took = Date.now() - t0;
    assert.ok(isTimeout(r), r.loadError);
    assert.ok(took < 100 + 400 + 1000, `${took} ms`);
    assert.equal(w.killed, 1);
    await w.simulate(OK, OPTS, { timeoutMs: 100 });
    assert.equal(w.started, 2, 'a fresh worker for the next run');
  } finally {
    w.dispose();
  }
});

test('worker: a handler that eats memory only takes the worker down', async () => {
  const w = new SimWorker();
  try {
    const r = await w.simulate(HEADER + 'var a = [];\nGame.Play = function () { for (;;) { var b = []; for (var i = 0; i < 1000000; i++) b.push(i * 1.5); a.push(b); } };\n', OPTS, { timeoutMs: 20_000 });
    assert.equal(r.loaded, false);
    assert.match(r.loadError!, /too much memory/);
    assert.equal((await w.simulate(OK, OPTS)).players[0].startArguments, '-id 0');
  } finally {
    w.dispose();
  }
});

test('worker: handler code still cannot reach Node (or the worker)', async () => {
  const w = new SimWorker();
  try {
    const probe = [
      'typeof process',
      'typeof require',
      'typeof postMessage',
      'typeof self',
      'typeof importScripts',
      '(function () { try { return typeof this.constructor.constructor("return process")(); } catch (e) { return "blocked"; } })()',
      '(function () { try { return typeof Game.constructor.constructor("return require")(); } catch (e) { return "blocked"; } })()',
      '(function () { try { return typeof Context.constructor.constructor("return globalThis.process")(); } catch (e) { return "blocked"; } })()',
    ].join(' + "," + ');
    const r = await w.simulate(HEADER + `Game.Play = function () { Context.StartArguments = ${probe}; };\n`, { ...OPTS, players: 1 });
    const parts = r.players[0].startArguments.split(',');
    assert.deepEqual(parts.slice(0, 5), ['undefined', 'undefined', 'undefined', 'undefined', 'undefined'], r.players[0].startArguments);
    for (const p of parts.slice(5)) assert.ok(p === 'undefined' || p === 'blocked', r.players[0].startArguments);
  } finally {
    w.dispose();
  }
});

test('worker: Test all in batches, with progress, cancellation and a stop after timeouts', async () => {
  const w = new SimWorker();
  try {
    const plan = planMatrix(await w.simulate(OK, { players: 1, width: 1920, height: 1080, keyboardPlayer: -1 }))!;
    const progress: number[] = [];
    const m = await runMatrixInWorker(plan, OK, {}, { worker: w, batch: 5, onProgress: (p) => progress.push(p.done) });
    assert.equal(m.failed, 0);
    assert.equal(progress.at(-1), plan.jobs.length);
    assert.ok(progress.length >= plan.jobs.length / 5);

    const ac = new AbortController();
    const run = runMatrixInWorker(plan, OK, {}, { worker: w, batch: 2, signal: ac.signal, onProgress: (p) => p.done >= 4 && ac.abort() });
    await assert.rejects(run, (e) => isCancelled(e));

    // A handler that loops for every combination: two timeouts, then the rest are not run.
    const loopPlan = { ...plan, jobs: plan.jobs.slice(0, 6) };
    const t0 = Date.now();
    const looped = await runMatrixInWorker(loopPlan, LOOP, {}, { worker: w, batch: 1, timeoutMs: 200 });
    assert.equal(looped.timedOut, 2);
    assert.equal(looped.skipped, 4);
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    w.dispose();
  }
});
