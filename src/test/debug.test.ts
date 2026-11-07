import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceHandler, nextStop, evaluateWatch, describeStep, instrument, callsBefore, packTrace, unpackTrace } from '../core/debug';
import type { Trace } from '../core/debug';
import { simulate } from '../core/sim';
import { traceIsolated, simulateIsolated } from '../sandbox';
import { renderHandler, FEATURES } from '../core/templates';

const HEADER = 'Game.GUID = "My Game";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";\n';
const OPTS = { players: 2, width: 1920, height: 1080, keyboardPlayer: 0 };

// Line numbers below refer to this handler (HEADER is lines 1-3).
const SRC =
  HEADER +
  'var count = 0;\n' + // 4
  'function helper(x) {\n' + // 5
  '  var y = x * 2;\n' + // 6
  '  return y;\n' + // 7
  '}\n' + // 8
  'Game.Play = function () {\n' + // 9
  '  var a = helper(Context.PlayerID);\n' + // 10
  '  if (a > 0) Context.StartArguments = "-p " + a; else count++;\n' + // 11
  '  Context.ModifySaveFile("a.ini", "a.ini", Nucleus.SaveType.INI, [new Nucleus.IniSaveInfo("Video", "Fullscreen", "0")]);\n' + // 12
  '};\n' + // 13
  'Game.OnStop = function () { var z = count; null.x; };\n'; // 14

const lines = (t: Trace) => t.steps.map((s) => s.line);

test('debug: records every statement in order, per phase and player', () => {
  const t = traceIsolated(SRC, OPTS);
  assert.equal(t.error, undefined);
  assert.deepEqual(lines(t), [1, 2, 3, 4, 9, 14, 10, 6, 7, 11, 11, 12, 10, 6, 7, 11, 11, 12, 14, 14, 14]);
  assert.deepEqual(t.steps[0].phase, { kind: 'top', name: 'top of the file' });
  assert.deepEqual(t.steps[6].phase, { kind: 'play', name: 'Game.Play', player: 0, players: 2 });
  assert.deepEqual(t.steps[12].phase, { kind: 'play', name: 'Game.Play', player: 1, players: 2 });
  assert.equal(t.steps[18].phase.name, 'Game.OnStop');
  assert.equal(t.steps[18].phase.player, 1); // sees the last player's Context
  assert.equal(describeStep(t.steps[13]), 'Paused before line 6 for player 2 of 2, in Game.Play, inside helper().');
  assert.match(describeStep(t.steps[0]), /^Paused before line 1 while Nucleus loads the handler/);
});

test('debug: locals, globals, Context, Player, Game options and the call stack', () => {
  const t = traceIsolated(SRC, OPTS);
  const inHelper = t.steps[14]; // line 7, player 2
  assert.deepEqual(Object.keys(inHelper.locals), ['x', 'y']);
  assert.equal(inHelper.locals.x.value, 1);
  assert.equal(inHelper.locals.y.value, 2);
  assert.equal(inHelper.depth, 2);
  assert.deepEqual(inHelper.stack, [{ name: 'helper', line: 7 }, { name: 'Game.Play', line: 10 }]);
  assert.equal(inHelper.globals.count.value, 1); // player 1 took the else branch
  assert.equal(inHelper.globals.helper.type, 'function');
  assert.equal(inHelper.context!.PlayerID.value, 1);
  assert.equal(inHelper.context!.Width.value, 960);
  assert.equal(inHelper.player!.Nickname.value, 'Player2');
  assert.equal(inHelper.options['Game.GUID'].value, 'My Game');
  assert.equal(t.steps[0].context, undefined); // no Context while loading
  assert.deepEqual(t.steps[0].stack, [{ name: 'top of the file', line: 1 }]);
  const afterIf = t.steps[17]; // line 12 for player 2: StartArguments set by line 11
  assert.equal(afterIf.context!.StartArguments.value, '-p 2');
  assert.equal(afterIf.locals.a.text, '2');
});

test('debug: breakpoints, conditional ones and stepping over/into/out across a helper', () => {
  const t = traceIsolated(SRC, OPTS);
  const first = nextStop(t, -1, { mode: 'continue', breakpoints: [{ line: 10 }] })!;
  assert.equal(first.index, 6);
  assert.equal(first.reason, 'breakpoint');
  const second = nextStop(t, first.index, { mode: 'continue', breakpoints: [{ line: 10 }] })!;
  assert.equal(t.steps[second.index].phase.player, 1);
  assert.equal(nextStop(t, second.index, { mode: 'continue', breakpoints: [{ line: 10 }] }), null);
  // Conditional on the player
  const cond = nextStop(t, -1, { mode: 'continue', breakpoints: [{ line: 10, condition: 'Context.PlayerID == 1' }] })!;
  assert.equal(cond.index, 12);
  assert.equal(nextStop(t, -1, { mode: 'continue', breakpoints: [{ line: 7, condition: 'y > 1 && x === 1' }] })!.index, 14);
  const bad = nextStop(t, -1, { mode: 'continue', breakpoints: [{ line: 10, condition: 'Context.PlayerID ==' }] })!;
  assert.ok(bad.conditionError);
  // A line with two statements stops once
  assert.equal(nextStop(t, 9, { mode: 'continue', breakpoints: [{ line: 11 }] })!.index, 15);
  // over steps past the helper, into enters it, out leaves it
  assert.equal(t.steps[nextStop(t, 6, { mode: 'over' })!.index].line, 11);
  assert.equal(t.steps[nextStop(t, 6, { mode: 'into' })!.index].line, 6);
  const out = nextStop(t, 7, { mode: 'out' })!;
  assert.equal(t.steps[out.index].line, 11);
  assert.equal(t.steps[out.index].depth, 1);
  // Stepping over the last line of Game.Play goes to the next player's
  const next = nextStop(t, 11, { mode: 'over' })!;
  assert.deepEqual([t.steps[next.index].line, t.steps[next.index].phase.player], [10, 1]);
  // Backwards
  assert.equal(nextStop(t, 7, { mode: 'back' })!.index, 6);
  assert.equal(nextStop(t, 0, { mode: 'back' }), null);
  assert.equal(nextStop(t, 14, { mode: 'reverse', breakpoints: [{ line: 10 }] })!.index, 12);
});

test('debug: stops where an error ends a phase', () => {
  const t = traceIsolated(SRC, OPTS);
  const err = nextStop(t, -1, { mode: 'continue', stopOnErrors: true })!;
  assert.equal(err.reason, 'error');
  const s = t.steps[err.index];
  assert.equal(s.line, 14);
  assert.equal(s.phase.name, 'Game.OnStop');
  assert.match(s.error!, /TypeError/);
  assert.match(describeStep(s), /^Stopped at line 14 in Game.OnStop .*: TypeError: .*Nucleus skips its cleanup/);
  assert.equal(nextStop(t, -1, { mode: 'continue' }), null); // without stopOnErrors
  // Stepping always stops there
  assert.equal(nextStop(t, err.index - 1, { mode: 'over' })!.reason, 'error');
  // A throwing Game.Play for player 1
  const play = traceIsolated(HEADER + 'Game.Play = function () {\n  var k = 1;\n  Game.KillMutex = "x";\n};\n', OPTS);
  const e = play.steps.find((x) => x.error)!;
  assert.equal(e.line, 6);
  assert.equal(e.locals.k.value, 1);
  assert.match(describeStep(e), /for player 1 of 2, in Game\.Play: Jint: .*Nucleus ends the session here\.$/);
  // A load error
  const load = traceIsolated(HEADER + 'var q = 1;\nnope();\n', OPTS);
  assert.match(load.error!, /nope is not defined/);
  assert.equal(load.steps.at(-1)!.line, 5);
  assert.ok(load.steps.at(-1)!.error);
});

test('debug: what the handler did so far', () => {
  const t = traceIsolated(SRC, OPTS);
  assert.equal(callsBefore(t, 11).length, 0);
  assert.deepEqual(callsBefore(t, 12).map((c) => c.effect), ['Changes a.ini: Fullscreen = 0']);
  assert.equal(t.calls[0].step, 11);
  assert.equal(t.calls.length, 2);
});

test('debug: watch expressions read recorded values only', () => {
  const t = traceIsolated(SRC, OPTS);
  const at = 14;
  assert.equal(evaluateWatch(t, at, 'x + y').value!.value, 3);
  assert.equal(evaluateWatch(t, at, 'Context.width').value!.value, 960); // Jint's first-letter rule
  assert.equal(evaluateWatch(t, at, 'Player.MonitorBounds.X').value!.value, 960);
  assert.equal(evaluateWatch(t, at, 'Game.GUID.length').value!.value, 7);
  assert.equal(evaluateWatch(t, at, 'Game.SymlinkGame').value!.type, 'default');
  assert.equal(evaluateWatch(t, at, 'Context.PlayerID === 1 ? "two" : "one"').value!.value, 'two');
  assert.match(evaluateWatch(t, at, 'helper(1)').error!, /Calling a function isn't allowed/);
  assert.match(evaluateWatch(t, at, 'x = 5').error!, /Changing a value isn't allowed/);
  assert.match(evaluateWatch(t, at, 'nothing').error!, /isn't defined here/);
  assert.match(evaluateWatch(t, 0, 'Context.PlayerID').error!, /Nucleus sets it for Game\.Play/);
});

test('debug: the result is the same as simulate() gives', () => {
  const handlers = [
    SRC,
    HEADER + 'Game.SymlinkGame = true;\nGame.Play = function () {\n  Context.StartArguments = "-w " + Context.Width;\n  System.IO.File.Copy("a.txt", "b.txt");\n};\nGame.OnFinishedSetup = function () { Context.Log("done"); };\n',
    HEADER + '"use strict";\nGame.Play = function () { if (Context.PlayerID === 1) throw new Error("no"); };\n',
    HEADER + 'Game.Play = function () {\n  outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j == 1) continue outer; if (i == 2) break outer; } }\n  switch (Context.PlayerID) { case 0: Context.StartArguments = "a"; break; default: Context.StartArguments = "b" }\n  try { null.x; } catch (e) { Context.StartArguments += e.name; } finally { Context.StartArguments += "!"; }\n  var o = { get v() { return 1; }, f: function () { return this.v; } };\n  do Context.StartArguments += o.f(); while (false)\n  var s = 0; while (s < 2) s++;\n};\n',
    HEADER + 'Game.Play = function () { "use strict"; let a = 1; const b = 2; Context.StartArguments = "" + (a + b); };\n',
    ...FEATURES.map((f) => renderHandler({ gameName: 'Halo: Reach', executableName: 'MCC-Win64-Shipping.exe', steamId: '976730', features: [f.id] })),
  ];
  for (const src of handlers) {
    for (const opts of [OPTS, { ...OPTS, players: 3, keyboardPlayer: -1 }]) {
      const t = traceIsolated(src, opts);
      assert.deepEqual(t.result, simulateIsolated(src, opts), src);
      assert.ok(t.steps.length > 0);
      assert.deepEqual(traceHandler(src, opts).result, simulate(src, opts));
    }
  }
  const t = traceIsolated(handlers[3], OPTS);
  assert.deepEqual(t.result.players.map((p) => p.startArguments), ['aTypeError!1', 'bTypeError!1']);
  // The getter wasn't run by the debugger: shown, not evaluated
  const withO = t.steps.find((s) => s.locals.o?.children)!;
  assert.equal(withO.locals.o.children!.v.type, 'getter');
});

test('debug: instrumentation keeps the source parseable and hooks every statement', () => {
  const i = instrument('if (a) b(); else if (c) d();\nfor (;;) break;\nfunction f() { "use strict"; return 1; }\nvar e = function () {}, g = function () { "use strict" };\n')!;
  assert.ok(i);
  assert.match(i.code, /"use strict"; __dbg\.e\(0\); try \{/); // the directive stays first
  assert.deepEqual(i.stmts.map((s) => s.line), [1, 1, 1, 1, 2, 2, 3, 4]);
  assert.equal(instrument('this is not javascript'), null);
});

test('debug: long runs are truncated per phase, later players still recorded', () => {
  const src = HEADER + 'Game.Play = function () {\n  var t = 0;\n  for (var i = 0; i < 400; i++) t += i;\n  Context.StartArguments = "" + t;\n};\n';
  const t = traceIsolated(src, { ...OPTS, maxStepsPerPhase: 50 });
  assert.equal(t.truncated, true);
  assert.deepEqual(t.truncatedPhases, ['for player 1 of 2, in Game.Play', 'for player 2 of 2, in Game.Play']);
  assert.ok(t.steps.some((s) => s.phase.player === 1));
  assert.deepEqual(t.result.players.map((p) => p.startArguments), ['79800', '79800']); // the run itself went on
  const total = traceIsolated(src, { ...OPTS, maxSteps: 30 });
  assert.equal(total.steps.length, 30);
  assert.equal(total.truncated, true);
});

test('debug: an endless loop gives what was recorded before the time limit', () => {
  const t = traceIsolated(HEADER + 'var n = 0;\nGame.Play = function () { while (true) { n++; } };\n', { ...OPTS, maxStepsPerPhase: 100 }, 300);
  assert.match(t.error!, /did not finish/);
  assert.equal(t.result.loaded, false);
  assert.ok(t.steps.length > 50);
  // The next run works
  assert.equal(traceIsolated(HEADER + 'Game.Play = function () { Context.StartArguments = "ok"; };\n', OPTS).result.players[0].startArguments, 'ok');
});

test('debug: packTrace/unpackTrace round trip', () => {
  const t = traceHandler(SRC, OPTS);
  assert.deepEqual(unpackTrace(packTrace(t)), JSON.parse(JSON.stringify(t)));
});

test('debug: handler code still cannot reach Node, also through the debugger hooks', () => {
  const F = "return typeof process !== 'undefined' ? 'PROCESS' : typeof require !== 'undefined' ? 'REQUIRE' : 'none'";
  const src =
    HEADER +
    `var report = [];\nvar F = ${JSON.stringify(F)};\nfunction probe(f) { try { report.push(f()); } catch (e) { report.push('blocked'); } }\n` +
    'probe(function () { return __dbg.constructor.constructor(F)(); });\n' +
    'probe(function () { return __dbg.s.constructor(F)(); });\n' +
    'probe(function () { return this.constructor.constructor(F)(); });\n' +
    'Game.Play = function () {\n  probe(function () { return Context.constructor.constructor(F)(); });\n  Context.StartArguments = report.join(" ");\n};\n';
  const t = traceIsolated(src, { ...OPTS, players: 1 });
  const results = t.result.players[0].startArguments.split(' ');
  assert.equal(results.length, 4);
  assert.ok(results.every((x) => x === 'none' || x === 'blocked'), results.join(' '));
});
