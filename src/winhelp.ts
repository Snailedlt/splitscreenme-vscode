// Two things that make ncdev usable without a terminal on Windows:
// - Asking Windows for permission (the UAC prompt) when `ncdev setup notepad++` can't write to Notepad++'s folder in
//   Program Files: ncdev starts itself again, elevated, and reads back what that copy did.
// - A short menu when ncdev.exe is double-clicked in Explorer (no arguments), so "download it and double-click"
//   works; from a terminal, no arguments still print the help and exit, as before.
// The parts that decide (quoting, the menu) are plain functions with what they need passed in, for the tests; the
// Windows calls are thin.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A string as a PowerShell single-quoted literal. */
export const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The PowerShell command that starts `exe args` with the permission prompt (-Verb RunAs), waits for it, and exits
 * with its exit code. When the person says no, Start-Process throws and PowerShell exits with 1223
 * (ERROR_CANCELLED), so the caller can tell "declined" from "ran and failed".
 */
export function elevateCommand(exe: string, args: string[]): string[] {
  // Each argument quoted for the child's command line (CommandLineToArgvW rules), then as a PowerShell literal.
  const winArg = (a: string) => (/[\s"]/.test(a) || !a ? `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"` : a);
  const list = args.map((a) => psQuote(winArg(a))).join(',');
  const script = `try { $p = Start-Process -FilePath ${psQuote(exe)} -ArgumentList @(${list}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit 1223 }`;
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
}

export interface ElevatedResult {
  /** The elevated copy ran (whatever it found). False: declined, or it couldn't be started. */
  ran: boolean;
  ok?: boolean;
  lines?: string[];
}

/**
 * Runs `exe args --elevated --result-file <tmp>` with the permission prompt and returns what it wrote. Windows only.
 * `spawn` is passed in for the tests.
 */
export function runElevated(exe: string, args: string[], spawn: typeof spawnSync = spawnSync): ElevatedResult {
  const resultFile = path.join(os.tmpdir(), `ncdev-setup-${process.pid}-${Date.now()}.json`);
  const r = spawn('powershell.exe', elevateCommand(exe, [...args, '--elevated', '--result-file', resultFile]), { encoding: 'utf8', windowsHide: true });
  try {
    if (r.error || r.status === 1223) return { ran: false };
    const out = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    return { ran: true, ok: !!out.ok, lines: Array.isArray(out.lines) ? out.lines.map(String) : [] };
  } catch {
    return { ran: false };
  } finally {
    fs.rmSync(resultFile, { force: true });
  }
}

/** The program `pid` runs (e.g. "explorer.exe"), from Windows' tasklist; undefined when it can't be told. */
export function processName(pid: number, spawn: typeof spawnSync = spawnSync): string | undefined {
  const r = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  if (r.error || r.status !== 0) return undefined;
  return /^"([^"]+)"/.exec(String(r.stdout).trim())?.[1];
}

/** Started by a double-click in Explorer (so its console closes as soon as it exits), not from a terminal. */
export function startedFromExplorer(platform = process.platform, ppid = process.ppid, name: (pid: number) => string | undefined = processName): boolean {
  if (platform !== 'win32' || !ppid) return false;
  return (name(ppid) ?? '').toLowerCase() === 'explorer.exe';
}

export interface MenuIO {
  ask(question: string): Promise<string>;
  say(text: string): void;
}
export interface MenuActions {
  setup(): Promise<number> | number;
  update(): Promise<number> | number;
  help(): void;
}

/** The double-click menu: one choice, then a key to close (the console window closes when ncdev exits). */
export async function runMenu(io: MenuIO, act: MenuActions, version: string): Promise<number> {
  io.say(
    [
      `ncdev ${version}: tools for Nucleus Co-op handlers`,
      '',
      '  1  Set up Notepad++ (adds the Nucleus Co-op handlers plugin; close Notepad++ first)',
      '  2  Update ncdev',
      '  3  Show the commands (for a terminal)',
      '',
    ].join('\n'),
  );
  const choice = (await io.ask('Type 1, 2 or 3 and press Enter (just Enter closes): ')).trim();
  let code = 0;
  if (!['1', '2', '3'].includes(choice)) return 0;
  // Whatever happens, the window stays until Enter, so the result (or the error) can be read.
  try {
    if (choice === '1') code = await act.setup();
    else if (choice === '2') code = await act.update();
    else act.help();
  } catch (e: any) {
    io.say(`\nThat didn't work: ${e?.message ?? e}`);
    code = 1;
  }
  await io.ask('\nPress Enter to close.');
  return code;
}
