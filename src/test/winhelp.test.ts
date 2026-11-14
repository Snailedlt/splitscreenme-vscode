// winhelp.ts: the permission prompt for `ncdev setup notepad++`, and the menu when ncdev.exe is double-clicked.
// Windows itself can't run here: these test what decides (quoting, results, the menu) with Windows' calls faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { elevateCommand, psQuote, runElevated, runMenu, startedFromExplorer } from '../winhelp';

test('elevateCommand: Start-Process -Verb RunAs, every argument quoted for PowerShell and the command line', () => {
  assert.equal(psQuote("it's"), "'it''s'");
  const cmd = elevateCommand('C:\\Users\\A B\\ncdev.exe', ['setup', 'notepad++', '--path', 'C:\\Program Files\\Notepad++', '--result-file', 'C:\\T\\r.json']);
  const script = cmd.at(-1)!;
  assert.deepEqual(cmd.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']);
  assert.match(script, /Start-Process -FilePath 'C:\\Users\\A B\\ncdev\.exe'/);
  assert.match(script, /-Verb RunAs -Wait -PassThru/);
  // A path with a space reaches the child as one argument.
  assert.match(script, /'"C:\\Program Files\\Notepad\+\+"'/);
  assert.match(script, /'setup','notepad\+\+','--path'/);
  // Declining the prompt (Start-Process throws) exits with 1223.
  assert.match(script, /catch \{ exit 1223 \}/);
  // Quotes and a trailing backslash survive Windows' command-line rules.
  assert.match(elevateCommand('x', ['a"b', 'C:\\dir\\']).at(-1)!, /'"a\\"b"'/);
});

test('runElevated: reads what the elevated copy did; declined or not started is "not ran"', () => {
  const fake = (status: number | null, write?: unknown) =>
    ((_cmd: string, args: string[]) => {
      const script = args.at(-1)!;
      const file = /'--result-file','"?([^'"]+)"?'/.exec(script)?.[1];
      if (write && file) fs.writeFileSync(file, JSON.stringify(write));
      return { status, error: undefined } as any;
    }) as unknown as typeof spawnSync;
  assert.deepEqual(runElevated('ncdev.exe', ['setup', 'notepad++'], fake(0, { ok: true, lines: ['Installed the Nucleus plugin'] })), { ran: true, ok: true, lines: ['Installed the Nucleus plugin'] });
  assert.deepEqual(runElevated('ncdev.exe', ['setup', 'notepad++'], fake(1223)), { ran: false });
  assert.deepEqual(runElevated('ncdev.exe', ['setup', 'notepad++'], fake(0)), { ran: false }, 'no result written');
  const failing = (() => ({ error: new Error('ENOENT') }) as any) as unknown as typeof spawnSync;
  assert.deepEqual(runElevated('ncdev.exe', [], failing), { ran: false });
});

test('startedFromExplorer: only on Windows, only when the parent is Explorer', () => {
  assert.equal(startedFromExplorer('win32', 42, () => 'explorer.exe'), true);
  assert.equal(startedFromExplorer('win32', 42, () => 'Explorer.EXE'), true);
  assert.equal(startedFromExplorer('win32', 42, () => 'cmd.exe'), false);
  assert.equal(startedFromExplorer('win32', 42, () => 'WindowsTerminal.exe'), false);
  assert.equal(startedFromExplorer('win32', 42, () => undefined), false);
  let asked = false;
  assert.equal(startedFromExplorer('linux', 42, () => ((asked = true), 'explorer.exe')), false);
  assert.equal(asked, false, 'nothing is looked up off Windows');
});

test('runMenu: one choice, then a key to close; Enter alone closes', async () => {
  const run = async (answers: string[]) => {
    const said: string[] = [];
    const done: string[] = [];
    const code = await runMenu(
      { ask: async (q) => (said.push(q), answers.shift() ?? ''), say: (t) => said.push(t) },
      { setup: () => (done.push('setup'), 0), update: async () => (done.push('update'), 1), help: () => done.push('help') },
      '9.9.9',
    );
    return { code, said: said.join('\n'), done };
  };
  const setup = await run(['1', '']);
  assert.deepEqual(setup.done, ['setup']);
  assert.match(setup.said, /ncdev 9\.9\.9/);
  assert.match(setup.said, /Set up Notepad\+\+/);
  assert.match(setup.said, /Press Enter to close/);
  assert.deepEqual((await run(['2', ''])).done, ['update']);
  assert.equal((await run(['2', ''])).code, 1);
  assert.deepEqual((await run([' 3 ', ''])).done, ['help']);
  // A failing action: the error shows, and the window still waits for Enter.
  const said: string[] = [];
  const answers = ['1', ''];
  const code = await runMenu({ ask: async (q) => (said.push(q), answers.shift() ?? ''), say: (t) => said.push(t) }, { setup: () => { throw new Error('disk full'); }, update: () => 0, help: () => {} }, '1');
  assert.equal(code, 1);
  assert.match(said.join('\n'), /disk full/);
  assert.match(said.join('\n'), /Press Enter to close/);
  const quit = await run(['']);
  assert.deepEqual(quit.done, []);
  assert.doesNotMatch(quit.said, /Press Enter to close/);
});

test('ncdev with no arguments from a terminal: the help, as before (no menu, no waiting)', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js');
  const r = spawnSync(process.execPath, [cli], { encoding: 'utf8', input: '', timeout: 10000 });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /setup notepad\+\+/);
  assert.doesNotMatch(r.stdout, /Press Enter/);
});
