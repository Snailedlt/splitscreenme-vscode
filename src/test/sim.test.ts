import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { simulate } from '../core/sim';
import { simulateIsolated } from '../sandbox';

const HEADER = 'Game.GUID = "My Game";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";\n';
const OPTS = { players: 2, width: 1920, height: 1080, keyboardPlayer: 0 };

test('simulate: launch arguments, windows, file changes and skipped settings', () => {
  const r = simulateIsolated(
    HEADER +
      'Game.IgnoreWindowBordercheck = true;\nGame.Play = function () {\n  Context.StartArguments = "-w " + Context.width;\n' +
      '  Context.ModifySaveFile("a.ini", "a.ini", Nucleus.SaveType.INI, [new Nucleus.IniSaveInfo("Video", "Fullscreen", "0")]);\n};\n',
    OPTS,
  );
  assert.equal(r.loaded, true);
  assert.deepEqual(r.players.map((p) => p.startArguments), ['-w 960', '-w 960']); // first-letter-insensitive, like Jint
  assert.match(r.players[0].window, /left half/);
  assert.deepEqual(r.players[0].effects, ['Changes a.ini: Fullscreen = 0']);
  assert.match(r.ignored[0], /IgnoreWindowBordercheck/);
});

test('simulate: Player.MonitorBounds is the player\'s screen region, like Context.PosX/Width', () => {
  const r = simulateIsolated(HEADER + 'Game.Play = function () { var b = Player.MonitorBounds; Context.StartArguments = [b.X, b.y, b.Width, b.Right, Context.PosX, Player.OwnerDisplay.Width].join(","); };\n', OPTS);
  assert.deepEqual(r.players.map((p) => p.startArguments), ['0,0,960,960,0,1920', '960,0,960,1920,960,1920']);
});

test('simulate: failures Nucleus would hit', () => {
  assert.match(simulateIsolated(HEADER + 'Game.KillMutex = "x";\n', OPTS).loadError!, /object\[\] type is expected/);
  assert.match(simulateIsolated(HEADER + 'Context.StartArguments = "";\n', OPTS).loadError!, /Context is not defined/);
  const builtin = simulateIsolated(HEADER + 'Game.Play = function () { if ("abc".includes("b")) {} };\n', OPTS);
  assert.equal(builtin.players[0].error, "Jint: Object has no method 'includes'");
  assert.equal(simulateIsolated(HEADER + 'Game.Play = function () { var t = typeof Map; const c = 1; c = 2; Context.StartArguments = t + c; };\n', OPTS).players[0].startArguments, 'undefined2');
});

// Handler code must not reach Node: a Hub handler opened in VS Code or run by an agent could
// otherwise read or delete files. Every object the simulator hands to the handler is tried.
const ESCAPES = `var report = [];
var F = "return typeof process !== 'undefined' ? 'PROCESS' : typeof require !== 'undefined' ? 'REQUIRE' : 'none'";
function probe(f) { try { report.push(f()); } catch (e) { report.push('blocked'); } }
probe(function () { return this.constructor.constructor(F)(); });
probe(function () { return Game.constructor.constructor(F)(); });
probe(function () { return Object.getPrototypeOf(Game).constructor.constructor(F)(); });
probe(function () { return Nucleus.constructor.constructor(F)(); });
probe(function () { return System.IO.File.Exists("x").constructor.constructor(F)(); });
probe(function () { return importNamespace.constructor(F)(); });
probe(function () { return new Nucleus.IniSaveInfo("a", "b", "c").constructor.constructor(F)(); });
Game.Play = function () {
  probe(function () { return Context.constructor.constructor(F)(); });
  probe(function () { return Context.GetFolder.constructor(F)(); });
  probe(function () { return PlayerList.constructor.constructor(F)(); });
  probe(function () { return Player.constructor.constructor(F)(); });
  probe(function () { try { Context.GetFolder(); } catch (e) { return e.constructor.constructor(F)(); } });
  probe(function () { var a = []; Context.ModifySaveFile("a", "b", 1, a); return a.constructor.constructor(F)(); });
  Context.StartArguments = report.join(" ");
};
`;

test('simulateIsolated: handler code cannot reach Node', () => {
  const r = simulateIsolated(HEADER + ESCAPES, { ...OPTS, players: 1 });
  assert.equal(r.loaded, true, r.loadError);
  const results = r.players[0].startArguments.split(' ');
  assert.equal(results.length, 13);
  assert.ok(results.every((x) => x === 'none' || x === 'blocked'), results.join(' '));
});

test('control: without isolation the same handler does reach Node (why simulateIsolated exists)', () => {
  const r = simulate(HEADER + ESCAPES, { ...OPTS, players: 1 });
  assert.match(r.players[0].startArguments, /PROCESS/);
});

test('simulateIsolated: a handler that never finishes times out, and the next run works', () => {
  const r = simulateIsolated(HEADER + 'Game.Play = function () { while (true) {} };\n', OPTS, 300);
  assert.equal(r.loaded, false);
  assert.match(r.loadError!, /did not finish/);
  assert.equal(simulateIsolated(HEADER + 'Game.Play = function () { Context.StartArguments = "ok"; };\n', OPTS).players[0].startArguments, 'ok');
});

test('nucleus simulate (CLI)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-sim-'));
  const ok = path.join(dir, 'ok.js');
  fs.writeFileSync(ok, HEADER + 'Game.Play = function () { Context.StartArguments = "-p " + Context.PlayerID; };\n');
  const bad = path.join(dir, 'bad.js');
  fs.writeFileSync(bad, HEADER + 'Game.Play = function () { [1].find(function () {}); };\n');
  const cli = path.join(__dirname, '..', 'dist', 'cli.js');
  const r = spawnSync(process.execPath, [cli, 'simulate', ok, '--players', '3', '--keyboard', 'none'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Player 3 \(controller\)/);
  assert.match(r.stdout, /Starts with: {2}-p 2/);
  const j = spawnSync(process.execPath, [cli, 'simulate', bad, '--json'], { encoding: 'utf8' });
  assert.equal(j.status, 1);
  assert.equal(JSON.parse(j.stdout).players[0].error, "Jint: Object has no method 'find'");
  assert.equal(spawnSync(process.execPath, [cli, 'simulate', ok, '--keyboard', '5'], { encoding: 'utf8' }).status, 2);
});
