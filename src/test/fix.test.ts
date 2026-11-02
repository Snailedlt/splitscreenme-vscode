import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { lint } from '../core/lint';
import { fixAll } from '../core/fix';

const HEADER = 'Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\n';
const es5 = (code: string) => acorn.parse(code, { ecmaVersion: 5, allowReturnOutsideFunction: true });
const errors = (code: string) => lint(code).filter((d) => d.severity === 'error');

test('arrow functions become function expressions', () => {
  const src = HEADER + 'var a = [1].map(x => x * 2);\nvar b = [1].map((x, i) => { return x + i; });\nvar c = () => ({ k: 1 });\nvar d = (y) => (z) => y + z;\n';
  const r = fixAll(src);
  es5(r.code);
  assert.match(r.code, /var a = \[1\]\.map\(function \(x\) \{ return x \* 2; \}\);/);
  assert.match(r.code, /var b = \[1\]\.map\(function \(x, i\) \{ return x \+ i; \}\);/);
  assert.match(r.code, /var c = function \(\) \{ return \(\{ k: 1 \}\); \};/);
  assert.match(r.code, /var d = function \(y\) \{ return function \(z\) \{ return y \+ z; \}; \};/);
  assert.deepEqual(errors(r.code), []);
});

test('arrows using `this` or `arguments` are not converted', () => {
  const r = fixAll(HEADER + 'var o = { f: function () { return () => this.x; } };\n');
  assert.match(r.code, /=> this\.x/);
  assert.equal(errors(r.code).length, 1);
});

test('shorthand properties, methods, optional catch, **, ?? and default parameters', () => {
  const src =
    HEADER +
    'var a = 1;\nvar o = { a, f(x) { return x; } };\ntry { a = 2; } catch { a = 3; }\nvar p = a ** 2;\nvar q = Game.SteamID ?? "0";\nfunction g(n = 5, m) {\n  return n + m;\n}\n';
  const r = fixAll(src);
  es5(r.code);
  assert.match(r.code, /var o = \{ a: a, f: function \(x\) \{ return x; \} \};/);
  assert.match(r.code, /catch \(e\) \{/);
  assert.match(r.code, /var p = Math\.pow\(a, 2\);/);
  assert.match(r.code, /var q = \(Game\.SteamID !== null && Game\.SteamID !== undefined \? Game\.SteamID : "0"\);/);
  assert.match(r.code, /function g\(n, m\) \{\n {2}if \(n === undefined\) \{ n = 5; \}\n {2}return n \+ m;/);
  assert.deepEqual(errors(r.code), []);
});

test('top-level Context use moves into the existing Game.Play, in order', () => {
  const src = HEADER + 'var w = Context.Width;\nvar h = w / 2;\nContext.Log("hi");\nGame.MaxPlayers = 4;\nGame.Play = function () {\n  Context.StartArguments = "-w " + w;\n};\n';
  const r = fixAll(src);
  es5(r.code);
  assert.deepEqual(errors(r.code), []);
  assert.match(r.code, /var w;\nvar h;\nGame\.MaxPlayers = 4;\nGame\.Play = function \(\) \{\n {2}w = Context\.Width;\n {2}h = w \/ 2;\n {2}Context\.Log\("hi"\);\n {2}Context\.StartArguments/);
});

test('top-level Context use creates Game.Play when there is none', () => {
  const r = fixAll(HEADER + 'var w = Context.Width;\n');
  es5(r.code);
  assert.deepEqual(errors(r.code), []);
  assert.match(r.code, /var w;\n\nGame\.Play = function \(\) \{\n {2}w = Context\.Width;\n\};\n$/);
});

test('no move fix when a Game option depends on the moved code', () => {
  const src = HEADER + 'var w = Context.Width;\nGame.StartArguments = "-w " + w;\n';
  const d = errors(src).find((x) => x.rule === 'callback-only-global')!;
  assert.equal(d.fixes, undefined);
});

test('a trailing comment with quotes on the GameName line moves above it', () => {
  const src = 'Game.GUID = "A";\nGame.GameName = "My Game"; // not "Other"\nGame.ExecutableName = "a.exe";\n';
  const r = fixAll(src);
  assert.equal(r.code, 'Game.GUID = "A";\n// not "Other"\nGame.GameName = "My Game";\nGame.ExecutableName = "a.exe";\n');
  assert.deepEqual(lint(r.code).filter((d) => d.rule === 'hub-install-parse'), []);
});

test('fixAll on a handler full of mistakes', () => {
  const src = `Game.GameName = 'Buggy Game';
  Game.GUID = "Buggy: Game!";
Game.ExecutableName = "buggy.exe";
Game.MaxPlayers = 4;
Game.KillMutex = "BuggyMutex";
Game.IgnoreWindowBordercheck = true;
Game.SymlinkGame = "true";
Game.DPIHandling = true;
Game.MaxPlayers = 8;

var width = Context.Width;

Game.Play = function () {
  const args = \`-windowed -w \${width}\`;
  Context.StartArguments = args + " -id " + Context.PLayerID;
  for (var i = 0; i < PlayerList.Count; i++) {
    var player = PlayerList[i];
    player.ProtoController1 = Context.GamepadId;
  }
};
`;
  const before = lint(src).filter((d) => d.severity === 'error' || d.severity === 'warning').length;
  const r = fixAll(src);
  es5(r.code);
  // Only Game.DPIHandling = true is left: its fix changes behaviour, so it needs the author.
  assert.deepEqual(r.remaining.map((d) => d.rule), ['type-mismatch']);
  assert.match(r.remaining[0].message, /DPIHandling/);
  assert.ok(r.applied.length >= 9, `applied ${r.applied.length} of ${before}`);
  // stable: running again changes nothing
  assert.equal(fixAll(r.code).code, r.code);
});

test('binary/octal/separator number literals become decimal', () => {
  const r = fixAll(HEADER + 'Game.MaxPlayers = 0b11;\nGame.PauseBetweenStarts = 1_000;\n');
  es5(r.code);
  assert.match(r.code, /Game\.MaxPlayers = 3;\nGame\.PauseBetweenStarts = 1000;/);
});

test('Fix all never applies behaviour-changing fixes', () => {
  const src =
    HEADER +
    'Game.DPIHandling = true;\nGame.SupportsMultipleKeyboardsAndMice = true;\nGame.ProtoInput.FocusHooks = true;\n' +
    'Game.Play = function () {\n  for (var i = 0; i < PlayerList.Count; i++) {\n    var player = PlayerList[i];\n    player.ProtoController5 = 1;\n  }\n};\n';
  const r = fixAll(src);
  assert.equal(r.code, src);
  assert.deepEqual(r.applied, []);
  // missing required options need the author's values
  assert.equal(fixAll('Game.MaxPlayers = 4;\n').code, 'Game.MaxPlayers = 4;\n');
});
