// Installs a handler into Nucleus Co-op: `<Name>.js` into `<Nucleus>/handlers/` and the files of its `<Name>/` folder
// next to it (Game.Folder). Shared by VS Code's Install command, `ncdev install` and the Notepad++ plugin (through it).
import * as fs from 'node:fs';
import * as path from 'node:path';

export class InstallError extends Error {
  constructor(message: string, readonly code: 'no-handlers-folder' | 'exists' | 'same-file') {
    super(message);
  }
}

/** A Nucleus Co-op folder: the one with NucleusCoop.exe and `handlers`. */
export function isNucleusFolder(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, 'handlers')).isDirectory();
  } catch {
    return false;
  }
}

function filesIn(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesIn(abs, base));
    else if (e.isFile()) out.push(path.relative(base, abs));
  }
  return out;
}

/** Copies the handler and its asset folder. Refuses to replace an installed handler unless `overwrite`. */
export function installHandler(file: string, nucleus: string, opts: { overwrite?: boolean } = {}): { dest: string; assets: number } {
  if (!isNucleusFolder(nucleus)) throw new InstallError(`"${nucleus}" has no "handlers" folder: give the Nucleus Co-op folder (the one with NucleusCoop.exe).`, 'no-handlers-folder');
  const base = path.basename(file, '.js');
  const handlers = path.join(nucleus, 'handlers');
  const dest = path.join(handlers, `${base}.js`);
  if (path.resolve(dest).toLowerCase() === path.resolve(file).toLowerCase()) throw new InstallError('This handler is already in the Nucleus handlers folder.', 'same-file');
  if (fs.existsSync(dest) && !opts.overwrite) throw new InstallError(`${base}.js is already installed in ${handlers}.`, 'exists');
  fs.copyFileSync(file, dest);
  const assetDir = path.join(path.dirname(file), base);
  let assets = 0;
  if (fs.existsSync(assetDir) && fs.statSync(assetDir).isDirectory()) {
    for (const rel of filesIn(assetDir)) {
      const to = path.join(handlers, base, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(assetDir, rel), to);
      assets++;
    }
  }
  return { dest, assets };
}
