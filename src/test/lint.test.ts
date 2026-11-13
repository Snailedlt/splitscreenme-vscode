import { blockTarget, wmName } from '../core/wm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { lint, lineOf, Diagnostic, Fix, looksLikeHandler, pluginGlobals } from '../core/lint';
import { quickFixes } from '../core/features';
import { fixAll } from '../core/fix';
import { membersOf } from '../core/api';
import { memberContextAt } from '../core/complete';

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
Game.AddOption("Window mode", "", "mode", ["Windowed", "Borderless"]);
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
    d.slice(0, 3).map((x) => x.message.match(/`(\w+)` does not exist on `([\w.]+)`/)!.slice(1).join('@')),
    ['IgnoreWindowBordercheck@Game', 'PauseBetweenStart@Game', 'PLayerID@Context'],
  );
  assert.match(d[3].message, /`Player\.ProtoController5` does not exist: .*four controllers/);
  assert.equal(d[0].fixes![0].edits[0].text, 'IgnoreWindowBorderCheck');
  assert.equal(d[1].fixes![0].edits[0].text, 'PauseBetweenStarts');
  assert.equal(d[2].fixes![0].edits[0].text, 'PlayerID');
  assert.match(d[0].message, /no effect/);
  assert.match(d[2].message, /undefined/);
});

test('nested objects and enums are checked', () => {
  const src = HEADER + 'Game.Hook.ForceFocuss = true;\nGame.ProtoInput.FocusHook = true;\nvar f = Nucleus.Folder.Instanced;\nGame.DPIHandling = Nucleus.SaveType.INI;\n';
  const d = lint(src).filter((x) => x.rule !== 'protoinput-legacy-hooks' && x.rule !== 'protoinput-inactive');
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
  // with only ExecutableNames the game can be added, but "Search disks" fails: a warning; the fix adds it
  const names = 'Game.GUID = "a";\nGame.GameName = "a";\nGame.ExecutableNames = ["a.exe", "b.exe"];\n';
  const n = only(names, 'missing-required');
  assert.equal(n.length, 1);
  assert.equal(n[0].severity, 'warning');
  assert.equal(n[0].fixes![0].preferred, true);
  assert.match(apply(names, n[0].fixes![0]), /^Game\.ExecutableName = "a\.exe";$/m);
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

test('replaces-nucleus-object: declaring Game or Context is an error, and the API checks still run (probes 120, 121)', () => {
  const top = 'var Game = {};\n' + HEADER + 'Game.Hook.ForceFocuss = true;\n';
  const d = lint(top);
  assert.deepEqual(d.filter((x) => x.rule === 'replaces-nucleus-object').map((x) => [x.severity, top.slice(x.start, x.end)]), [['error', 'Game']]);
  assert.equal(d.find((x) => x.rule === 'replaces-nucleus-object')!.fixes?.[0].title, 'Remove `var Game = {};`');
  assert.ok(d.some((x) => x.rule === 'unknown-member' && /ForceFocuss/.test(x.message)), 'Game.* is still checked');
  const inPlay = HEADER + 'Game.Play = function () {\n  var Context = {};\n  Context.StartArgument = "-x";\n};\n';
  const p = lint(inPlay);
  assert.equal(only(inPlay, 'replaces-nucleus-object').length, 1);
  assert.ok(p.some((x) => x.rule === 'unknown-member' && /StartArgument/.test(x.message)), 'Context.* is still checked');
  assert.equal(only(HEADER + 'Game.Play = function (Context) {\n  Context.StartArguments = "-x";\n};\n', 'replaces-nucleus-object').length, 1, 'a parameter');
  assert.equal(only(HEADER + 'Game = { GUID: "x" };\n', 'replaces-nucleus-object').length, 1, 'an assignment');
  assert.equal(only(HEADER + 'try { x(); } catch (Context) { }\n', 'replaces-nucleus-object').length, 1, 'a catch parameter');
  assert.equal(only(HEADER + 'var Game = { GUID: "x" };\n', 'replaces-nucleus-object')[0].fixes, undefined, 'no removal when it holds something');
});

test('replaces-nucleus-object: no false alarms', () => {
  const ok = HEADER + 'var GameName = "x";\nvar cfg = { Game: 1, Context: 2 };\nvar o = {};\no.Game = 1;\nGame.Play = function () {\n  var ctx = Context;\n  ctx.StartArguments = cfg.Game + GameName;\n};\n';
  assert.deepEqual(only(ok, 'replaces-nucleus-object'), []);
});

test('ES2015+ ways of declaring a name: one es5-only error, no undefined-name on top', () => {
  const cases: [string, number][] = [
    ['var a = [1].map((x) => x + 1);', 1],
    ['var a = [1].map(x => x * 2);', 1],
    ['var {p, q} = {p: 1, q: 2};\nvar r = p + q;', 1],
    ['var [m, n] = [1, 2];\nvar r = m + n;', 1],
    ['function f(a, b = 2) { return a + b; }', 1],
    ['function g(...rest) { return rest.length; }', 1],
    ['for (const it of [1]) { var r = it; }', 2],
    ['class K { m() { return 1; } }\nvar k = new K();', 1],
    ['var h = function ({ u, v: [w] }) { return u + w; };', 2], // the outer and the nested pattern
  ];
  for (const [code, es5] of cases) {
    const d = lint(HEADER + code + '\n');
    assert.deepEqual(d.filter((x) => x.rule === 'undefined-name').map((x) => x.message.slice(0, 30)), [], code);
    assert.equal(d.filter((x) => x.rule === 'es5-only').length, es5, code);
  }
  // Still caught: a name nothing declares, next to a shorthand in an object literal.
  assert.equal(only(HEADER + 'var o = { p };\n', 'undefined-name').length, 1);
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

test('...but a typo of a real member in that idiom is a warning, with the fix', () => {
  const src = HEADER + 'Game.Play = function () {\n  var a = (Context.StartArgument = "-x");\n};\n';
  const d = only(src, 'unknown-member');
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, 'warning');
  assert.match(d[0].message, /Did you mean `StartArguments`/);
  assert.equal(d[0].fixes?.[0].edits[0].text, 'StartArguments');
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
  // HookReRegisterRawInputMouse/Keyboard default to true but are only read when HookReRegisterRawInput
  // (default false) is on: their defaults alone are no reason to warn.
  const legacyOff = 'Game.SupportsMultipleKeyboardsAndMice = true;\nGame.ProtoInput.FocusHooks = true;\n' +
    ['HookSetCursorPos', 'HookGetCursorPos', 'HookGetKeyState', 'HookGetAsyncKeyState', 'HookGetKeyboardState', 'HookMouseVisibility', 'SendNormalMouseInput', 'SendNormalKeyboardInput', 'DrawFakeMouseCursor'].map((k) => `Game.${k} = false;\n`).join('');
  assert.deepEqual(only(HEADER + legacyOff, 'protoinput-legacy-hooks'), []);
  const reReg = only(HEADER + legacyOff + 'Game.HookReRegisterRawInput = true;\n', 'protoinput-legacy-hooks');
  assert.equal(reReg.length, 1);
  assert.match(reReg[0].message, /HookReRegisterRawInputMouse/);
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
  assert.deepEqual(lint(HEADER + 'Game.ProtoInput.InjectStartup = true;\nGame.ProtoInput.SetWindowPosHook = Nucleus.SetWindowPosHook.DontResize;\n'), []);
  assert.deepEqual(rules(lint(HEADER + 'Game.ProtoInput.InjectStartup = true;\nGame.ProtoInput.SetWindowPosHook = Nucleus.SetWindowPosHook.DontResiz;\n')), ['unknown-member']);
  assert.deepEqual(rules(lint(HEADER + 'Game.ProtoInput.InjectStartup = true;\nGame.ProtoInput.SetWindowPosHook = Nucleus.DrawFakeCursor.Fix;\n')), ['type-mismatch']);
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

test('hub install: the exact line scan Nucleus does (crashes, wrong line read)', () => {
  // the value comes from a variable: no quotes on the line, the install crashes
  const v = only('var n = "My Game";\nGame.GUID = "a";\nGame.GameName = n;\nGame.ExecutableName = "game.exe";\n', 'hub-install-parse');
  assert.equal(v[0].severity, 'error');
  // a commented-out duplicate at column 0 earlier in the file is what Nucleus reads
  const dup = only('Game.ExecutableName = "game.exe";\n/*\nGame.GameName = "Old Name";\n*/\nGame.GUID = "a";\nGame.GameName = "My Game";\n', 'hub-install-parse');
  assert.equal(dup.length, 1);
  assert.match(dup[0].message, /line 3, which gives `Old Name`/);
  // ...and if both GameName lines come first, Nucleus never reaches ExecutableName: the install fails
  const twice = only('/*\nGame.GameName = "Old Name";\n*/\nGame.GUID = "a";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";\n', 'hub-install-parse');
  assert.ok(twice.some((d) => d.severity === 'error' && /lines 2 and 5/.test(d.message)));
  // ExecutableNames + ExecutableName above GameName: Nucleus stops before reaching GameName
  const stop = only('Game.GUID = "a";\nGame.ExecutableNames = ["a.exe"];\nGame.ExecutableName = "a.exe";\nGame.GameName = "My Game";\n', 'hub-install-parse');
  assert.ok(stop.some((d) => /GameName.*stops after the first two/.test(d.message)));
  // ExecutableName only inside a function: the install finds no line
  const none = only('Game.GUID = "a";\nGame.GameName = "x";\nif (true) {\n  Game.ExecutableName = "x.exe";\n}\n', 'hub-install-parse');
  assert.ok(none.some((d) => d.severity === 'error' && /finds none/.test(d.message)));
  assert.deepEqual(only(HEADER, 'hub-install-parse'), []);
});

test('options: AddOption values, duplicate keys, ShowOptionAsStep', () => {
  const add = (args: string) => HEADER + `Game.AddOption(${args});\n`;
  assert.equal(only(add('"Speed", "", "speed", true'), 'type-mismatch')[0].severity, 'error');
  assert.equal(only(add('"Name", "", "name", "Player"'), 'type-mismatch').length, 1);
  assert.deepEqual(lint(add('"Speed", "", "speed", ["Low", "High"]') + 'var opts = ["a"];\nGame.AddOption("B", "", "b", opts);\nGame.AddOption("C", "", "c", []);\n'), []);
  const dup = only(add('"A", "", "k", ["x"]') + 'Game.AddOption("B", "", "k", ["y"]);\n', 'duplicate-assignment');
  assert.equal(dup[0].severity, 'error');
  assert.equal(only(HEADER + 'Game.ShowOptionAsStep("k", true, "Pick");\n', 'wrong-arguments').length, 1);
  assert.deepEqual(lint(add('"A", "", "k", [{ Name: "x" }]') + 'Game.ShowOptionAsStep("k", true, "Pick");\n'), []);
});

test('ExecutableName must be a file name, not a path', () => {
  const d = only('Game.GUID = "a";\nGame.GameName = "a";\nGame.ExecutableName = "bin\\\\x64\\\\game.exe";\n', 'type-mismatch');
  assert.equal(d[0].severity, 'error');
  assert.equal(d[0].fixes![0].edits[0].text, '"game.exe"');
});

test('callback-misuse', () => {
  assert.equal(only(HEADER + 'Game.SetupSse = function () {};\n', 'callback-misuse').length, 1);
  assert.equal(only(HEADER + 'Game.GamePlayBeforeGameSetup = true;\nGame.GamePlayAfterLaunch = true;\n', 'callback-misuse').length, 1);
  const after = HEADER + 'Game.GamePlayAfterLaunch = true;\nGame.Play = function () {\n  Context.StartArguments = "-x";\n};\n';
  assert.match(only(after, 'callback-misuse')[0].message, /no effect/);
  const keys = only(HEADER + 'Game.CustomHotkeys = ["true|Save|Ctrl|F1", "true|Load|Ctrl|F2"];\nGame.OnCustomHotKey_1 = function () {};\n', 'callback-misuse');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].severity, 'error');
  assert.match(keys[0].message, /OnCustomHotKey_2/);
  // fine
  assert.deepEqual(lint(HEADER + 'Game.GamePlayBeforeGameSetup = true;\nGame.Play = function () { Context.StartArguments = "-x"; };\nGame.CustomHotkeys = ["true|Save|Ctrl|F1"];\nGame.OnCustomHotKey_1 = function () {};\n'), []);
});

test('Nucleus classes: constructors, Globals, IniFile, ModifySaveFile entries', () => {
  const play = (body: string) => HEADER + 'Game.Play = function () {\n' + body + '\n};\n';
  assert.deepEqual(lint(play('var s = new Nucleus.SaveInfo();\nvar r = Nucleus.Globals.NucleusInstallRoot + Nucleus.Globals.userDocumentsRoot;\nvar ini = new Nucleus.IniFile(r);\nini.IniWriteValue("Video", "Width", Context.Width);\nvar v = ini.IniReadValue("Video", "Width");')), []);
  assert.equal(only(play('new Nucleus.Globals();'), 'wrong-arguments').length, 1);
  assert.equal(only(play('new Nucleus.IniSaveInfo("a");'), 'wrong-arguments').length, 1);
  assert.equal(only(play('var x = Nucleus.Globals.InstallRoot;'), 'unknown-member').length, 1);
  assert.equal(only(play('var ini = new Nucleus.IniFile("a.ini");\nini.IniWriteValue("a", "b");'), 'wrong-arguments').length, 1);
  const cfg = only(play('Context.ModifySaveFile("a", "a", Nucleus.SaveType.INI, [new Nucleus.CfgSaveInfo("s", "k", "v"), new Nucleus.IniSaveInfo("s", "k", "v")]);'), 'type-mismatch');
  assert.equal(cfg.length, 1);
  assert.equal(cfg[0].fixes![0].preferred, undefined); // changes behaviour: not for Fix all
});

test('Hub.* lines are known (no warnings) but not offered in completion', () => {
  assert.deepEqual(lint(HEADER + 'Hub.Handler.Version = 3;\nHub.Handler.Id = "x";\nHub.Maintainer.Name = "me";\nHub.Maintainer.Id = "y";\n'), []);
  for (const t of ['Hub.', 'Hub.Handler.']) assert.deepEqual(membersOf(memberContextAt(t, t.length)!.base), []);
  assert.ok(!membersOf(memberContextAt('Game.', 5)!.base).some((m) => m.name === 'Hub'));
  assert.ok(membersOf(memberContextAt('Nucleus.Globals.', 16)!.base).some((m) => m.name === 'NucleusInstallRoot'));
});

test('Player.ProtoController5+ explained, with a safe removal', () => {
  const src = HEADER + 'Game.Play = function () {\n  for (var i = 0; i < PlayerList.Count; i++) {\n    var player = PlayerList[i];\n    player.ProtoController4 = Context.GamepadId;\n    player.ProtoController5 = Context.GamepadId;\n    player.ProtoController6 = Context.GamepadId; // copied\n  }\n};\n';
  const d = only(src, 'unknown-member');
  assert.equal(d.length, 2);
  assert.match(d[0].message, /at most four controllers/);
  assert.deepEqual(d[0].tags, ['unnecessary']);
  const out = fixAll(src).code;
  assert.doesNotMatch(out, /ProtoController[56]/);
  assert.match(out, /ProtoController4 = Context\.GamepadId;/);
  assert.deepEqual(rules(lint(out)), []);
  // a call on the right-hand side is kept out of Fix all (removing it would skip the call)
  assert.equal(only(HEADER + 'Game.Play = function () { Player.ProtoController5 = Context.GetFolder(0); };\n', 'unknown-member')[0].fixes, undefined);
});

test('let then var redeclaration loads in Jint (probe 112): no syntax error, real duplicates still fail', () => {
  const src = 'Game.GUID = "P";\nGame.GameName = "P";\nGame.ExecutableName = "p.exe";\nGame.Play = function () {\n  if (true) {\n    let server = "a";\n    if (true) { var server = "b"; }\n    Context.StartArguments = server;\n  }\n};\n';
  assert.equal(lint(src).filter((d) => d.severity === 'error').length, 0);
  // Other syntax errors are still reported.
  assert.ok(lint(src + 'var = ;\n').some((d) => d.rule === 'syntax-error'));
});

test('System.*: listed .NET members resolve, typos are caught, unlisted ones are allowed', () => {
  const code = `${HEADER}Game.Play = function () {
  var p = System.IO.Path.Combine(Game.Folder, "a.ini");
  if (!System.IO.File.Exists(p)) System.IO.File.Copy(p, p + ".bak", true);
  System.IO.File.SetAttributes(p, System.IO.FileAttributes.Normal);
  System.IO.Directory.CreateDirectory(Context.UserProfileConfigPath);
  System.Threading.Thread.Sleep(500);
  var u = System.Environment.UserName;
  System.Diagnostics.Process.Start("x.exe");
  var many = System.IO.Path.Combine("a", "b", "c", "d", "e");
};
`;
  assert.deepEqual(rules(lint(code)), [], 'no false positives on real-world System calls');
  const typo = only(`${HEADER}Game.Play = function () { System.IO.File.Exsts("a"); };\n`, 'unknown-member');
  assert.equal(typo.length, 1);
  assert.match(typo[0].message, /Did you mean `Exists`/);
  assert.equal(typo[0].severity, 'error', 'calling a member that does not exist throws');
  assert.match(typo[0].message, /calling it throws/);
  const read = only(`${HEADER}Game.Play = function () { var x = System.IO.File.Exsts; };\n`, 'unknown-member');
  assert.equal(read[0].severity, 'warning', 'only reading it is a warning');
  const args = only(`${HEADER}Game.Play = function () { System.IO.File.Copy("a"); };\n`, 'wrong-arguments');
  assert.equal(args.length, 1, 'File.Copy needs 2 or 3 arguments');
  assert.ok(membersOf({ kind: 'object', type: 'System.IO.File' }).some((m) => m.name === 'Exists'), 'completion offers File.Exists');
});

test('value-format: options Nucleus parses from text', () => {
  const f = (line: string) => only(`${HEADER}${line}\n`, 'value-format');
  // CustomHotkeys
  assert.equal(f('Game.CustomHotkeys = ["true|Toggle HUD|Ctrl|H", "false|Next|Alt|F5", "true|x||D1"];').length, 0, 'well formed');
  assert.equal(f('Game.CustomHotkeys = ["true|Toggle HUD|H"];')[0].severity, 'error');
  assert.equal(f('Game.CustomHotkeys = ["yes|Toggle HUD|Ctrl|H"];')[0].severity, 'error');
  const lower = f('Game.CustomHotkeys = ["true|Toggle HUD|Ctrl|h"];');
  assert.equal(lower[0].severity, 'error');
  assert.equal(lower[0].fixes![0].edits[0].text, '"true|Toggle HUD|Ctrl|H"');
  assert.equal(f('Game.CustomHotkeys = ["true|Toggle HUD|Control|H"];')[0].severity, 'warning');
  assert.equal(f('Game.CustomHotkeys = ["true|a|Ctrl|A", "true|b|Ctrl|B", "true|c|Ctrl|C", "true|d|Ctrl|D"];')[0].severity, 'warning', 'a fourth is ignored');
  // folder pairs
  assert.equal(f('Game.CopyFoldersTo = ["Saves|Saves", "Config"];').length, 1);
  assert.equal(f('Game.SymlinkFoldersTo = ["a|b"];').length, 0);
  // SteamlessPatch
  assert.equal(f('Game.SteamlessPatch = ["false", "--quiet --keepbind", "2500"];').length, 0);
  assert.equal(f('Game.SteamlessPatch = ["no", "--quiet", "2.5s"];').length, 2);
  // BinariesFolder
  assert.equal(f('Game.BinariesFolder = "Binaries\\\\Win64";').length, 0);
  assert.equal(f('Game.BinariesFolder = "";').length, 0);
  const slash = f('Game.BinariesFolder = "\\\\Binaries/Win64\\\\";');
  assert.equal(slash[0].severity, 'warning');
  assert.equal(slash[0].fixes![0].edits[0].text, '"Binaries\\\\Win64"');
});

test('too-late: options Nucleus reads before the session, set inside a callback', () => {
  const inPlay = only(`${HEADER}Game.Play = function () {\n  Game.MaxPlayers = 8;\n  Game.AddOption("Mode", "", "mode", ["a", "b"]);\n  Game.FakeFocus = true;\n};\n`, 'too-late');
  assert.deepEqual(inPlay.map((d) => d.message.split(' ')[1]), ['`Game.MaxPlayers`', '`Game.AddOption`'], 'FakeFocus does work inside Game.Play');
  assert.match(inPlay[0].message, /inside `Game\.Play`/);
  // A helper run at the top level runs at load: fine.
  assert.equal(only(`${HEADER}function setup() { Game.MaxPlayers = 4; }\nsetup();\n`, 'too-late').length, 0);
  assert.equal(only(`${HEADER}Game.MaxPlayers = 4;\n`, 'too-late').length, 0);
});

test('a historical option from the original Nucleus Coop: a warning that says so, with a remove fix', () => {
  const d = only(`${HEADER}Game.ForceFinishOnPlay = true;\n`, 'unknown-member');
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, 'warning');
  assert.match(d[0].message, /original Nucleus Coop/);
  assert.match(d[0].message, /always closes leftover copies/);
  assert.deepEqual(d[0].tags, ['deprecated']);
  assert.doesNotMatch(d[0].message, /Did you mean/);
  assert.equal(apply(`${HEADER}Game.ForceFinishOnPlay = true;\n`, d[0].fixes![0]), HEADER);
});

test('undefined-name: a stray word in a list, at the top level and in Game.Play', () => {
  const top = only(`${HEADER}Game.FileSymlinkCopyInstead = [\n  "system.cfg",sdfsdf\n];\n`, 'undefined-name');
  assert.equal(top.length, 1);
  assert.equal(top[0].severity, 'error');
  assert.match(top[0].message, /sdfsdf is not defined/);
  assert.match(top[0].message, /fails to load/);
  const inPlay = only(`${HEADER}Game.Play = function () {\n  Context.StartArguments = argz;\n};\n`, 'undefined-name');
  assert.equal(inPlay.length, 1);
  assert.match(inPlay[0].message, /ends the session/);
});

test('undefined-name: a typo of a variable suggests it, but Fix all leaves it alone', () => {
  const code = `${HEADER}Game.Play = function () {\n  var args = "-w";\n  Context.StartArguments = arsg;\n};\n`;
  const d = only(code, 'undefined-name');
  assert.match(d[0].message, /Did you mean `args`/);
  assert.equal(d[0].fixes![0].preferred, undefined);
  assert.equal(fixAll(code).code, code);
});

test('undefined-name: no false positives', () => {
  const code = `${HEADER}var list = [];\nfunction helper(a) { return a + 1; }\nvar f = function self(n) { return n ? self(n - 1) : 0; };\nfor (k in { a: 1 }) list.push(k);\ntry { helper(1); } catch (e) { list.push(e.message); }\nif (typeof maybe === "undefined") list.push(Math.max(1, parseInt("2")));\nglobalThing = 1;\nlist.push(globalThing, JSON.stringify(list), isNaN(NaN), undefined, Infinity);\nGame.Play = function () { var n = arguments.length; Context.StartArguments = String(n) + System.IO.Path.Combine("a", "b"); };\n`;
  assert.deepEqual(only(code, 'undefined-name'), []);
});

test('undefined-name: plugins from pluginsInfo.txt are globals; unseen ones are only a warning', () => {
  const code = `${HEADER}Game.Play = function () {\n  TriggerFix.Sender.PushKey(Game.Folder);\n};\n`;
  assert.deepEqual(pluginGlobals('#TriggerFix#HLT.dll#XToKey.Sender|#Other#B.dll#B.C'), ['TriggerFix', 'Other']);
  assert.deepEqual(lint(code, { plugins: ['TriggerFix'] }).filter((d) => d.rule === 'undefined-name'), []);
  const unseen = lint(code).filter((d) => d.rule === 'undefined-name');
  assert.equal(unseen.length, 1);
  assert.equal(unseen[0].severity, 'warning');
  assert.match(unseen[0].message, /pluginsInfo\.txt/);
  assert.equal(lint(code, { plugins: [] }).filter((d) => d.rule === 'undefined-name')[0].severity, 'error');
});

test('AddOption with true/false or numbers: a saved profile gives them back as text', () => {
  const d = only(`${HEADER}Game.AddOption("Split", "", "split", [true, false]);\n`, 'type-mismatch');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /"True", "False"/);
  assert.deepEqual(only(`${HEADER}Game.AddOption("Split", "", "split", ["Yes", "No"]);\n`, 'type-mismatch'), []);
});

test('hub-install-parse: a backslash in GameName breaks the Hub install', () => {
  const code = HEADER.replace(/Game\.GameName = "[^"]*";/, 'Game.GameName = "My\\\\Game";');
  const d = only(code, 'hub-install-parse');
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, 'error');
  assert.match(d[0].message, /backslash/);
});

test('file-encoding: text that was not valid UTF-8', () => {
  const d = only(`${HEADER}Game.Description = "Caf�";\n`, 'file-encoding');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /UTF-8/);
  assert.deepEqual(only(`${HEADER}Game.Description = "Café";\n`, 'file-encoding'), []);
});

test('guid-changed: compared with the published version when the host has it', () => {
  const code = `Hub.Handler.Id = "abc123";\n${HEADER}`;
  const guid = /Game\.GUID = "([^"]*)"/.exec(HEADER)![1];
  const d = lint(code, { published: { version: 3, guid: 'Old Guid' } }).filter((x) => x.rule === 'guid-changed');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /"Old Guid".*v3/);
  assert.equal(apply(code, d[0].fixes![0]).includes('Game.GUID = "Old Guid"'), true);
  assert.deepEqual(lint(code, { published: { guid } }).filter((x) => x.rule === 'guid-changed'), []);
  assert.deepEqual(lint(code).filter((x) => x.rule === 'guid-changed'), []);
});

// Proto Input wiring (ProtoInputLauncher, GenericGameHandler, ProtoInputHooks MessageFilterHook/MessageList).
const PI = 'Game.ProtoInput.InjectStartup = true;\n';
test('protoinput-inactive: options without any way to start Proto Input', () => {
  const d = only(HEADER + 'Game.ProtoInput.FocusHooks = true;\n', 'protoinput-inactive');
  assert.equal(d.length, 1);
  assert.match(d[0].fixes![0].edits[0].text, /InjectStartup = true/);
  assert.equal(only(HEADER + PI + 'Game.ProtoInput.FocusHooks = true;\n', 'protoinput-inactive').length, 0);
  assert.equal(only(HEADER + 'Game.ProtoInput.InjectRuntime_EasyHookMethod = true;\nGame.ProtoInput.FocusHooks = true;\n', 'protoinput-inactive').length, 0);
  // Only options turned off: nothing to say.
  assert.equal(only(HEADER + 'Game.ProtoInput.FocusHooks = false;\n', 'protoinput-inactive').length, 0);
});
test('protoinput-needs-hook: BlockedMessages and filters need MessageFilterHook', () => {
  const d = only(HEADER + PI + 'Game.ProtoInput.BlockedMessages = [0x0008];\nGame.ProtoInput.MouseMoveFilter = true;\n', 'protoinput-needs-hook');
  assert.equal(d.length, 1);
  assert.match(d[0].message, /BlockedMessages.*MouseMoveFilter/);
  assert.equal(d[0].fixes![0].edits[0].text, 'Game.ProtoInput.MessageFilterHook = true;\n');
  assert.equal(only(HEADER + PI + 'Game.ProtoInput.MessageFilterHook = true;\nGame.ProtoInput.BlockedMessages = [0x0008];\n', 'protoinput-needs-hook').length, 0);
  assert.equal(only(HEADER + PI + 'Game.ProtoInput.BlockedMessages = [];\n', 'protoinput-needs-hook').length, 0);
});
test('blocked-message: unlisted, past the end, and repeated numbers', () => {
  const ok = HEADER + PI + 'Game.ProtoInput.MessageFilterHook = true;\nGame.ProtoInput.BlockedMessages = [0x0008, 0x02a3, 0x02a1, 6];\n';
  assert.equal(only(ok, 'blocked-message').length, 0);
  const d = only(HEADER + PI + 'Game.ProtoInput.MessageFilterHook = true;\nGame.ProtoInput.BlockedMessages = [0x0008, 0x0004, 0xFFFF, 0x0008];\n', 'blocked-message');
  assert.deepEqual(d.map((x) => x.severity), ['warning', 'warning', 'info']);
  assert.match(d[0].message, /WM_NULL/); // 4 isn't listed: it lands on WM_NULL's switch
  assert.match(d[1].message, /past the end/);
});
test('wm: names and what blocking a number switches on', () => {
  assert.equal(wmName(8), 'WM_KILLFOCUS');
  assert.equal(wmName(0x2a1), 'WM_MOUSEHOVER');
  assert.deepEqual(blockTarget(0x2a3), { kind: 'ok', name: 'WM_MOUSELEAVE' });
  assert.equal(blockTarget(0x10000).kind, 'out');
});

test('needs-option: an option Nucleus only reads when another is on', () => {
  const d = only(HEADER + 'Game.FakeFocusInterval = 1000;\nGame.SteamlessArgs = "--quiet";\n', 'needs-option');
  assert.equal(d.length, 2);
  assert.equal(d[0].fixes![0].edits[0].text, 'Game.FakeFocus = true;\n');
  assert.equal(only(HEADER + 'Game.FakeFocus = true;\nGame.FakeFocusInterval = 1000;\n', 'needs-option').length, 0);
  assert.equal(only(HEADER + 'Game.SendFakeFocusMsg = true;\nGame.FakeFocusSendActivate = true;\n', 'needs-option').length, 0);
  assert.equal(only(HEADER + 'Game.DrawFakeMouseCursorForControllers = false;\n', 'needs-option').length, 0);
});

test('a syntax error: marked where the code stops, and the rest is still checked', () => {
  const src = HEADER + 'Context.PLayerID;\nGame.Play = function () {\n  var player = PlayerList[0];\n  player.\n};\n';
  const d = lint(src);
  const syn = d.find((x) => x.rule === 'syntax-error')!;
  assert.equal(syn.message, 'Unfinished: a name is missing after `player.`');
  assert.equal(src.slice(syn.start, syn.end), 'player.');
  assert.ok(d.some((x) => x.rule === 'unknown-member' && /PLayerID/.test(x.message)), 'other checks still run');
  assert.ok(!d.some((x) => x.rule === 'missing-required'));
  // Not parseable at all: only the syntax error.
  assert.deepEqual(lint(HEADER + '((((\n').map((x) => x.rule), ['syntax-error']);
});

test('needs-option: the Proto Input focus loop options need EnableFocusMessageLoop', () => {
  const pi = 'Game.ProtoInput.InjectStartup = true;\n';
  const d = only(HEADER + pi + 'Game.ProtoInput.FocusLoopIntervalMilliseconds = 100;\n', 'needs-option');
  assert.equal(d.length, 1);
  assert.equal(d[0].fixes![0].edits[0].text, 'Game.ProtoInput.EnableFocusMessageLoop = true;\n');
  assert.equal(only(HEADER + pi + 'Game.ProtoInput.EnableFocusMessageLoop = true;\nGame.ProtoInput.FocusLoop_WM_ACTIVATE = true;\n', 'needs-option').length, 0);
  // Started by the handler itself: no warning (turning the option loop on would run a second one).
  assert.equal(only(HEADER + pi + 'Game.ProtoInput.FocusLoopIntervalMilliseconds = 100;\nGame.ProtoInput.OnInputLocked = function () { ProtoInput.StartFocusMessageLoop(Player.ProtoInputInstanceHandle, 0, true, true, false, true, true); };\n', 'needs-option').length, 0);
});

test('duplicate-assignment: remove this one, or keep it and remove the later one', () => {
  const src = HEADER + 'Game.MaxPlayers = 4;\nGame.MaxPlayers = 8;\n';
  const d = only(src, 'duplicate-assignment');
  assert.equal(d.length, 1);
  const titles = d[0].fixes!.map((f) => f.title);
  assert.equal(titles.length, 2);
  assert.match(titles[0], /^Remove this assignment/);
  assert.match(titles[1], /^Keep this value: remove line/);
  const kept = d[0].fixes![1].edits.reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), src);
  assert.ok(kept.includes('Game.MaxPlayers = 4;') && !kept.includes('Game.MaxPlayers = 8;'));
  // Fix all only applies the preferred one (the later value wins, as in Nucleus).
  assert.equal(d[0].fixes!.filter((f) => f.preferred).length, 1);
});

test('ESLint rules: general JavaScript mistakes, with a plain why, and no noise on correct code', () => {
  const H = 'Game.GUID = "x";\nGame.GameName = "x";\nGame.ExecutableName = "x.exe";\n';
  const rules = (code: string) => lint(H + code).map((d) => d.rule);
  assert.ok(rules('Game.Play = function () { if ((Player.Owner.IsDualVertical = "true")) { } };').includes('no-constant-condition'), 'assignment in a condition (a real Hub bug)');
  assert.ok(rules('var p = "C:\\Games\\Shooter";').includes('no-useless-escape'), 'a Windows path with single backslashes');
  assert.ok(rules('var p = "C:\\\\workshop\\453090";').includes('no-octal-escape'), 'a backslash before digits');
  assert.ok(rules('var o = { a: 1, a: 2 };').includes('no-dupe-keys'));
  assert.ok(rules('var n = 1; if (n == NaN) { }').includes('use-isnan'));
  assert.ok(rules('if (typeof Game === "strng") { }').includes('valid-typeof'));
  assert.ok(rules('Game.Play = function () { return; Context.StartArguments = "x"; };').includes('no-unreachable'));
  assert.ok(rules('Game.Play = function () { Context.Width + 1; };').includes('no-unused-expressions'));
  const d = lint(H + 'var o = { a: 1, a: 2 };').find((x) => x.rule === 'no-dupe-keys')!;
  assert.match(d.message, /Duplicate key 'a'\. An object can't have the same key twice/);
  assert.equal(d.severity, 'warning');
  // Correct code: nothing from these rules.
  const clean = 'var p = "C:\\\\Games\\\\Shooter";\nvar re = /\\d+/g;\nGame.Play = function () {\n  var args = Context.StartArguments;\n  if (args.indexOf("-w") === -1) { Context.StartArguments = args + " -w"; }\n  while (true) { break; }\n  var ok = Context.PlayerID > 0 && Context.Width;\n};\n';
  assert.deepEqual(lint(H + clean).filter((x) => /^(no-|use-|valid-|for-)/.test(x.rule)).map((x) => x.rule), []);
  // Switched off like any other rule; a stray name is reported once (undefined-name, not also as an unused expression).
  assert.ok(!lint(H + 'var o = { a: 1, a: 2 };', { rules: { 'no-dupe-keys': 'off' } }).some((x) => x.rule === 'no-dupe-keys'));
  assert.deepEqual(lint(H + 'Game.Play = function () { wwdsss; };').map((x) => x.rule), ['undefined-name']);
});

test('names Nucleus itself gets wrong: misspelled options, readme names that do not exist', () => {
  const cases: [string, string | undefined, RegExp][] = [
    ['Game.ProtoInput.WindowActivateAppFilter = true;', 'WindowActvateAppFilter', /Nucleus spells this option/],
    ['Game.ProtoInput.TranslateXAcceleration = 1;', 'TranslateXAccelration', /Nucleus spells this option/],
    ['Game.ProtoInput.FreezeExternalInputWhenInputNotLocke = true;', 'FreezeExternalInputWhenInputNotLocked', /Handlers Tool/],
    ['Game.IgnoreWindowBordercheck = true;', 'IgnoreWindowBorderCheck', /readme\.txt/],
    ['Game.Usex360ce = true;', 'UseX360ce', /readme\.txt/],
    ['Game.UseDI8CoopLvlUnlock = true;', 'UseDI8CoopLvlUnlocker', /readme\.txt/],
    ['Game.DrawFakeMouseForControllers = true;', 'DrawFakeMouseCursorForControllers', /readme\.txt/],
    ['Game.Play = function () { var h = Context.OrigHeight; };', undefined, /readme\.txt/],
    ['Game.Play = function () { var g = Context.GCD(4, 3); };', undefined, /private/],
  ];
  for (const [line, to, note] of cases) {
    const d = only(`${HEADER}${line}\n`, 'unknown-member');
    assert.equal(d.length, 1, line);
    assert.match(d[0].message, note, line);
    if (to) {
      assert.match(d[0].message, new RegExp(`Did you mean \`${to}\``), line);
      assert.equal(d[0].fixes?.[0].edits[0].text, to, line);
    } else {
      assert.doesNotMatch(d[0].message, /Did you mean/, line);
      assert.equal(d[0].fixes, undefined, line);
    }
  }
  // The spellings Nucleus reads are fine.
  assert.deepEqual(only(`${HEADER}Game.ProtoInput.WindowActvateAppFilter = true;\nGame.ProtoInput.TranslateXAccelration = 1;\n`, 'unknown-member'), []);
});

test('Context.Options["key"]: a key no Game.AddOption adds (a typo), with a fix; quiet when keys are computed', () => {
  const code = `${HEADER}Game.AddOption("Language", "", "lang", ["English", "French"]);\nGame.Play = function () {\n  var a = Context.Options["lang"];\n  var b = Context.Options["Lang"];\n  var c = Context.Options["lnag"];\n};\n`;
  const d = only(code, 'unknown-member');
  assert.equal(d.length, 2);
  assert.match(d[0].message, /No `Game.AddOption` in this handler adds the key `Lang`.*Did you mean `lang`/);
  assert.equal(d[0].fixes?.[0].edits[0].text, '"lang"');
  assert.equal(d[1].fixes?.[0].edits[0].text, '"lang"');
  const dyn = `${HEADER}var k = "lang";\nGame.AddOption("Language", "", k, ["English"]);\nGame.Play = function () {\n  var a = Context.Options["lang"];\n};\n`;
  assert.deepEqual(only(dyn, 'unknown-member'), [], 'a key in a variable: can not tell');
  const none = `${HEADER}Game.Play = function () {\n  var a = Context.Options["fps"];\n};\n`;
  assert.match(only(none, 'unknown-member')[0].message, /Add the option with/);
});

test('missing required options: explained, the fix uses what the handler already says, one problem for one cause', () => {
  const both = lint('Game.GameName = "Halo: Reach";\nGame.ExecutableName = "reach.exe";\n');
  const m = both.filter((d) => d.rule === 'missing-required');
  assert.equal(m.length, 1);
  assert.match(m[0].message, /`Game\.GUID` \(the folder name/);
  assert.equal(m[0].fixes?.[0].edits[0].text, 'Game.GUID = "Halo Reach";\n');
  assert.equal(m[0].fixes?.[0].preferred, true, 'derived from GameName: safe for Fix all');
  const none = lint('Game.MaxPlayers = 4;\n');
  const all = none.find((d) => d.rule === 'missing-required')!;
  assert.match(all.fixes![0].title, /then fill in the real value/);
  assert.notEqual(all.fixes![0].preferred, true, 'placeholders: not in Fix all');
  assert.ok(!none.some((d) => d.rule === 'hub-install-parse'), 'a missing ExecutableName is reported once');
  const nested = lint('Game.GUID = "A";\nGame.GameName = "A";\nGame.Play = function () {\n  Game.ExecutableName = "a.exe";\n};\n');
  assert.deepEqual(nested.filter((d) => d.severity === 'error').map((d) => d.rule), ['missing-required'], 'set only inside Game.Play (too late): reported once');
  const indented = lint('Game.GUID = "A";\nGame.GameName = "A";\n  Game.ExecutableName = "a.exe";\n');
  assert.ok(indented.some((d) => d.rule === 'hub-install-parse'), 'set, but indented: the Hub install still fails');
});

test('every diagnostic has a severity (the CLI, VS Code and LSP all need one)', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const dir = path.join(__dirname, '..', 'src', 'test', 'fixtures');
  const texts = [
    'Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\nGame.MaxPlayers = "4";\nGame.SymlinkGame = "true";\nGame.KillMutex = "x";\nGame.Hook.ForceFocus = 1;\nGame.Play = 3;\nContext.Width = 1;\nvar a = `x`;\nGame.Nope = 1;\n',
    ...(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')) : []),
  ];
  let n = 0;
  for (const t of texts)
    for (const d of lint(t)) {
      n++;
      assert.ok(['error', 'warning', 'info', 'hint'].includes(d.severity), `${d.rule}: severity ${String(d.severity)}`);
    }
  assert.ok(n > 5, 'the samples should trigger several rules');
});

test('lineOf: the same answers as counting newlines, and fast on long files', () => {
  const text = 'a\nbb\r\n\nccc\n';
  for (let o = -1; o <= text.length + 2; o++) {
    let n = 0;
    for (let i = 0; i < o && i < text.length; i++) if (text[i] === '\n') n++;
    assert.equal(lineOf(text, o), n, `offset ${o}`);
  }
  // Many problems in a long file: the time grows with the number of problems, not with problems × lines.
  const run = (n: number) => {
    const t0 = Date.now();
    const ds = lint('Game.GUID = "x";\nGame.GameName = "x";\nGame.ExecutableName = "x.exe";\n' + 'Game.KilMutex = "x";\n'.repeat(n));
    assert.ok(ds.length >= n);
    return Date.now() - t0;
  };
  run(200);
  const small = run(1000), big = run(4000);
  assert.ok(big < Math.max(small, 50) * 8, `1000 lines: ${small} ms, 4000 lines: ${big} ms`);
});

test('quick fixes: "Fix all" is a quick fix, so the Ctrl+. menu keeps it', () => {
  const src = 'Game.GUID = "x";\nGame.GameName = "x";\nGame.ExecutableName = "x.exe";\nGame.MaxPlayers = "4";\nGame.KillMutex = "m";\n';
  const ds = lint(src);
  const all = quickFixes(src, ds).filter((a) => a.title.startsWith('Fix all '));
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, 'quickfix');
});
