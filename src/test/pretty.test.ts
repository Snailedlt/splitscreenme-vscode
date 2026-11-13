import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { prettyCode, prettySignature } from '../core/pretty';
import { allEntries } from '../core/lookup';
import { memberMarkdown } from '../core/api';

// The program without positions: formatting may only move spaces and line breaks.
const shape = (code: string) => JSON.stringify(acorn.parse(code, { ecmaVersion: 5, allowReserved: true }), (k, v) => (k === 'start' || k === 'end' || k === 'raw' && false ? undefined : v));

test('pretty: every example in the docs keeps its meaning, settles in one pass, and fits 60 columns where it can', () => {
  let changed = 0;
  for (const e of allEntries(true)) {
    const ex = e.member.example;
    if (!ex) continue;
    const out = prettyCode(ex);
    let parses = true;
    try { shape(ex); } catch { parses = false; }
    if (!parses) { assert.equal(out, ex, `left as written: ${e.path}`); continue; }
    assert.equal(shape(out), shape(ex), `same program: ${e.path}`);
    assert.equal(prettyCode(out), out, `stable: ${e.path}`);
    for (const l of out.split('\n')) if (l.length > 60) assert.ok(!/[,[(]\s*\S/.test(l.slice(0, -1).replace(/"(?:[^"\\]|\\.)*"/g, '""')) || /^\s*"/.test(l) || l.replace(/"(?:[^"\\]|\\.)*"/g, '""').length <= 60, `${e.path}: ${l}`);
    if (out !== ex) changed++;
  }
  assert.ok(changed > 0);
});

test('pretty: prettier layouts (hug the last argument, chains after =, arrays, spacing)', () => {
  assert.equal(prettyCode('Game.X = [ "a", "b" ];'), 'Game.X = ["a", "b"];');
  assert.equal(prettyCode('Context.ModifySaveFile(path, path, Nucleus.SaveType.INI, [new Nucleus.IniSaveInfo("Section", "Key", "Value"), new Nucleus.IniSaveInfo("Video", "Width", Context.Width)]);'),
    'Context.ModifySaveFile(path, path, Nucleus.SaveType.INI, [\n  new Nucleus.IniSaveInfo("Section", "Key", "Value"),\n  new Nucleus.IniSaveInfo("Video", "Width", Context.Width)\n]);');
  assert.equal(prettyCode('Game.Play = function () { Context.StartArguments = "-windowed -width " + Context.Width + " -height " + Context.Height + " -nosound"; };'),
    'Game.Play = function () {\n  Context.StartArguments =\n    "-windowed -width " +\n    Context.Width +\n    " -height " +\n    Context.Height +\n    " -nosound";\n};');
  assert.equal(prettyCode('var a = 1; // why'), 'var a = 1; // why', 'comments: as written');
  assert.equal(prettyCode('a => 1'), 'a => 1', 'not ES5: as written');
});

test('pretty: long signatures one parameter per line; short ones and hovers as they are', () => {
  assert.equal(prettySignature('Context.Width: number'), 'Context.Width: number');
  assert.equal(prettySignature('Context.ModifySaveFile(installSavePath: string | number | boolean, saveFullPath: string, type: Nucleus.SaveType, ...info: Nucleus.SaveInfo): boolean'),
    'Context.ModifySaveFile(\n  installSavePath: string | number | boolean,\n  saveFullPath: string,\n  type: Nucleus.SaveType,\n  ...info: Nucleus.SaveInfo\n): boolean');
  const e = allEntries(true).find((x) => x.path === 'Context.ModifySaveFile')!;
  assert.match(memberMarkdown(e.owner, e.name, e.member), /```ts\nContext\.ModifySaveFile\(\n  installSavePath/);
});

test('prettyCode never changes what code means (parentheses it can\'t print come back as written)', () => {
  for (const src of ['x = (a + b) * c;', 'x = a - (b - c);', 'x = -(a + b);', 'x = - -a;', 'x = !(a && b);', 'x = (a ? b : c).d;', '(function () { a(); })();']) {
    const out = prettyCode(src);
    const strip = (n: any): any => (Array.isArray(n) ? n.map(strip) : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'start' && k !== 'end').map(([k, v]) => [k, strip(v)])) : n);
    const tree = (t: string) => JSON.stringify(strip(acorn.parse(t, { ecmaVersion: 5 })));
    assert.equal(tree(out), tree(src), `${src} → ${out}`);
  }
});
