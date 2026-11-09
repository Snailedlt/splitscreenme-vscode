import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint } from '../core/lint';
import { completionsAt, documentSymbols, hoverAt, inlayHints, quickFixes, signatureHelpAt, fixAllAction } from '../core/features';
import { formatHandler } from '../core/format';

// Nucleus (.NET's File.ReadAllLines, UTF-8) drops a leading byte order mark. Every core entry point does too, with
// offsets still counted in the text as given (the editor's document keeps its BOM).
const BOM = '\uFEFF';
const shift = (v: unknown): unknown => JSON.parse(JSON.stringify(v), (k, x) => (typeof x === 'number' && /^(start|end|offset)$/.test(k) ? x + 1 : x));

test('BOM: lint positions and fixes are the same, one character on', () => {
  const src = 'Game.GameName = "Demo";\nGame.ExecutableName = "demo.exe";\nvar p = "C:\\Games";\nvar x = 1;;\n';
  const plain = lint(src);
  const withBom = lint(BOM + src);
  assert.ok(plain.some((d) => d.rule === 'missing-required'), 'Game.GUID missing');
  assert.ok(plain.some((d) => d.fixes?.length && d.rule === 'no-useless-escape'), 'an ESLint fix');
  assert.deepEqual(withBom, shift(plain));
  assert.ok(!withBom.some((d) => d.rule === 'hub-install-parse'), 'no false Hub install problem');
  // Fix all keeps the BOM and changes the same things.
  const all = fixAllAction(BOM + src);
  assert.ok(all);
  const fixed = BOM + src.slice(0, all.edit.start - 1) + all.edit.text + src.slice(all.edit.end - 1);
  assert.ok(fixed.startsWith(BOM + 'Game.'), JSON.stringify(fixed.slice(0, 20)));
  for (const a of quickFixes(BOM + src, withBom)) for (const e of a.edits) assert.ok(e.start >= 1, `${a.title} edits after the BOM`);
});

test('BOM: suggestions, hovers, symbols and hints work on the first line too', () => {
  const src = 'Game.GUID = "x";\nGame.GameName = "Demo";\nGame.Play = function () {\n  Context.StartArguments = "";\n};\n';
  const at = (s: string, i: number) => [s, i] as const;
  const c = (t: string, o: number) => completionsAt(t, o, { explicit: true });
  assert.deepEqual(c(BOM + 'Gam', 4), shift(c('Gam', 3)));
  assert.deepEqual(c(BOM + 'Game.', 6), shift(c('Game.', 5)));
  assert.deepEqual(c(BOM, 1), shift(c('', 0)), 'an empty file: the template');
  assert.deepEqual(hoverAt(...at(BOM + src, 3)), shift(hoverAt(src, 2)));
  assert.deepEqual(signatureHelpAt(BOM + 'Game.AddOption(', 16), signatureHelpAt('Game.AddOption(', 15));
  assert.deepEqual(documentSymbols(BOM + src), shift(documentSymbols(src)));
  assert.deepEqual(inlayHints(BOM + src), shift(inlayHints(src)));
  const f = formatHandler(BOM + 'var a=1\n');
  assert.ok(f.ok && f.code === BOM + 'var a = 1;\n');
});

test('BOM: Try it runs the handler and names its folder as without one', () => {
  const { simulateIsolated } = require('../sandbox');
  const src = 'Game.GameName = "Bom Game";\nGame.GUID = "Bom Game";\nGame.ExecutableName = "game.exe";\nGame.Play = function () { Context.StartArguments = Game.Folder; };\n';
  const run = (t: string) => simulateIsolated(t, { players: 1, width: 1920, height: 1080, keyboardPlayer: 0 });
  const a = run(src);
  const b = run(BOM + src);
  assert.equal(b.loaded, true);
  assert.equal(b.players[0].startArguments, 'C:\\Nucleus\\handlers\\Bom Game');
  assert.deepEqual(b.players.map((p: any) => p.startArguments), a.players.map((p: any) => p.startArguments));
});
