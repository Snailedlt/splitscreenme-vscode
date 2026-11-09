import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubScan, hubGameName } from '../core/hubscan';
import { hubFolderName } from '../core/sim';
import { gameFolderName } from '../core/pkgcheck';
import { lint } from '../core/lint';

// DownloadPrompt.ExtractHandler (and HubWebView, HandlerScanner, UI_Functions): one scan, as Nucleus does it.
test('Hub install scan: the game name Nucleus reads, in every case', () => {
  const exe = 'Game.ExecutableName = "game.exe";\n';
  const table: [string, string, string | undefined][] = [
    ['plain', exe + 'Game.GameName = "Demo";\n', 'Demo'],
    ['second GameName overwrites the first (two matches)', 'Game.GameName = "A";\nGame.GameName = "B";\n' + exe, 'B'],
    ['a third match is never read', exe + 'Game.GameName = "A";\nGame.GameName = "B";\n', 'A'],
    ['indented: no match', exe + '  Game.GameName = "Indented";\n', undefined],
    ['case-insensitive', exe + 'GAME.GAMENAME = "Loud";\n', 'Loud'],
    ['any line starting with it', 'Game.GameNameX = "prefix";\n' + exe, 'prefix'],
    ['inside a block comment counts', '/*\nGame.GameName = "InComment";\n*/\n' + exe + 'Game.GameName = "Real";\n', 'InComment'],
    ['a // comment line is no match', '// Game.GameName = "No";\n' + exe + 'Game.GameName = "Yes";\n', 'Yes'],
    ['between the first and last quote', exe + 'Game.GameName = "A"; // the "best"\n', 'A;  the best'],
    ['a backslash stays', exe + 'Game.GameName = "A\\\\B";\n', 'A\\\\B'],
    ['/ : * ? " < > | removed', exe + 'Game.GameName = "Halo: MCC?";\n', 'Halo MCC'],
    ['BOM dropped (ReadAllLines)', '\uFEFFGame.GameName = "Bom";\n' + exe, 'Bom'],
    ['lone \\r is a line break', exe.trim() + '\rGame.GameName = "CR";\r', 'CR'],
    ['fewer than two quotes: the install throws', "Game.GameName = 'single';\n" + exe, undefined],
  ];
  for (const [name, text, want] of table) {
    assert.equal(hubGameName(text), want, name);
    assert.equal(hubFolderName(text), want || 'MyHandler', `sim: ${name}`);
    assert.equal(gameFolderName(text), want ?? '<GameName>', `pkgcheck: ${name}`);
  }
  const bom = hubScan('\uFEFFGame.ExecutableName = "a.exe";\nGame.GameName = "B";\n');
  assert.deepEqual([bom.ExecutableName?.offset, bom.GameName?.offset, bom.matched], [0, 32, [1, 2]], 'offsets in the text as given');
  assert.ok(hubScan("Game.GameName = 'x';\nGame.ExecutableName = \"a.exe\";\n").GameName?.crash);
});

test('Hub install scan: the linter agrees (BOM, indentation)', () => {
  const ok = 'Game.GUID = "demo";\nGame.GameName = "Demo";\nGame.ExecutableName = "demo.exe";\n';
  assert.deepEqual(lint('\uFEFF' + ok).filter((d) => d.rule === 'hub-install-parse'), [], 'a BOM is no problem');
  assert.ok(lint(ok.replace('Game.GameName', '  Game.GameName')).some((d) => d.rule === 'hub-install-parse'), 'indented');
});
