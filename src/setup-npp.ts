// `ncdev setup notepad++`: Nucleus Co-op handler support in Notepad++.
// - With the plugin (NcDev.dll, npp-plugin/; inside the standalone ncdev): problems underlined in the code, docs on
//   hover, suggestions, quick fixes, Try it… The plugin runs `ncdev lsp`; NcDev.ini in Notepad++'s plugin config folder
//   says where ncdev is.
// - Without it (an ncdev with no plugin inside, e.g. `node nucleus.js`): the Nucleus names and call tips merged into
//   Notepad++'s own JavaScript auto-completion file (core/notepadpp.ts), keeping a backup.
// Both: a Run menu entry that checks the open handler. `--remove` undoes everything.
import fs from 'node:fs';
import path from 'node:path';
import { mergeNotepadPP, notepadPPVersion } from './core/notepadpp';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';
const RUN_NAME = 'Nucleus: check this handler';
export const PLUGIN_DIR = 'NcDev';

/** Notepad++'s folder: --path, else the usual install folders on Windows. */
export function findNotepadPP(given?: string): string | undefined {
  const candidates = given ? [given] : [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean).map((p) => path.join(p!, 'Notepad++'));
  return candidates.find((d) => fs.existsSync(path.join(d, 'autoCompletion', 'javascript.xml')));
}

const portable = (dir: string) => fs.existsSync(path.join(dir, 'doLocalConf.xml'));
/** Notepad++'s shortcuts.xml: next to the program when it runs portable (doLocalConf.xml), else in %APPDATA%. */
function shortcutsFile(dir: string): string | undefined {
  if (portable(dir)) return path.join(dir, 'shortcuts.xml');
  return process.env.APPDATA ? path.join(process.env.APPDATA, 'Notepad++', 'shortcuts.xml') : undefined;
}
/** Where plugins keep their settings (NPPM_GETPLUGINSCONFIGDIR). */
export function pluginConfigDir(dir: string): string | undefined {
  if (portable(dir)) return path.join(dir, 'plugins', 'Config');
  return process.env.APPDATA ? path.join(process.env.APPDATA, 'Notepad++', 'plugins', 'config') : undefined;
}

export interface SetupResult {
  ok: boolean;
  lines: string[];
  /** Notepad++'s folder isn't writable (Program Files without administrator rights). */
  denied?: boolean;
}

export interface SetupOptions {
  path?: string;
  remove?: boolean;
  check?: boolean;
  /** The Run menu's command line (with $(FULL_CURRENT_PATH)). */
  runCommand?: string;
  /** The plugin DLLs this ncdev has, by Notepad++'s architecture; the one matching notepad++.exe is installed. */
  plugins?: Partial<Record<NppArch, Buffer>>;
  /** Where the plugin finds ncdev (written to NcDev.ini). */
  toolPath?: string;
}

export type NppArch = 'x64' | 'x86' | 'arm64';
/** 64-bit, 32-bit or ARM Notepad++ (the PE header's machine field of notepad++.exe); a plugin DLL must match it. */
export function nppArch(dir: string): NppArch | undefined {
  try {
    const fd = fs.openSync(path.join(dir, 'notepad++.exe'), 'r');
    const b = Buffer.alloc(4096);
    fs.readSync(fd, b, 0, 4096, 0);
    fs.closeSync(fd);
    const pe = b.readUInt32LE(0x3c);
    if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') return undefined;
    return ({ 0x8664: 'x64', 0x14c: 'x86', 0xaa64: 'arm64' } as Record<number, NppArch>)[b.readUInt16LE(pe + 4)];
  } catch {
    return undefined;
  }
}

/** NcDev.ini's text (UTF-16 with a BOM when we wrote it, maybe ANSI when someone edited it). */
export function readIni(file: string): string {
  if (!fs.existsSync(file)) return '';
  const b = fs.readFileSync(file);
  return b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString('utf16le') : b.toString('utf8').replace(/^\uFEFF/, '');
}

/** Writes a file that may be in use (a loaded DLL): moves the old one aside first, which Windows allows. */
function replaceFile(file: string, data: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const old = `${file}.old`;
    try {
      fs.rmSync(old, { force: true });
    } catch {
      /* still loaded from an earlier update: leave it */
    }
    try {
      fs.renameSync(file, old);
    } catch (e: any) {
      if (e?.code === 'EACCES' || e?.code === 'EPERM') throw e;
    }
  }
  fs.writeFileSync(file, data);
}

export function setupNotepadPP(opts: SetupOptions): SetupResult {
  const dir = findNotepadPP(opts.path);
  if (!dir) return { ok: false, lines: [opts.path ? `No Notepad++ found in ${opts.path} (no autoCompletion\\javascript.xml there).` : 'Notepad++ wasn\'t found in Program Files. Pass its folder: ncdev setup notepad++ --path "C:\\path\\to\\Notepad++"'] };
  const file = path.join(dir, 'autoCompletion', 'javascript.xml');
  const backup = `${file}.nucleus-backup`;
  const dll = path.join(dir, 'plugins', PLUGIN_DIR, `${PLUGIN_DIR}.dll`);
  const cfg = pluginConfigDir(dir);
  const ini = cfg ? path.join(cfg, `${PLUGIN_DIR}.ini`) : undefined;
  const current = fs.readFileSync(file, 'utf8');
  const installed = notepadPPVersion(current);
  const hasPlugin = fs.existsSync(dll);
  // The DLL for this Notepad++ (64-bit when it can't be told). ARM64 Notepad++ gets the names instead.
  const arch = nppArch(dir) ?? 'x64';
  const plugin = opts.plugins?.[arch];
  if (opts.check) {
    if (hasPlugin) {
      const where = ini ? /^path=(.*)$/m.exec(readIni(ini))?.[1]?.trim() : undefined;
      return { ok: true, lines: [`The Nucleus plugin is installed in ${dir}${where ? `; it runs ${where}` : ''}. ncdev update keeps the tool current.`] };
    }
    if (!installed) return { ok: false, lines: [`Not set up in ${dir}. Run: ncdev setup notepad++${opts.path ? ` --path "${opts.path}"` : ''}`] };
    return { ok: installed === VERSION, lines: [installed === VERSION ? `Up to date (${VERSION}) in ${dir}.` : `Set up with ${installed}; this is ${VERSION}. Run ncdev setup notepad++ again to update the names.`] };
  }
  const lines: string[] = [];
  try {
    if (opts.remove) {
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, file);
        fs.rmSync(backup);
        lines.push(`Removed the Nucleus names: Notepad++'s own JavaScript list is back (${file}).`);
      }
      if (hasPlugin) {
        fs.rmSync(path.dirname(dll), { recursive: true, force: true });
        lines.push(`Removed the Nucleus plugin (${path.dirname(dll)}).`);
      }
      if (ini && fs.existsSync(ini)) fs.rmSync(ini);
      if (!lines.length) lines.push('Nothing to remove: no Nucleus plugin or names in this Notepad++.');
    } else if (plugin) {
      replaceFile(dll, plugin);
      if (ini) {
        fs.mkdirSync(path.dirname(ini), { recursive: true });
        // Keep the linked game folders; set where ncdev is.
        const rest = readIni(ini).replace(/\[ncdev\][^[]*/i, '').trim();
        // UTF-16 with a BOM: what Windows' profile functions read paths with any characters from.
        fs.writeFileSync(ini, `\uFEFF[ncdev]\r\npath=${opts.toolPath ?? ''}\r\n${rest ? `\r\n${rest}\r\n` : ''}`, 'utf16le');
      }
      // The plugin suggests names itself, knowing where you are; the static list would pop up as well.
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, file);
        fs.rmSync(backup);
      }
      lines.push(`Installed the Nucleus plugin in Notepad++ (${arch === 'x86' ? '32-bit, ' : ''}${dll}). Restart Notepad++, open a handler, and see Plugins › Nucleus Co-op handlers.`);
    } else {
      // Always merge from Notepad++'s original, so names that left the API leave the list too.
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
      fs.writeFileSync(file, mergeNotepadPP(fs.readFileSync(backup, 'utf8'), VERSION));
      lines.push(`Added the Nucleus names and call tips to Notepad++ (${file}); its own JavaScript words are kept. Restart Notepad++ to use them.`);
      if (opts.plugins && !plugin) lines.push(`There's no plugin for ${arch} Notepad++ yet, so it gets the names and call tips instead. Ask for one: https://github.com/Snailedlt/splitscreenme-vscode/issues`);
    }
  } catch (e: any) {
    if (e?.code === 'EACCES' || e?.code === 'EPERM') return { ok: false, denied: true, lines: [`Notepad++'s folder isn't writable (${dir}). Run this once from a terminal opened as administrator (right-click › Run as administrator), or use a portable Notepad++ with --path.`] };
    throw e;
  }
  // The Run menu entry (a command line Notepad++ runs with the open file).
  const sc = shortcutsFile(dir);
  if (sc && opts.runCommand !== undefined) {
    let xml = fs.existsSync(sc) ? fs.readFileSync(sc, 'utf8') : '<?xml version="1.0" encoding="UTF-8" ?>\n<NotepadPlus>\n    <UserDefinedCommands>\n    </UserDefinedCommands>\n</NotepadPlus>\n';
    xml = xml.replace(new RegExp(`\\s*<Command name="${RUN_NAME}"[^>]*>[^<]*</Command>`, 'g'), '');
    if (!opts.remove) {
      const entry = `\n        <Command name="${RUN_NAME}" Ctrl="no" Alt="no" Shift="no" Key="0">${opts.runCommand.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Command>`;
      xml = /<UserDefinedCommands>/.test(xml) ? xml.replace(/<UserDefinedCommands>/, `<UserDefinedCommands>${entry}`) : xml.replace(/<\/NotepadPlus>/, `    <UserDefinedCommands>${entry}\n    </UserDefinedCommands>\n</NotepadPlus>`);
    }
    fs.mkdirSync(path.dirname(sc), { recursive: true });
    fs.writeFileSync(sc, xml);
    lines.push(opts.remove ? `Removed "${RUN_NAME}" from the Run menu.` : `Added "${RUN_NAME}" to Notepad++'s Run menu (${sc}). Close Notepad++ before running this: it rewrites that file when it exits.`);
  }
  return { ok: true, lines };
}
