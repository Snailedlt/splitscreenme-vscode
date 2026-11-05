import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { memberContextAt, resolveAt, callContextAt, valueContextAt } from '../core/complete';
import { membersOf, suggest } from '../core/api';
import { renderHandler, toGuid, toHandlerFileName, FEATURES } from '../core/templates';
import { writeZip, readZip, handlerPackageEntries, crc32 } from '../core/zip';
import { lint } from '../core/lint';

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

test('valueContextAt: values for enum and boolean options only', () => {
  const at = (src: string) => valueContextAt(src.replace('|', ''), src.indexOf('|'));
  assert.deepEqual(at('Game.DPIHandling = |')?.values.map((v) => v.value), ['Nucleus.DPIHandling.True', 'Nucleus.DPIHandling.Scaled', 'Nucleus.DPIHandling.InvScaled']);
  assert.equal(at('Game.SymlinkGame = tr|')?.partial, 'tr');
  assert.equal(at('Game.GameName = |'), undefined);
  assert.equal(at('x = Game.SymlinkGame == |'), undefined);
  assert.equal(at('Game.Play = |'), undefined);
});
