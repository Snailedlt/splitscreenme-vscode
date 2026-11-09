import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { debugLogOn, guidOf, nucleusStatus, setDebugLog } from '../nucleusrun';

test("Nucleus' debug log switch in its Settings.ini: read and set, everything else kept (UTF-16 and ANSI)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-ini-'));
  const ini = path.join(dir, 'Settings.ini');
  assert.equal(debugLogOn(dir), undefined, 'no Settings.ini yet');
  setDebugLog(dir, true);
  assert.equal(debugLogOn(dir), true);
  // As Nucleus writes it: UTF-16 with a BOM, other sections and keys around.
  const text = '[Dev]\r\nTheme=Dark\r\n[Misc]\r\nGMOnly=False\r\nDebugLog=False\r\nUseNicksInGame=True\r\n[Hotkeys]\r\nClose=Ctrl+Q\r\n';
  fs.writeFileSync(ini, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  assert.equal(debugLogOn(dir), false);
  setDebugLog(dir, true);
  const buf = fs.readFileSync(ini);
  assert.deepEqual([buf[0], buf[1]], [0xff, 0xfe], 'still UTF-16');
  assert.equal(buf.toString('utf16le').slice(1), text.replace('DebugLog=False', 'DebugLog=True'));
  // ANSI, [Misc] without the key.
  fs.writeFileSync(ini, '[Misc]\r\nGMOnly=False\r\n[Other]\r\nA=1\r\n', 'latin1');
  setDebugLog(dir, true);
  assert.equal(fs.readFileSync(ini, 'latin1'), '[Misc]\r\nDebugLog=True\r\nGMOnly=False\r\n[Other]\r\nA=1\r\n');
});

test('the game Nucleus selects: Game.GUID; starting Nucleus needs Windows and NucleusCoop.exe', () => {
  assert.equal(guidOf('Game.GameName = "x";\nGame.GUID = "Halo Reach";\n'), 'Halo Reach');
  assert.equal(guidOf("Game.GUID = 'A B';"), 'A B');
  const s = nucleusStatus(fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-dir-')));
  assert.equal(s.canStart, false);
  assert.match(s.why!, process.platform === 'win32' ? /NucleusCoop\.exe/ : /Windows/);
});
