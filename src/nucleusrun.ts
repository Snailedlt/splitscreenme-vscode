// "Test in Nucleus Co-op": install the handler, then start Nucleus Co-op with its game selected. Shared by VS Code's
// command, `ncdev test`, `ncdev lsp` (nucleus.testInNucleus) and the Notepad++ plugin (through ncdev).
// What Nucleus does (splitscreenme-nucleus): `NucleusCoop.exe <GUID>` selects the game whose handler has that
// Game.GUID, if the game is in the player's list (MainForm.OnShown, startArgs[0]); a second NucleusCoop.exe shows
// "already running" and quits (StartChecks.IsAlreadyRunning), so a running one is closed first, with the user's OK;
// Settings.ini in the working folder (Globals.ini) holds [Misc] DebugLog=True|False, and debug-log.txt is written
// next to NucleusCoop.exe. Handlers are read when Nucleus starts, hence the restart.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { installHandler, InstallError } from './install';

export const NUCLEUS_EXE = 'NucleusCoop.exe';

export interface NucleusStatus {
  /** Can it be started from here (Windows, and NucleusCoop.exe found)? */
  canStart: boolean;
  why?: string;
  running: boolean;
  /** [Misc] DebugLog in Settings.ini; undefined when there's no Settings.ini yet. */
  debugLog?: boolean;
}

export function nucleusStatus(dir: string): NucleusStatus {
  const exe = path.join(dir, NUCLEUS_EXE);
  if (process.platform !== 'win32') return { canStart: false, why: 'Nucleus Co-op runs on Windows: install the handler, then start Nucleus there.', running: false, debugLog: debugLogOn(dir) };
  if (!fs.existsSync(exe)) return { canStart: false, why: `There's no ${NUCLEUS_EXE} in ${dir}.`, running: false, debugLog: debugLogOn(dir) };
  return { canStart: true, running: nucleusRunning(), debugLog: debugLogOn(dir) };
}

export function nucleusRunning(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    // The whole list, read here (some tasklists, Wine's among them, ignore /FI).
    const out = execFileSync('tasklist', ['/NH'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    // Usually the console's code page; some write UTF-16 to a pipe.
    const list = (out.includes(0) ? out.toString('utf16le') : out.toString('latin1')).toLowerCase();
    return list.split(/\r?\n/).some((l) => l.trimStart().startsWith(NUCLEUS_EXE.toLowerCase()));
  } catch (e) {
    if (process.env.NCDEV_DEBUG) console.error(e);
    return false;
  }
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** stopNucleus for callers that answer synchronously (the language server). */
export function stopNucleusSync() {
  const kill = (force: boolean) => {
    try {
      execFileSync('taskkill', [...(force ? ['/F'] : []), '/IM', NUCLEUS_EXE], { windowsHide: true, stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  };
  kill(false);
  for (let i = 0; i < 20 && nucleusRunning(); i++) sleepSync(250);
  // Still there (a dialog open in it): ended, one at a time if need be (some taskkills end one match per call).
  for (let i = 0; i < 10 && nucleusRunning(); i++) {
    kill(true);
    sleepSync(300);
  }
}

/** Asks Nucleus to close (like clicking its close button), then waits for it; only if it won't, ends it. */
export async function stopNucleus(): Promise<void> {
  const kill = (force: boolean) => {
    try {
      execFileSync('taskkill', [...(force ? ['/F'] : []), '/IM', NUCLEUS_EXE], { windowsHide: true, stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  };
  kill(false);
  for (let i = 0; i < 20 && nucleusRunning(); i++) await new Promise((r) => setTimeout(r, 250));
  // Still there (a dialog open in it): ended, one at a time if need be (some taskkills end one match per call).
  for (let i = 0; i < 10 && nucleusRunning(); i++) {
    kill(true);
    await new Promise((r) => setTimeout(r, 300));
  }
}

// Settings.ini: Nucleus writes it with WritePrivateProfileString (UTF-16 or ANSI); read and write it the same way.
function readIni(file: string): { text: string; utf16: boolean } | undefined {
  if (!fs.existsSync(file)) return undefined;
  const buf = fs.readFileSync(file);
  const utf16 = buf[0] === 0xff && buf[1] === 0xfe;
  return { text: utf16 ? buf.toString('utf16le').slice(1) : buf.toString('latin1'), utf16 };
}

export function debugLogOn(dir: string): boolean | undefined {
  const ini = readIni(path.join(dir, 'Settings.ini'));
  if (!ini) return undefined;
  const m = /^\[Misc\][^\[]*?^\s*DebugLog\s*=\s*(\w+)/im.exec(ini.text);
  return m ? m[1].toLowerCase() === 'true' : false;
}

/** Turns Nucleus' debug log on or off ([Misc] DebugLog in its Settings.ini); everything else stays as it was. */
export function setDebugLog(dir: string, on: boolean) {
  const file = path.join(dir, 'Settings.ini');
  const ini = readIni(file) ?? { text: '', utf16: false };
  const value = on ? 'True' : 'False';
  let text = ini.text;
  const misc = /^\[Misc\][^\S\n]*\r?\n/im.exec(text);
  if (!misc) text = text.replace(/\s*$/, '') + `${text.trim() ? '\r\n\r\n' : ''}[Misc]\r\nDebugLog=${value}\r\n`;
  else {
    const start = misc.index + misc[0].length;
    const next = text.slice(start).search(/^\[/m);
    const end = next < 0 ? text.length : start + next;
    const section = text.slice(start, end);
    const updated = /^\s*DebugLog\s*=.*$/im.test(section) ? section.replace(/^(\s*DebugLog\s*=).*$/im, `$1${value}`) : `DebugLog=${value}\r\n` + section;
    text = text.slice(0, start) + updated + text.slice(end);
  }
  fs.writeFileSync(file, ini.utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]) : Buffer.from(text, 'latin1'));
}

export const debugLogPath = (dir: string) => path.join(dir, 'debug-log.txt');

/** Game.GUID as written in the handler (what Nucleus selects the game by). */
export function guidOf(text: string): string | undefined {
  return /^\s*Game\s*\.\s*GUID\s*=\s*(["'])((?:[^\\\n]|\\.)*?)\1/m.exec(text)?.[2];
}

/** Installs the handler and starts Nucleus Co-op on its game. Close a running Nucleus first (stopNucleus). */
export function testInNucleus(file: string, dir: string): { dest: string; assets: number; guid?: string } {
  let r = { dest: path.join(dir, 'handlers', path.basename(file)), assets: 0 };
  try {
    r = installHandler(file, dir, { overwrite: true });
  } catch (e) {
    if (!(e instanceof InstallError && e.code === 'same-file')) throw e; // edited right in Nucleus' handlers folder
  }
  const guid = guidOf(fs.readFileSync(file, 'utf8'));
  const child = spawn(path.join(dir, NUCLEUS_EXE), guid ? [guid] : [], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { ...r, guid };
}

export const AFTER_START =
  "Nucleus Co-op is starting with this game selected. Pick the players and press Play. If the game isn't in your list yet, add it first (Nucleus asks for its .exe); then it's selected next time.";
