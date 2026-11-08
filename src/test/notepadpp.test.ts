// Notepad++ support (core/notepadpp.ts, `nucleus setup notepad++`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeNotepadPP, notepadPPVersion } from '../core/notepadpp';

// The shape of Notepad++'s own autoCompletion/javascript.xml (a few entries; the real one is part of Notepad++).
const ORIGINAL = `<?xml version="1.0" encoding="UTF-8" ?>
<NotepadPlus>
\t<AutoComplete language="JavaScript">
\t\t<Environment ignoreCase="no" startFunc="(" stopFunc=")" paramSeparator="," terminal=";" />
\t\t<KeyWord name="abs" />
\t\t<KeyWord name="alert" func="yes">
\t\t\t<Overload retVal="void"><Param name="message" /></Overload>
\t\t</KeyWord>
\t\t<KeyWord name="Zebra" />
\t</AutoComplete>
</NotepadPlus>
`;

test('notepad++: our names merged into its JavaScript list, sorted, with call tips; its own words kept', () => {
  const out = mergeNotepadPP(ORIGINAL, '9.9.9');
  const names = [...out.matchAll(/<KeyWord name="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.includes('abs') && names.includes('alert') && names.includes('Zebra'), 'Notepad++\'s own words stay');
  assert.ok(names.includes('Game.KillMutex') && names.includes('Context.ModifySaveFile') && names.includes('Nucleus.DPIHandling.True'));
  assert.ok(names.includes('System.IO.Path.Combine') && names.includes('System.IO.File.Copy'), 'the .NET members handlers use');
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'sorted by character code');
  assert.equal(new Set(names).size, names.length, 'no duplicates');
  assert.match(out, /additionalWordChar="\."/, '"." is part of a word, so Game.KillMutex is one suggestion');
  assert.match(out, /<KeyWord name="Context\.ModifySaveFile" func="yes">[\s\S]*?<Param name="string installSavePath" \/>/, 'call tips with short C# types');
  assert.ok(!names.some((n) => n.startsWith('Hub.')), 'no Hub.* lines (written by the Hub)');
  assert.equal(notepadPPVersion(out), '9.9.9');
  for (const c of out.matchAll(/<!--([\s\S]*?)-->/g)) assert.ok(!c[1].includes('--'), 'valid XML: no "--" inside a comment');
  assert.equal(notepadPPVersion(ORIGINAL), undefined);
  // Merging again (from a merged file) doesn't duplicate anything.
  const again = mergeNotepadPP(out, '9.9.9');
  assert.equal([...again.matchAll(/<KeyWord name="/g)].length, names.length);
});

test('notepad++: `nucleus setup notepad++` installs, checks, updates and removes, keeping a backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-npp-'));
  fs.mkdirSync(path.join(dir, 'autoCompletion'));
  fs.writeFileSync(path.join(dir, 'autoCompletion', 'javascript.xml'), ORIGINAL);
  fs.writeFileSync(path.join(dir, 'doLocalConf.xml'), ''); // portable: shortcuts.xml next to it
  const cli = path.join(__dirname, '..', 'dist', 'cli.js');
  const run = (...a: string[]) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [cli, 'setup', 'notepad++', '--path', dir, ...a], { encoding: 'utf8' }) };
    } catch (e: any) {
      return { code: e.status as number, out: String(e.stdout) };
    }
  };
  assert.equal(run('--check').code, 1, 'not set up yet');
  assert.match(run().out, /Added the Nucleus names/);
  const merged = fs.readFileSync(path.join(dir, 'autoCompletion', 'javascript.xml'), 'utf8');
  assert.match(merged, /Game\.KillMutex/);
  assert.equal(fs.readFileSync(path.join(dir, 'autoCompletion', 'javascript.xml.nucleus-backup'), 'utf8'), ORIGINAL);
  assert.match(fs.readFileSync(path.join(dir, 'shortcuts.xml'), 'utf8'), /<Command name="Nucleus: check this handler"[^>]*>cmd \/k .* lint "\$\(FULL_CURRENT_PATH\)"/);
  assert.equal(run('--check').code, 0);
  run();
  assert.equal(fs.readFileSync(path.join(dir, 'autoCompletion', 'javascript.xml'), 'utf8'), merged, 'setting up again gives the same file');
  assert.equal((fs.readFileSync(path.join(dir, 'shortcuts.xml'), 'utf8').match(/Nucleus: check this handler/g) ?? []).length, 1, 'one Run entry');
  assert.match(run('--remove').out, /JavaScript list is back/);
  assert.equal(fs.readFileSync(path.join(dir, 'autoCompletion', 'javascript.xml'), 'utf8'), ORIGINAL);
  assert.ok(!fs.existsSync(path.join(dir, 'autoCompletion', 'javascript.xml.nucleus-backup')));
  assert.ok(!/Nucleus: check this handler/.test(fs.readFileSync(path.join(dir, 'shortcuts.xml'), 'utf8')));
  assert.equal(run('--path', path.join(dir, 'nope')).code, 1);
});
