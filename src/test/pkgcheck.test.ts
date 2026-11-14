// Package checks (core/pkgcheck.ts), shared by the workbench, VS Code, the CLI and `nucleus lsp`, and the files next to
// a handler on disk (pkgfiles.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkPackage, installMap, sizeOf, textOf, type PackageFile } from '../core/pkgcheck';
import { packageFilesFor, packageFileForPath } from '../pkgfiles';
import { tmpdir } from './tmp';
import { packageQuickFix } from '../core/features';

const enc = (s: string) => new TextEncoder().encode(s);
const f = (name: string, text = 'x'): PackageFile => ({ name, data: enc(text) });
const HANDLER = 'Game.GameName = "My Game";\nGame.Play = function () {\n  var ini = Game.Folder + "\\\\settings.ini";\n  var cfg = Game.Folder + "\\\\Confg.json";\n};\n';

test('package checks: dropped files, Windows names, broken INI/JSON, missing files', () => {
  const p = checkPackage(HANDLER, [f('readme.txt'), f('My Game/settings.ini', 'a=1\nnot a pair\na=2'), f('My Game/Config.json', '{ bad'), f('My Game/a.txt'), f('My Game/A.txt'), f('My Game/x?.txt')]);
  const titles = p.map((x) => `${x.file ?? '(handler)'}: ${x.title}`);
  assert.ok(titles.includes('readme.txt: Dropped when installed from the Hub'));
  assert.ok(titles.includes('My Game/settings.ini: Not a key=value line'));
  assert.ok(!titles.some((x) => x.includes('same key')), 'repeated keys are fine (Unreal Engine lists)');
  assert.ok(titles.includes('My Game/Config.json: Not valid JSON'));
  assert.ok(titles.includes('My Game/A.txt: Two files with the same name on Windows'));
  assert.ok(titles.includes("My Game/x?.txt: A character Windows doesn't allow in names"));
  const missing = p.find((x) => !x.file);
  assert.equal(missing?.title, "A file that isn't in the package");
  assert.match(missing!.why, /Did you mean Config\.json\?/);
  assert.ok(HANDLER.slice(missing!.start, missing!.end).endsWith('Confg.json'));
  // The quick fix (features.ts packageQuickFix): the name the package has, written as the handler writes paths.
  const fix = packageQuickFix(missing!)!;
  assert.equal(fix.title, 'Change to Config.json');
  const fixed = HANDLER.slice(0, fix.edits[0].start) + fix.edits[0].text + HANDLER.slice(fix.edits[0].end);
  assert.match(fixed, /Game\.Folder \+ "\\\\Config\.json"/);
  assert.equal(checkPackage(fixed, [f('My Game/settings.ini', 'a=1'), f('My Game/Config.json', '{}')]).filter((x) => !x.file).length, 0);
  // Forward slashes and a subfolder stay as the handler wrote them.
  const slash = 'Game.GameName = "My Game";\nvar p = Path.Combine(Game.Folder, "data/Confg.json");\n';
  const s = checkPackage(slash, [f('My Game/data/Config.json', '{}')]).find((x) => !x.file)!;
  assert.equal(packageQuickFix(s)!.edits[0].text, 'data/Config.json');
});

test('package checks: nothing to say about a clean package; big files only by size', () => {
  assert.deepEqual(checkPackage(HANDLER, [f('My Game/settings.ini', '[Main]\na=1'), f('My Game/Confg.json', '{}')]), []);
  const big: PackageFile = { name: 'My Game/big.json', data: new Uint8Array(0), size: 30 * 1024 * 1024 };
  assert.equal(sizeOf(big), 30 * 1024 * 1024);
  const p = checkPackage('Game.GameName = "My Game";', [big]);
  assert.deepEqual(p.map((x) => x.title), ['A very large file'], 'a file left out is not parsed as empty JSON');
  assert.equal(installMap('Game.GameName = "My: Game";', [f('x/a.ini')])[1].to, 'handlers\\My Game\\a.ini');
  assert.equal(textOf(new Uint8Array([0xff, 0xfe, 0x41, 0])!)?.text, 'A');
});

test('package files on disk: <Name>/ next to <Name>.js, named as in the .nc; the CLI reports them', (t) => {
  const dir = tmpdir(t, 'nucleus-pkg-');
  const js = path.join(dir, 'MyGame.js');
  fs.writeFileSync(js, HANDLER);
  assert.equal(packageFilesFor(js, 0), undefined, 'no folder, nothing to check');
  fs.mkdirSync(path.join(dir, 'MyGame', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'MyGame', 'Config.json'), '{ bad');
  fs.writeFileSync(path.join(dir, 'MyGame', 'sub', 'b.ini'), '[A]\nk=v');
  const files = packageFilesFor(js, 0)!;
  assert.deepEqual(files.map((x) => x.name).sort(), ['MyGame/Config.json', 'MyGame/sub/b.ini']);
  assert.equal(packageFileForPath(path.join(dir, 'MyGame', 'sub', 'b.ini'), [js]), js);
  assert.equal(packageFileForPath(path.join(dir, 'Other', 'b.ini'), [js]), undefined);
  const cli = path.join(__dirname, '..', 'dist', 'cli.js');
  let out = '';
  try { out = execFileSync(process.execPath, [cli, 'lint', js], { encoding: 'utf8' }); } catch (e: any) { out = e.stdout; }
  assert.match(out, /MyGame\/Config\.json(:\d+)?\s+error\s+Not valid JSON/);
  assert.match(out, /A file that isn't in the package.*Did you mean Config\.json\?/);
  let raw = '';
  try { raw = execFileSync(process.execPath, [cli, 'lint', '--json', js], { encoding: 'utf8' }); } catch (e: any) { raw = e.stdout; }
  const json = JSON.parse(raw);
  assert.ok(json.files[0].package.some((p: any) => p.rule === 'package' && p.file === 'MyGame/Config.json'));
});
