import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { memberContextAt, resolveAt, callContextAt, valueContextAt } from '../core/complete';
import { membersOf, suggest } from '../core/api';
import { renderHandler, toGuid, toHandlerFileName, FEATURES } from '../core/templates';
import { writeZip, readZip, handlerPackageEntries, crc32 } from '../core/zip';
import { lint } from '../core/lint';
import { completionsAt, signatureHelpAt } from '../core/features';

const at = (src: string) => ({ text: src.replace('|', ''), offset: src.indexOf('|') });

test('member completion context', () => {
  let { text, offset } = at('Game.Ho|');
  let ctx = memberContextAt(text, offset)!;
  assert.equal(ctx.partial, 'Ho');
  assert.ok(membersOf(ctx.base).some((m) => m.name === 'Hook'));

  ({ text, offset } = at('Game.Hook.|'));
  ctx = memberContextAt(text, offset)!;
  assert.ok(membersOf(ctx.base).some((m) => m.name === 'ForceFocus'));

  ({ text, offset } = at('var x = Nucleus.Folder.|'));
  assert.deepEqual(
    membersOf(memberContextAt(text, offset)!.base).map((m) => m.name),
    ['Documents', 'MainGameFolder', 'InstancedGameFolder'],
  );

  ({ text, offset } = at('Game.Play = function () {\n  var player = PlayerList[i];\n  player.Proto|'));
  assert.ok(membersOf(memberContextAt(text, offset)!.base).some((m) => m.name === 'ProtoController1'));

  ({ text, offset } = at('ProtoInput.Values.|'));
  assert.ok(membersOf(memberContextAt(text, offset)!.base).some((m) => m.name === 'MouseButtonFilterID'));

  ({ text, offset } = at('foo.|'));
  assert.equal(memberContextAt(text, offset), undefined);

  // internal members are hidden
  ({ text, offset } = at('Game.|'));
  assert.ok(!membersOf(memberContextAt(text, offset)!.base).some((m) => m.name === 'PrePlay'));
});

test('hover resolution', () => {
  const { text, offset } = at('Game.Hook.Force|Focus = true;');
  const r = resolveAt(text, offset)!;
  assert.equal(r.resolved.kind, 'member');
  assert.equal(text.slice(r.start, r.end), 'ForceFocus');
  assert.equal(resolveAt('x.Context', 4), undefined);
  assert.equal(resolveAt('Context', 2)!.resolved.kind, 'object');
});

test('signature help context', () => {
  let { text, offset } = at('Context.ModifySaveFile(a, b, Nucleus.SaveType.INI, [new Nucleus.IniSaveInfo("x", |');
  let c = callContextAt(text, offset)!;
  assert.equal(c.callee.kind, 'nucleusClass');
  assert.equal(c.activeParameter, 1);
  assert.equal(c.isNew, true);

  ({ text, offset } = at('Context.ModifySaveFile(a, "(,", Nucleus.SaveType.INI, [|'));
  c = callContextAt(text, offset)!;
  assert.equal(c.callee.kind, 'member');
  assert.equal(c.activeParameter, 3);
  assert.equal(c.isNew, false);
});

test('suggestions', () => {
  assert.equal(suggest('guid', ['GUID', 'GameName']), 'GUID');
  assert.equal(suggest('PauseBetweenStart', ['PauseBetweenStarts', 'Play']), 'PauseBetweenStarts');
  assert.equal(suggest('Completely', ['GUID']), undefined);
});

test('templates lint clean and are ES5', () => {
  for (let i = 0; i < 1 << FEATURES.length; i++) {
    const features = FEATURES.filter((_, b) => i & (1 << b)).map((f) => f.id);
    const src = renderHandler({ gameName: 'Halo: Reach', executableName: 'MCC-Win64-Shipping.exe', steamId: '976730', features });
    acorn.parse(src, { ecmaVersion: 5 });
    const diags = lint(src).filter((d) => d.severity !== 'hint');
    assert.deepEqual(diags, [], `features ${features.join(',')}: ${diags.map((d) => d.message).join('\n')}`);
  }
  assert.equal(toGuid('Halo: Reach!'), 'Halo Reach');
  assert.equal(toHandlerFileName('Halo: Reach?'), 'Halo Reach');
});

test('zip round trip with directory entries (Nucleus package layout)', () => {
  const big = Buffer.from('x'.repeat(5000));
  const entries = handlerPackageEntries(Buffer.from('Game.GUID = "a";'), 'My Game', [
    { rel: 'readme.txt', data: Buffer.from('hello') },
    { rel: 'utils/steam_api.dll', data: big },
  ]);
  const zip = writeZip(entries);
  const back = readZip(zip);
  assert.deepEqual(
    back.map((e) => e.name),
    ['handler.js', 'My Game/', 'My Game/utils/', 'My Game/readme.txt', 'My Game/utils/steam_api.dll'],
  );
  assert.equal(back[0].data!.toString(), 'Game.GUID = "a";');
  assert.ok(back[4].data!.equals(big));
  assert.ok(zip.length < 1000, 'compressible content is deflated');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('valueContextAt: values for enum and boolean options, callbacks and BlockedMessages', () => {
  const at = (src: string) => valueContextAt(src.replace('|', ''), src.indexOf('|'));
  assert.deepEqual(at('Game.DPIHandling = |')?.values.map((v) => v.value), ['Nucleus.DPIHandling.True', 'Nucleus.DPIHandling.Scaled', 'Nucleus.DPIHandling.InvScaled']);
  assert.equal(at('Game.SymlinkGame = tr|')?.partial, 'tr');
  assert.equal(at('Game.GameName = |'), undefined);
  assert.equal(at('x = Game.SymlinkGame == |'), undefined);
  assert.equal(at('Game.Play = |')?.values[0].value, 'function () {\n};');
  assert.equal(at('Game.ProtoInput.OnInputLocked = fu|')?.values[0].snippet, 'function () {\n\t$0\n};');
  assert.equal(at('Game.ProtoInput.BlockedMessages = |')?.values[0].value, '[0x0008, 0x02a1, 0x02a3];');
  assert.equal(at('Game.MaxPlayers = |'), undefined);
});

test('valuePicks: true/false, enum and number values, wrong types, computed values left alone', async () => {
  const { valuePicks, valuePickAt } = await import('../core/complete');
  const src = 'Game.SymlinkGame = false;\nGame.DPIHandling = Nucleus.DPIHandling.True;\nGame.MaxPlayers = 4;\nGame.KeepSymLinkOnExit = "true";\nGame.HandlerInterval = Context.Width;\nvar x = 3;\nif (a == true) {}\n';
  const picks = valuePicks(src);
  const by = (n: string) => picks.find((p) => p.name === n);
  assert.equal(by('SymlinkGame')?.kind, 'boolean');
  assert.deepEqual(by('SymlinkGame')?.options.map((o) => [o.value, !!o.current]), [['true', false], ['false', true]]);
  assert.equal(by('DPIHandling')?.kind, 'enum');
  assert.ok(by('DPIHandling')?.options.some((o) => o.current && o.value === 'Nucleus.DPIHandling.True'));
  assert.equal(by('MaxPlayers')?.kind, 'number');
  assert.equal(by('KeepSymLinkOnExit')?.wrong, 'text in quotes, not true or false');
  assert.equal(by('HandlerInterval'), undefined, 'computed values are left alone');
  assert.equal(picks.length, 4, 'no picks for plain variables or comparisons');
  const at = valuePickAt(src, src.indexOf('false') + 2);
  assert.equal(at?.name, 'SymlinkGame');
  assert.equal(src.slice(at!.start, at!.end), 'false');
  assert.equal(valuePickAt(src, 3), undefined, 'not on the option name');
});

test('documentSymbols: settings by object, callbacks with what they set, own names; code that does not parse', async () => {
  const { documentSymbols } = await import('../core/features');
  const src = 'Game.GameName = "Demo";\nGame.SymlinkGame = true;\nGame.ProtoInput.InjectStartup = true;\nvar width = 960;\nfunction helper(x) { Context.Width = x; }\nGame.Play = function () {\n  Context.StartArguments = "-w " + width;\n  var args = 1;\n};\n';
  const s = documentSymbols(src);
  assert.deepEqual(s.map((x) => `${x.kind}:${x.name}`), ['namespace:Game', 'namespace:Game.ProtoInput', 'variable:width', 'function:helper', 'function:Game.Play']);
  assert.deepEqual(s[0].children!.map((c) => `${c.name} ${c.detail}`), ['GameName = "Demo"', 'SymlinkGame = true']);
  assert.equal(src.slice(s[0].children![0].selection.start, s[0].children![0].selection.end), 'Game.GameName');
  assert.deepEqual(s[4].children!.map((c) => c.name), ['Context.StartArguments']);
  assert.deepEqual(s[3].children!.map((c) => c.name), ['Context.Width']);
  const broken = documentSymbols('Game.GameName = "Demo";\nGame.Play = function () {\n  Context.\n');
  assert.deepEqual(broken.map((x) => `${x.kind}:${x.name}`), ['property:Game.GameName', 'function:Game.Play']);
});

test('completion: JavaScript string methods after a string value (Jint ES5)', () => {
  const labels = (t: string) => (completionsAt(t, t.length) ?? []).map((c) => c.label);
  assert.ok(labels('Game.Play = function () {\n  var args = Context.StartArguments;\n  args.').includes('replace'), 'a variable set from a string field');
  assert.ok(labels('var s = "-w " + Context.Width;\ns.').includes('split'), 'a variable set from a string');
  assert.ok(labels('Context.StartArguments.').includes('indexOf'));
  assert.ok(!labels('Context.StartArguments.').includes('includes'), 'ES5 only');
  assert.match(signatureHelpAt('var s = "a";\ns.replace(', 25)?.signatures[0].label ?? '', /replace\(searchValue: string \| RegExp, replaceValue: string\)/);
});

test('JavaScript built-ins: generated from TypeScript\'s lib.es5.d.ts, current, and offered where they apply', () => {
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, ['scripts/generate-jsbuiltins.mjs', '--check'], { cwd: require('node:path').join(__dirname, '..') });
  const labels = (t: string) => (completionsAt(t, t.length) ?? []).map((c) => c.label);
  assert.ok(labels('Math.').includes('floor') && labels('JSON.').includes('stringify'));
  assert.ok(labels('var list = ["a"];\nlist.').includes('forEach'), 'an array literal');
  assert.ok(!labels('var list = ["a"];\nlist.').includes('includes'), 'ES5 only');
  assert.match(signatureHelpAt('parseInt(', 9)?.signatures[0].label ?? '', /^parseInt\(string: string, radix\??: number\)/);
  assert.ok(!JSON.stringify(require('../../data/js-builtins.json').objects).match(/=> value is|\bthis:/), 'no TypeScript-only notation');
  assert.ok(lint('Game.GUID = "x";\nvar n = Math.flor(2.5);\n').some((d) => d.rule === 'unknown-member' && /flor/.test(d.message)), 'a misspelled Math method');
  assert.ok(!lint('Game.GUID = "x";\nvar n = Math.floor(2.5) + Math.PI;\n').some((d) => d.rule === 'unknown-member'));
});

test('go to definition and references: own functions and variables (Jint scopes), Game.X, Context.Options keys', () => {
  const { definitionAt, referencesAt } = require('../core/definition');
  const t = 'Game.AddOption("Mode", "How to play", "mode", ["A", "B"], "A");\nvar folder = "x";\nfunction helper(a) { var b = a + folder; return b; }\nGame.Play = function () {\n  var folder = Context.Width;\n  var m = Context.Options["mode"];\n  helper(folder);\n  Game.Play;\n};\n';
  const word = (r: any) => (r ? t.slice(r.start, r.end) : r);
  const line = (r: any) => t.slice(0, r.start).split('\n').length;
  const at = (s: string, plus = 0) => t.indexOf(s) + plus;
  assert.equal(line(definitionAt(t, at('helper(folder)'))), 3, 'a function declaration');
  assert.equal(line(definitionAt(t, at('helper(folder)', 8))), 5, 'the inner var, not the outer one');
  assert.equal(line(definitionAt(t, at('a + folder', 5))), 2, 'the outer var, from another function');
  assert.equal(word(definitionAt(t, at('Options["mode', 10))), 'mode', 'Context.Options["mode"] -> the AddOption key');
  assert.equal(line(definitionAt(t, at('Options["mode', 10))), 1);
  assert.equal(line(definitionAt(t, at('Game.Play;', 6))), 4, 'Game.Play -> where it is set');
  assert.equal(definitionAt(t, at('Context.Width', 2)), undefined, 'API names have no definition in the handler');
  assert.deepEqual(referencesAt(t, at('helper(folder)', 8)).map(line), [5, 7]);
  // While typing (doesn't parse): still the declaration.
  assert.equal(line(definitionAt('function go() {}\nGame.Play = function () {\n  go(\n', 45)), 1);
});
