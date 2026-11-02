import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { lint, Diagnostic, Fix, looksLikeHandler } from '../core/lint';
import { fixAll } from '../core/fix';

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
  const d = lint(src).filter((x) => x.rule !== 'protoinput-legacy-hooks');
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
  const d = only(HEADER + 'Game.HookGetCursorPos = true;\n', 'deprecated');
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, 'hint');
  assert.deepEqual(d[0].tags, ['deprecated']);
});

test('user variables shadowing globals are not resolved', () => {
  const src = HEADER + 'Game.Play = function () {\n  var Player = { Foo: 1 };\n  var x = Player.Foo;\n};\n';
  assert.deepEqual(lint(src), []);
});

test('the `var x = (Context.X = ...)` idiom is only a hint', () => {
  const src = HEADER + 'Game.Play = function () {\n  var args = (Context.Args = " -windowed");\n  Context.Argz = 1;\n};\n';
  const d = only(src, 'unknown-member');
  assert.deepEqual(d.map((x) => x.severity), ['hint', 'warning']);
});

test('member names follow Jint: first letter case-insensitive, the rest exact', () => {
  const src = HEADER + 'Game.symlinkGame = true;\nGame.IgnoreWindowBordercheck = true;\nGame.Play = function () { var w = Context.width; };\n';
  const d = only(src, 'unknown-member');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /IgnoreWindowBordercheck/);
});

test('options the Proto Input guide still requires are not deprecated', () => {
  const src = HEADER + 'Game.SupportsMultipleKeyboardsAndMice = true;\nGame.LockInputAtStart = false;\nGame.LockInputToggleKey = 0x23;\n';
  assert.deepEqual(lint(src), []);
});

test('Proto Input requires the legacy input options to be off', () => {
  const src = HEADER + 'Game.SupportsMultipleKeyboardsAndMice = true;\nGame.ProtoInput.FocusHooks = true;\nGame.HookGetCursorPos = true;\n';
  const d = only(src, 'protoinput-legacy-hooks');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /HookSetCursorPos.*default.*true/);
  assert.match(d[0].message, /HookGetCursorPos is set to true/);
  const fixed = apply(src, d[0].fixes![0]);
  assert.match(fixed, /Game\.SendNormalMouseInput = false;/);
  // setting a deprecated option to false is the recommended thing, not a hint
  assert.deepEqual(only(fixed.replace('Game.HookGetCursorPos = true;', 'Game.HookGetCursorPos = false;'), 'deprecated'), []);
  assert.deepEqual(only(fixed.replace('Game.HookGetCursorPos = true;', 'Game.HookGetCursorPos = false;'), 'protoinput-legacy-hooks'), []);
  // no Proto Input, or Proto Input for controllers only: no warning
  assert.deepEqual(only(HEADER, 'protoinput-legacy-hooks'), []);
  assert.deepEqual(only(HEADER + 'Game.ProtoInput.XinputHook = true;\n', 'protoinput-legacy-hooks'), []);
});

// The following were verified by running probes through Jint 2.11.58 with Nucleus' engine setup.
test('a non-array value for an array option is an error (the handler fails to load)', () => {
  const d = only(HEADER + 'Game.KillMutex = "Mutex";\nGame.XInputPlusDll = 5;\nGame.DirExclusions = null;\n', 'type-mismatch');
  assert.deepEqual(d.map((x) => x.severity), ['error', 'error']);
  assert.match(d[0].message, /fails to load/);
});

test('booleans assigned to enums: DPIHandling true means Scaled', () => {
  const t = only(HEADER + 'Game.DPIHandling = true;\n', 'type-mismatch');
  assert.equal(t.length, 1);
  assert.match(t[0].message, /converts to 1, which is `Nucleus\.DPIHandling\.Scaled`, not `Nucleus\.DPIHandling\.True`/);
  assert.deepEqual(t[0].fixes!.map((f) => f.edits[0].text), ['Nucleus.DPIHandling.True', 'Nucleus.DPIHandling.Scaled']);
  const f = only(HEADER + 'Game.DPIHandling = false;\n', 'type-mismatch');
  assert.match(f[0].message, /converts to 0, which is `Nucleus\.DPIHandling\.True`/);
  // Proto Input enums define True = 1, so booleans mean what they say
  assert.deepEqual(only(HEADER + 'Game.ProtoInput.SetWindowPosHook = true;\nGame.ProtoInput.DrawFakeCursor = false;\n', 'type-mismatch'), []);
});

test('Proto Input enums are reachable as Nucleus.<Enum>', () => {
  assert.deepEqual(lint(HEADER + 'Game.ProtoInput.SetWindowPosHook = Nucleus.SetWindowPosHook.DontResize;\n'), []);
  assert.deepEqual(rules(lint(HEADER + 'Game.ProtoInput.SetWindowPosHook = Nucleus.SetWindowPosHook.DontResiz;\n')), ['unknown-member']);
  assert.deepEqual(rules(lint(HEADER + 'Game.ProtoInput.SetWindowPosHook = Nucleus.DrawFakeCursor.Fix;\n')), ['type-mismatch']);
});

test('wrong argument counts are errors', () => {
  const d = only(HEADER + 'Game.Play = function () { Context.GetFolder(); };\n', 'wrong-arguments');
  assert.equal(d[0].severity, 'error');
});

test('unknown-member writes are errors in "use strict" code (Jint throws)', () => {
  const top = only('"use strict";\n' + HEADER + 'Game.NoSuchOption = true;\n', 'unknown-member');
  assert.equal(top[0].severity, 'error');
  const fn = only(HEADER + 'Game.Play = function () {\n  "use strict";\n  Context.Nope = 1;\n};\nGame.Other = 1;\n', 'unknown-member');
  assert.deepEqual(fn.map((d) => d.severity), ['error', 'warning']);
  // not a directive unless it comes first
  assert.equal(only(HEADER + '"use strict";\nGame.NoSuchOption = true;\n', 'unknown-member')[0].severity, 'warning');
});

test('missing-builtin: ES2015+ library calls that Jint 2.11 lacks', () => {
  const play = (body: string) => HEADER + 'Game.Play = function () {\n' + body + '\n};\n';
  assert.deepEqual(only(play('var o = Object.assign({}, Game);'), 'missing-builtin').map((d) => d.severity), ['error']);
  assert.deepEqual(only(play('var m = new Map();\nvar a = Array.from([1]);'), 'missing-builtin').length, 2);
  const eps = only(play('var e = Number.EPSILON;'), 'missing-builtin')[0];
  assert.match(eps.message, /is `undefined`/);
  assert.equal(eps.severity, 'warning');
  assert.equal(only(play('var s = Context.StartArguments;\nif (s.includes("-x")) {}'), 'missing-builtin')[0].severity, 'warning');
  assert.equal(only(play('var b = "abc".startsWith("a");'), 'missing-builtin')[0].severity, 'error');
  // Fix all rewrites includes/startsWith with indexOf and Number.parseInt with parseInt
  const out = fixAll(play('var s = "abc";\nif (!s.includes("b") || s.startsWith("a")) { Context.StartArguments = String(Number.parseInt("1")); }')).code;
  assert.match(out, /!\(s\.indexOf\("b"\) !== -1\) \|\| \(s\.indexOf\("a"\) === 0\)/);
  assert.match(out, /String\(parseInt\("1"\)\)/);
  assert.deepEqual(rules(lint(out)), []);
});

test('missing-builtin: no false positives', () => {
  const play = (body: string) => HEADER + 'Game.Play = function () {\n' + body + '\n};\n';
  // ES5 built-ins and padStart exist
  assert.deepEqual(lint(play('var k = Object.keys({ a: 1 });\nvar j = JSON.stringify(k);\nvar p = "1".padStart(2, "0");\nvar t = " a ".trim();\nvar i = [1].indexOf(1);\nvar x = typeof Map;')), []);
  // the handler's own methods and variables
  assert.deepEqual(lint(play('var util = { find: function (x) { return x; } };\nutil.find(1);\nvar Map = {};\nvar m = Map;')), []);
  assert.deepEqual(lint(play('function Set() {}\nvar s = new Set();')), []);
});

test('a string continued with a backslash fails to load in Nucleus (it re-joins lines with extra line breaks)', () => {
  const src = HEADER + 'Game.Play = function () {\n  Context.StartArguments = "-a \\\n-b";\n};\n';
  const d = only(src, 'syntax-error');
  assert.equal(d[0].severity, 'error');
  const out = fixAll(src).code;
  assert.match(out, /"-a -b"/);
  assert.deepEqual(rules(lint(out)), []);
  // ordinary strings, and escapes like \n, are fine
  assert.deepEqual(lint(HEADER + 'Game.Play = function () { Context.StartArguments = "a\\nb" + \'c\\\\\'; };\n'), []);
});
