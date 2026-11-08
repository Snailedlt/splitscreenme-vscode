// Checks on a handler package's other files (the .zip / .nc around handler.js), by what Nucleus' Hub install does
// with them (DownloadPrompt.ExtractHandler, AGENTS.md in splitscreenme-vscode): handler.js at the root is the handler,
// every top-level folder's contents are merged into handlers/<GameName>/, other files at the root are dropped.
// Pure functions (no DOM, no Node): shared by the workbench, the VS Code extension, the CLI and `nucleus lsp`.

/** A file of a handler package other than handler.js: its path inside the package (with /) and its bytes. */
export interface PackageFile {
  name: string;
  data: Uint8Array;
  /** The real size when `data` was left out (too big to read for checks). */
  size?: number;
  /** A file of a Hub package that isn't downloaded here (too big): data is empty; size and the handler's Hub page. */
  remote?: { size: number; url: string };
}
/** The file's size (for a placeholder, its size in the Hub package). */
export const sizeOf = (f: PackageFile) => (f.remote ? f.remote.size : f.size ?? f.data.length);

export type FileKind = 'js' | 'ini' | 'cfg' | 'json' | 'xml' | 'txt' | 'bat' | 'ps1' | 'lua' | 'reg' | 'vdf' | 'toml' | 'yaml' | 'dll' | 'exe' | 'img' | 'bin';
const EXT: Record<string, FileKind> = {
  js: 'js', ini: 'ini', cfg: 'cfg', conf: 'cfg', json: 'json', xml: 'xml', txt: 'txt', md: 'txt', log: 'txt', bat: 'bat', cmd: 'bat', ps1: 'ps1', psm1: 'ps1', lua: 'lua', reg: 'reg', vdf: 'vdf', acf: 'vdf',
  toml: 'toml', yaml: 'yaml', yml: 'yaml', dll: 'dll', asi: 'dll', exe: 'exe', png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', ico: 'img', bmp: 'img',
};
export const kindOf = (name: string): FileKind => EXT[name.split('.').pop()!.toLowerCase()] ?? 'bin';
/** The text of a file, or null for binary (or too big to edit here). UTF-8, or UTF-16 with a BOM. */
export function textOf(data: Uint8Array): { text: string; enc: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' } | null {
  if (data.length > 1024 * 1024) return null;
  const le = data[0] === 0xff && data[1] === 0xfe, be = data[0] === 0xfe && data[1] === 0xff;
  try {
    if (le || be) return { text: new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(data.subarray(2)), enc: le ? 'utf16le' : 'utf16be' };
    if (data.subarray(0, 8000).includes(0)) return null;
    const bom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bom ? data.subarray(3) : data), enc: bom ? 'utf8bom' : 'utf8' };
  } catch {
    return null;
  }
}
/** Text back to bytes, in the file's own encoding. */
export function bytesOf(text: string, enc: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be'): Uint8Array {
  if (enc === 'utf8' || enc === 'utf8bom') {
    const b = new TextEncoder().encode(text);
    if (enc === 'utf8') return b;
    const out = new Uint8Array(b.length + 3);
    out.set([0xef, 0xbb, 0xbf]); out.set(b, 3);
    return out;
  }
  const out = new Uint8Array(2 + text.length * 2);
  out.set(enc === 'utf16le' ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 + i * 2] = enc === 'utf16le' ? c & 0xff : c >> 8;
    out[3 + i * 2] = enc === 'utf16le' ? c >> 8 : c & 0xff;
  }
  return out;
}

/** Where a package file ends up after a Hub install: handlers/<GameName>/<path inside its top folder>, or nowhere. */
export function installPath(name: string, gameName: string): string | null {
  const parts = name.split('/');
  if (parts.length < 2) return null; // at the root: dropped
  return `handlers\\${gameName}\\${parts.slice(1).join('\\')}`;
}
export const gameFolderName = (handler: string) => (handler.match(/^\s*Game\.GameName\s*=\s*"([^"\r\n]*)"/m)?.[1] ?? '<GameName>').replace(/[\/:*?"<>|]/g, '');

export interface PkgProblem {
  /** The package file it's about, or undefined for handler.js. */
  file?: string;
  /** 1-based line in that file, when it's about a line. */
  line?: number;
  /** Offsets in handler.js, for problems about the handler's text. */
  start?: number;
  end?: number;
  severity: 'error' | 'warning' | 'info';
  title: string;
  why: string;
  fix?: { title: string; kind: 'move'; from: string; to: string };
}

const lev = (a: string, b: string) => {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 9;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
};

/** Checks one text file's syntax (ini / cfg / json). */
export function checkFileText(name: string, text: string): PkgProblem[] {
  const k = kindOf(name), out: PkgProblem[] = [];
  if (k === 'json') {
    try { JSON.parse(text); } catch (e) {
      const m = String((e as Error).message).match(/position (\d+)/);
      const line = m ? text.slice(0, Number(m[1])).split('\n').length : undefined;
      out.push({ file: name, line, severity: 'error', title: 'Not valid JSON', why: `${String((e as Error).message).replace(/^JSON\.parse: /, '')}. Whatever reads this file will fail or ignore it.` });
    }
  } else if (k === 'ini') {
    let section = '';
    text.split(/\r?\n/).forEach((raw, i) => {
      const l = raw.trim();
      if (!l || l.startsWith(';') || l.startsWith('#') || l.startsWith('//')) return;
      if (/^\[.*\]$/.test(l)) { section = l.toLowerCase(); return; }
      const eq = l.indexOf('=');
      if (eq < 1) {
        out.push({ file: name, line: i + 1, severity: 'warning', title: 'Not a key=value line', why: 'INI lines are a [Section], a key=value pair or a ; comment. Nucleus\' IniSaveInfo (Context.ModifySaveFile) only finds keys written as key=value.' });
        return;
      }
      // Keys set twice aren't flagged: Unreal Engine configs repeat keys on purpose (lists), e.g. ServerPackages=.
    });
  }
  return out;
}

/** Checks the package as a whole, and the handler's references into it. */
export function checkPackage(handler: string, files: PackageFile[]): PkgProblem[] {
  const out: PkgProblem[] = [];
  if (!files.length) return out;
  const game = gameFolderName(handler);
  const tops = [...new Set(files.filter((f) => f.name.includes('/')).map((f) => f.name.split('/')[0]))];
  const target = tops[0] ?? game;
  for (const f of files) {
    if (!f.name.includes('/')) {
      out.push({ file: f.name, severity: 'warning', title: 'Dropped when installed from the Hub', why: `${f.name} is at the package's top level. A Hub install keeps handler.js and the contents of folders there, and drops other files at the top level.`, fix: { title: `Move into ${target}/`, kind: 'move', from: f.name, to: `${target}/${f.name}` } });
    }
    if (/[<>:"|?*\\]/.test(f.name)) out.push({ file: f.name, severity: 'error', title: 'A character Windows doesn\'t allow in names', why: 'File names can\'t contain < > : " | ? * or a backslash on Windows, so this file can\'t be installed.' });
    if (f.remote) continue; // in the Hub package, not here: nothing to check but its name
    if (sizeOf(f) > 25 * 1024 * 1024) out.push({ file: f.name, severity: 'info', title: 'A very large file', why: `${Math.round(sizeOf(f) / 1048576)} MB makes the package slow to download and may be too big for the Hub.` });
    if (f.size !== undefined && f.size !== f.data.length) continue; // left out (too big to check)
    const t = textOf(f.data);
    if (t && /\.(ini|cfg|conf|json)$/i.test(f.name)) out.push(...checkFileText(f.name, t.text));
  }
  // Names that only differ in case: one file on Windows.
  const lower = new Map<string, string>();
  for (const f of files) {
    const l = f.name.toLowerCase();
    if (lower.has(l)) out.push({ file: f.name, severity: 'warning', title: 'Two files with the same name on Windows', why: `${f.name} and ${lower.get(l)} only differ in upper and lower case, so one overwrites the other when installed.` });
    else lower.set(l, f.name);
  }
  // The handler's references to its own folder: Game.Folder + "\\x" and Path.Combine(Game.Folder, "x").
  const installed = new Map(files.filter((f) => f.name.includes('/')).map((f) => [f.name.split('/').slice(1).join('/').toLowerCase(), f.name]));
  const re = /Game\.Folder\s*\+\s*"((?:[^"\\]|\\.)*)"|Path\.Combine\(\s*Game\.Folder\s*,\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of handler.matchAll(re)) {
    const raw = (m[1] ?? m[2]).replace(/\\\\/g, '/').replace(/^\/+/, '');
    if (!raw || !/\.[a-z0-9]{1,5}$/i.test(raw) || /[%$]/.test(raw)) continue;
    if (installed.has(raw.toLowerCase())) continue;
    const near = [...installed.keys()].map((k) => [k, lev(k, raw.toLowerCase())] as const).sort((a, b) => a[1] - b[1])[0];
    // Only a likely typo is reported: many handlers download or create files in their folder at run time.
    if (!near || near[1] > 2) continue;
    const start = m.index! + m[0].indexOf('"') + 1;
    out.push({ start, end: start + (m[1] ?? m[2]).length, severity: near && near[1] <= 2 ? 'warning' : 'info', title: 'A file that isn\'t in the package', why: `The handler uses ${raw} in its own folder, but the package has no such file${near && near[1] <= 2 ? `. Did you mean ${installed.get(near[0])!.split('/').slice(1).join('/')}?` : '. Fine if the handler creates it first.'}` });
  }
  return out;
}

/** The install map: what goes where. */
export function installMap(handler: string, files: PackageFile[]): { name: string; to: string | null; size: number }[] {
  const game = gameFolderName(handler);
  return [{ name: 'handler.js', to: `handlers\\${game}.js`, size: new TextEncoder().encode(handler).length }, ...files.map((f) => ({ name: f.name, to: installPath(f.name, game), size: sizeOf(f) }))];
}
