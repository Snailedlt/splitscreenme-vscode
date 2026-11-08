// Reading a game's install folder from disk (names and sizes only), for the game-folder checks in core/gamefolder.ts.
// No vscode import: used by the extension (src/gamefolders.ts) and `nucleus lsp`.
import fs from 'node:fs';
import path from 'node:path';
import { MAX_DEPTH, MAX_ENTRIES, SKIP_DIRS, type GameFolder } from './core/gamefolder';

/** The folder's files and folders (relative, with "/"), breadth first, within the same limits as the workbench. */
export function readGameFolder(dir: string): GameFolder {
  const files: GameFolder['files'] = [];
  const dirs: string[] = [];
  let truncated = false;
  let count = 0;
  const queue: { abs: string; rel: string; depth: number }[] = [{ abs: dir, rel: '', depth: 0 }];
  while (queue.length) {
    const { abs, rel, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++count > MAX_ENTRIES) {
        truncated = true;
        break;
      }
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        dirs.push(p);
        if (depth + 1 < MAX_DEPTH) queue.push({ abs: path.join(abs, e.name), rel: p, depth: depth + 1 });
        else truncated = true;
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(path.join(abs, e.name)).size;
        } catch {
          /* unreadable: size 0 */
        }
        files.push({ path: p, size });
      }
    }
    if (count > MAX_ENTRIES) break;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  dirs.sort((a, b) => a.localeCompare(b));
  return { name: path.basename(dir), files, dirs, truncated: truncated || undefined };
}

const cache = new Map<string, { at: number; folder: GameFolder }>();
export function folderAt(dir: string): GameFolder | undefined {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < 60_000) return hit.folder;
  if (!fs.existsSync(dir)) return undefined;
  const folder = readGameFolder(dir);
  cache.set(dir, { at: Date.now(), folder });
  return folder;
}


/** Read the folder again next time (it was just linked, or changed). */
export const forgetFolder = (dir: string) => cache.delete(dir);
