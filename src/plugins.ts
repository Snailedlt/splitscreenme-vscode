// The plugin globals of a handler on disk: Nucleus reads `<Game.Folder>/pluginsInfo.txt`, and
// Game.Folder is `handlers/<js file name without .js>/`. Also looks one folder down, for a
// downloaded package kept as `<name>/<package folder>/`. Undefined when there is no such folder
// (the linter then can't tell a plugin from a typo).
import * as fs from 'fs';
import * as path from 'path';
import { pluginGlobals } from './core/lint';

export function lintPluginsFor(file: string): string[] | undefined {
  const folder = file.replace(/\.js$/i, '');
  if (folder === file || !isDir(folder)) return undefined;
  const found: string[] = [];
  const read = (f: string) => {
    try {
      found.push(...pluginGlobals(fs.readFileSync(f, 'utf8')));
    } catch {
      /* none */
    }
  };
  read(path.join(folder, 'pluginsInfo.txt'));
  try {
    for (const d of fs.readdirSync(folder)) if (isDir(path.join(folder, d))) read(path.join(folder, d, 'pluginsInfo.txt'));
  } catch {
    /* ignore */
  }
  return found;
}

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
