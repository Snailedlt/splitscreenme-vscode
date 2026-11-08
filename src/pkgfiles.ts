// The package files next to a handler on disk, for the package checks (core/pkgcheck.ts): `<dir>/<Name>.js` and its
// folder `<dir>/<Name>/` (Nucleus' Game.Folder), named as they go into the .nc (`<Name>/<path>`, the same as
// Package Handler for the Hub). Shared by the extension, the CLI and `nucleus lsp`. Node only.
import fs from 'node:fs';
import path from 'node:path';
import type { PackageFile } from './core/pkgcheck';

/** Files bigger than this aren't read (only their size is kept): the checks only look at small text files. */
const READ_MAX = 1024 * 1024;
const MAX_FILES = 2000;
const cache = new Map<string, { at: number; files: PackageFile[] | undefined }>();

/** The handler's package files, or undefined when it has no folder. Cached for a few seconds (it runs while typing). */
export function packageFilesFor(handlerPath: string, maxAgeMs = 3000): PackageFile[] | undefined {
  const hit = cache.get(handlerPath);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.files;
  const base = path.basename(handlerPath, path.extname(handlerPath));
  const dir = path.join(path.dirname(handlerPath), base);
  let files: PackageFile[] | undefined;
  try {
    if (fs.statSync(dir).isDirectory()) {
      files = [];
      const walk = (d: string, rel: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (files!.length >= MAX_FILES) return;
          const abs = path.join(d, e.name);
          const name = `${rel}/${e.name}`;
          if (e.isDirectory()) walk(abs, name);
          else if (e.isFile()) {
            const size = fs.statSync(abs).size;
            files!.push(size <= READ_MAX ? { name, data: fs.readFileSync(abs) } : { name, data: new Uint8Array(0), size });
          }
        }
      };
      walk(dir, base);
    }
  } catch {
    files = undefined;
  }
  cache.set(handlerPath, { at: Date.now(), files });
  return files;
}

/** Forget cached files (a file in the folder changed). */
export const forgetPackageFiles = (handlerPath?: string) => (handlerPath ? cache.delete(handlerPath) : cache.clear());

/** A package file's path on disk, from its name in the package. */
export const packageFilePath = (handlerPath: string, name: string) => path.join(path.dirname(handlerPath), ...name.split('/'));

/** The open handler whose folder holds this path (`<dir>/<Name>/…` for `<dir>/<Name>.js`), if any. */
export function packageFileForPath(file: string, handlers: string[]): string | undefined {
  return handlers.find((h) => /\.js$/i.test(h) && file.startsWith(h.replace(/\.js$/i, '') + path.sep));
}
