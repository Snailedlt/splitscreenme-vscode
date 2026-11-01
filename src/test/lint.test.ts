import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { lint, Diagnostic, Fix, looksLikeHandler } from '../core/lint';

const HEADER = `Game.GUID = "My Game";
Game.GameName = "My Game";
Game.ExecutableName = "game.exe";
`;

function rules(diags: Diagnostic[]) {
  return diags.map((d) => d.rule);
}
function only(text: string, rule: string) {
  return lint(text).filter((d) => d.rule === rule);
}
function apply(text: string, fix: Fix): string {
  const edits = [...fix.edits].sort((a, b) => b.start - a.start);
  for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}
function isEs5(text: string) {
  acorn.parse(text, { ecmaVersion: 5, allowReturnOutsideFunction: true });
}

test('a minimal valid handler has no diagnostics', () => {
  const src =
    HEADER +
    `Game.MaxPlayers = 4;
Game.KillMutex = ["Mutex"];
Game.Hook.ForceFocus = true;
Game.DPIHandling = Nucleus.DPIHandling.InvScaled;
Game.Play = function () {
  var ini = Context.GetFolder(Nucleus.Folder.InstancedGameFolder) + "\\\\config.ini";
  Context.ModifySaveFile(ini, ini, Nucleus.SaveType.INI, [
    new Nucleus.IniSaveInfo("Display", "Width", Context.Width),
  ]);
  var opt = Context.Options["mode"];
  System.IO.File.Copy("a", "b", true);
  for (var i = 0; i < PlayerList.Count; i++) {
    var player = PlayerList[i];
    player.ProtoController1 = Context.GamepadId;
  }
  Context.WriteTextFile("a.txt", ["line 1", "line 2"]);
  Context.WriteTextFile("a.txt", "line 1", "line 2");
};
Hub.Handler.Version = 3;
Hub.Handler.Id = "abc";
Hub.Maintainer.Name = "me";
`;
  assert.deepEqual(lint(src), []);
});

test('detects handlers', () => {
  assert.equal(looksLikeHandler(HEADER), true);
  assert.equal(looksLikeHandler('const x = require("fs");'), false);
});

test('syntax errors are reported', () => {
  const d = lint(HEADER + 'Game.Play = function( {');
  assert.deepEqual(rules(d), ['syntax-error']);
});

test('ES2015+ syntax is an error, with fixes that produce ES5', () => {
  const src = HEADER + 'Game.Play = function () {\n  var a = [1].map(x => x);\n  var s = `w=${Context.Width}px`;\n  foo(1, 2,);\n};\n';
  const d = only(src, 'es5-only');
  assert.equal(d.length, 3);
  const tpl = d.find((x) => x.message.includes('template'))!;
  const fixed = apply(src, tpl.fixes![0]);
  assert.match(fixed, /var s = "w=" \+ Context\.Width \+ "px";/);
  const comma = d.find((x) => x.message.includes('trailing comma'))!;
  assert.match(apply(src, comma.fixes![0]), /foo\(1, 2\);/);
});

test('let/const behave like var in Jint 2 (info), but const in a for head is an error', () => {
  const src = HEADER + 'Game.Play = function () {\n  let a = 1;\n  for (const k in {}) {}\n  for (let i = 0; i < 2; i++) {}\n};\n';
  const lc = only(src, 'let-const-semantics');
  assert.equal(lc.length, 2);
  assert.equal(lc[0].severity, 'info');
  const err = only(src, 'es5-only');
  assert.equal(err.length, 1);
  assert.match(err[0].message, /const/);
  isEs5(apply(apply(src, err[0].fixes![0]), lc[1].fixes![0]).replace('let a', 'var a'));
});

test('unknown Game/Context/Player members are flagged with did-you-mean fixes', () => {
  const src =
    HEADER +
    `Game.IgnoreWindowBordercheck = true;
Game.PauseBetweenStart = 100;
Game.Play = function () {
  var id = Context.PLayerID;
  for (var i = 0; i < PlayerList.Count; i++) {
    var player = PlayerList[i];
    player.ProtoController5 = 1;
  }
};
`;
  const d = only(src, 'unknown-member');
  assert.deepEqual(
    d.map((x) => x.message.match(/`(\w+)` does not exist on `([\w.]+)`/)!.slice(1).join('@')),
    ['IgnoreWindowBordercheck@Game', 'PauseBetweenStart@Game', 'PLayerID@Context', 'ProtoController5@Player'],
  );
  assert.equal(d[0].fixes![0].edits[0].text, 'IgnoreWindowBorderCheck');
  assert.equal(d[1].fixes![0].edits[0].text, 'PauseBetweenStarts');
  assert.equal(d[2].fixes![0].edits[0].text, 'PlayerID');
  assert.match(d[0].message, /no effect/);
  assert.match(d[2].message, /undefined/);
});

test('nested objects and enums are checked', () => {
  const src = HEADER + 'Game.Hook.ForceFocuss = true;\nGame.ProtoInput.FocusHook = true;\nvar f = Nucleus.Folder.Instanced;\nGame.DPIHandling = Nucleus.SaveType.INI;\n';
  const d = lint(src);
  assert.deepEqual(rules(d), ['unknown-member', 'unknown-member', 'unknown-member', 'type-mismatch']);
  assert.equal(d[0].fixes![0].edits[0].text, 'ForceFocus');
  assert.equal(d[1].fixes![0].edits[0].text, 'FocusHooks');
});

test('callback-only globals at top level are errors', () => {
  const src = HEADER + 'var w = Context.Width;\nif (typeof Context !== "undefined") {}\nGame.Play = function () { var h = Context.Height; };\n';
  const d = only(src, 'callback-only-global');
  assert.equal(d.length, 1);
  assert.equal(src.slice(d[0].start, d[0].end), 'Context');
});

test('missing required options produce an error with a fix', () => {
  const src = 'Game.MaxPlayers = 4;\n';
  const d = only(src, 'missing-required');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /GUID.*GameName.*ExecutableName/);
  assert.deepEqual(only(apply(src, d[0].fixes![0]), 'missing-required'), []);
  // ExecutableNames is an accepted alternative
  assert.deepEqual(only('Game.GUID = "a";\nGame.GameName = "a";\nGame.ExecutableNames = ["a.exe"];\n', 'missing-required'), []);
  // Plain scripts are not handlers
  assert.deepEqual(lint('var x = 1;\n'), []);
});

test('type mismatches', () => {
  const src = HEADER + 'Game.KillMutex = "Mutex";\nGame.HandlerInterval = "100";\nGame.SymlinkGame = "true";\nGame.MaxPlayers = true;\nGame.SteamID = 12345;\nGame.Play = "x";\n';
  const d = only(src, 'type-mismatch');
  assert.equal(d.length, 5);
  assert.equal(apply(src, d[0].fixes![0]).includes('Game.KillMutex = ["Mutex"];'), true);
  assert.equal(apply(src, d[1].fixes![0]).includes('Game.HandlerInterval = 100;'), true);
  assert.equal(d[2].severity, 'info');
  assert.equal(apply(src, d[2].fixes![0]).includes('Game.SymlinkGame = true;'), true);
  assert.match(d[3].message, /number/);
  assert.match(d[4].message, /function/);
});

test('read-only members and wrong argument counts', () => {
  const src = HEADER + 'Game.Play = function () {\n  Context.Width = 5;\n  Context.GetFolder();\n  var x = new Nucleus.IniSaveInfo("a", "b");\n};\n';
  assert.deepEqual(rules(lint(src)), ['readonly-member', 'wrong-arguments', 'wrong-arguments']);
});

test('duplicate top-level assignments', () => {
  const src = HEADER + 'Game.MaxPlayers = 4;\nGame.MaxPlayers = 8;\n';
  const d = only(src, 'duplicate-assignment');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /line 5/);
  assert.equal(apply(src, d[0].fixes![0]), HEADER + 'Game.MaxPlayers = 8;\n');
});

test('hub install parsing pitfalls', () => {
  const indented = '  Game.GameName = "My Game";\nGame.GUID = "a";\nGame.ExecutableName = "game.exe";\n';
  const a = only(indented, 'hub-install-parse');
  assert.equal(a.length, 1);
  assert.equal(apply(indented, a[0].fixes![0]).startsWith('Game.GameName'), true);

  const single = "Game.GUID = 'a';\nGame.GameName = 'My Game';\nGame.ExecutableName = \"game.exe\";\n";
  const b = only(single, 'hub-install-parse');
  assert.equal(b.length, 1);
  assert.equal(apply(single, b[0].fixes![0]).includes('Game.GameName = "My Game";'), true);

  const comment = 'Game.GUID = "a";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe"; // not "launcher.exe"\n';
  const c = only(comment, 'hub-install-parse');
  assert.equal(c.length, 1);
  assert.match(c[0].message, /game\.exe"; \/\/ not "launcher\.exe/);

  const names = 'Game.GUID = "a";\nGame.GameName = "My Game";\nGame.ExecutableNames = ["a.exe"];\nGame.ExecutableName = "game.exe";\n';
  assert.equal(only(names, 'hub-install-parse').length, 1);
});

test('GUID characters', () => {
  const d = only('Game.GUID = "My: Game!";\nGame.GameName = "x";\nGame.ExecutableName = "x.exe";\n', 'guid-characters');
  assert.equal(d.length, 1);
  assert.equal(d[0].fixes![0].edits[0].text, '"My Game"');
});

test('suppression comments and rule overrides', () => {
  const src = HEADER + '// nucleus-lint-disable-next-line unknown-member\nGame.Foo = 1;\nGame.Bar = 1; // nucleus-lint-disable-line\nGame.Baz = 1;\n';
  assert.equal(only(src, 'unknown-member').length, 1);
  assert.equal(lint('/* nucleus-lint-disable */\n' + src).length, 0);
  assert.equal(lint(src, { rules: { 'unknown-member': 'off' } }).length, 0);
  assert.equal(lint(src, { rules: { 'unknown-member': 'error' } })[0].severity, 'error');
});

test('deprecated options are hints with the deprecated tag', () => {
  const d = only(HEADER + 'Game.SupportsMultipleKeyboardsAndMice = true;\n', 'deprecated');
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, 'hint');
  assert.deepEqual(d[0].tags, ['deprecated']);
});

test('user variables shadowing globals are not resolved', () => {
  const src = HEADER + 'Game.Play = function () {\n  var Player = { Foo: 1 };\n  var x = Player.Foo;\n};\n';
  assert.deepEqual(lint(src), []);
});
