// `nucleus setup notepad++`: adds the Nucleus names and call tips to Notepad++ (core/notepadpp.ts), and a Run-menu
// entry that checks the open handler. Keeps a backup of Notepad++'s own file; `--remove` puts it back.
import fs from 'node:fs';
import path from 'node:path';
import { mergeNotepadPP, notepadPPVersion } from './core/notepadpp';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';
const RUN_NAME = 'Nucleus: check this handler';

/** Notepad++'s folder: --path, else the usual install folders on Windows. */
export function findNotepadPP(given?: string): string | undefined {
  const candidates = given ? [given] : [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean).map((p) => path.join(p!, 'Notepad++'));
  return candidates.find((d) => fs.existsSync(path.join(d, 'autoCompletion', 'javascript.xml')));
}

/** Notepad++'s shortcuts.xml: next to the program when it runs portable (doLocalConf.xml), else in %APPDATA%. */
function shortcutsFile(dir: string): string | undefined {
  if (fs.existsSync(path.join(dir, 'doLocalConf.xml'))) return path.join(dir, 'shortcuts.xml');
  return process.env.APPDATA ? path.join(process.env.APPDATA, 'Notepad++', 'shortcuts.xml') : undefined;
}

export interface SetupResult {
  ok: boolean;
  lines: string[];
}

export function setupNotepadPP(opts: { path?: string; remove?: boolean; check?: boolean; runCommand?: string }): SetupResult {
  const dir = findNotepadPP(opts.path);
  if (!dir) return { ok: false, lines: [opts.path ? `No Notepad++ found in ${opts.path} (no autoCompletion\\javascript.xml there).` : 'Notepad++ wasn\'t found in Program Files. Pass its folder: nucleus setup notepad++ --path "C:\\path\\to\\Notepad++"'] };
  const file = path.join(dir, 'autoCompletion', 'javascript.xml');
  const backup = `${file}.nucleus-backup`;
  const current = fs.readFileSync(file, 'utf8');
  const installed = notepadPPVersion(current);
  if (opts.check) {
    if (!installed) return { ok: false, lines: [`Not set up in ${dir}. Run: nucleus setup notepad++${opts.path ? ` --path "${opts.path}"` : ''}`] };
    return { ok: installed === VERSION, lines: [installed === VERSION ? `Up to date (${VERSION}) in ${dir}.` : `Set up with ${installed}; this is ${VERSION}. Run nucleus setup notepad++ again to update the names.`] };
  }
  const lines: string[] = [];
  try {
    if (opts.remove) {
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, file);
        fs.rmSync(backup);
        lines.push(`Removed the Nucleus names: Notepad++'s own JavaScript list is back (${file}).`);
      } else lines.push('Nothing to remove: Notepad++\'s JavaScript list has no Nucleus names.');
    } else {
      // Always merge from Notepad++'s original, so names that left the API leave the list too.
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
      fs.writeFileSync(file, mergeNotepadPP(fs.readFileSync(backup, 'utf8'), VERSION));
      lines.push(`Added the Nucleus names and call tips to Notepad++ (${file}); its own JavaScript words are kept. Restart Notepad++ to use them.`);
    }
  } catch (e: any) {
    if (e?.code === 'EACCES' || e?.code === 'EPERM') return { ok: false, lines: [`Notepad++'s folder isn't writable (${dir}). Run this once from a terminal opened as administrator, or use a portable Notepad++ with --path.`] };
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
