// The game's install folder, picked by the author, checked against the handler's paths (issue #6).
// Only names, relative paths and sizes are read; no file content, nothing leaves the browser.
// The checks follow how Nucleus itself resolves each option (file:line in the Nucleus Master sources):
// - Game root: the folder of the exe the user picked, with Game.BinariesFolder removed from its path as text
//   (GenericGameHandler.cs:385-396, StringUtil.ReplaceCaseInsensitive / GetRootFromBinariesFolder).
// - FileSymlinkExclusions / FileSymlinkCopyInstead: lower-cased, then compared with every file NAME in every
//   linked folder by "contains" (GenericGameHandler.cs:839-860, WinDirectoryUtil.cs:41 and :59).
// - DirSymlinkExclusions / DirSymlinkCopyInstead / DirExclusions: paths relative to the game root, compared with
//   Windows paths as text (WinDirectoryUtil.cs:114-127; DirSymlinkCopyInstead also Directory.Exists, :900).
// - SymlinkFiles, CopyFiles: relative to the game root (GenericContext.cs:280, GenericGameHandler.cs:764).
// - ExecutableContext: relative to the exe's folder, each must exist or the handler doesn't match (GameManager.cs:130-140).
// - ExecutableName / ExecutableNames: matched against the picked file's name, any case (GameManager.cs:110, :119).
// - Context.RootFolder / OrigRootFolder: the game root (instance / original); Context.RootInstallFolder: the
//   exe's folder (GenericGameHandler.cs:1274-1276).
// Pure (no DOM, no Node): shared by the workbench (playground/src/gamefolder.ts in nucleuscoop-handler-testbench
// adds the folder picker) and VS Code (src/gamefolder-node.ts reads the folder from disk). Tests: src/test/gamefolder.test.ts.

export interface GameFolder {
  /** The picked folder's own name. */
  name: string;
  /** Files, relative to the picked folder, with "/". */
  files: { path: string; size: number }[];
  /** Folders, relative to the picked folder, with "/". */
  dirs: string[];
  /** The executable the handler names, if found when picking (checks look it up again from the handler). */
  exe?: string;
  /** True when the walk stopped at a limit (entries or depth): some files are missing from the lists. */
  truncated?: boolean;
}

export interface FolderFix { title: string; text: string; start: number; end: number }
export interface FolderProblem {
  start: number;
  end: number;
  severity: 'error' | 'warning' | 'info';
  title: string;
  why: string;
  fix?: FolderFix;
}

export const MAX_ENTRIES = 30000;
export const MAX_DEPTH = 8;
export const SKIP_DIRS = new Set(['.git', '.svn', '.hg', '__pycache__', 'node_modules', '$recycle.bin', 'system volume information']);

// ---------------------------------------------------------------------------------------------------------------
// Text scanning: string literals and a copy of the text with comments and string contents blanked.

interface StrTok { start: number; end: number; value: string; quote: string }
interface Scan { masked: string; strings: StrTok[] }

function scan(text: string): Scan {
  const out = text.split('');
  const strings: StrTok[] = [];
  let i = 0;
  let prev = ''; // last significant character outside comments/strings, for the regex-or-divide guess
  const blank = (a: number, b: number) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') { const e = text.indexOf('\n', i); const end = e < 0 ? text.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); const end = e < 0 ? text.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      while (j < text.length && text[j] !== c && text[j] !== '\n') {
        if (text[j] === '\\' && j + 1 < text.length) {
          const e = text[j + 1];
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          j += 2;
        } else v += text[j++];
      }
      const end = Math.min(j + 1, text.length);
      strings.push({ start: i, end, value: v, quote: c });
      blank(i + 1, end - 1);
      i = end; prev = c; continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) { // a regex literal
      let j = i + 1, cls = false;
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '[') cls = true; else if (text[j] === ']') cls = false; else if (text[j] === '/' && !cls) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1; prev = '/'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { masked: out.join(''), strings };
}

const sameMember = (a: string, b: string) => a.length === b.length && a[0].toLowerCase() === b[0].toLowerCase() && a.slice(1) === b.slice(1); // Jint: first char any case

/** Brace depth at each offset (0: top level, where Nucleus' load-time options are set). */
function topLevel(s: Scan): (at: number) => boolean {
  const marks: number[] = []; // offsets where the depth changes to/from 0
  let d = 0;
  for (let i = 0; i < s.masked.length; i++) {
    const c = s.masked[i];
    if (c === '{') { if (d === 0) marks.push(i); d++; } else if (c === '}' && d > 0) { d--; if (d === 0) marks.push(i); }
  }
  return (at) => { let n = 0; for (const m of marks) { if (m >= at) break; n++; } return n % 2 === 0; };
}

/** `Game.<name> = "…"`: the string assigned when the handler loads (the last top-level one; else the first anywhere). */
function scalar(s: Scan, name: string): StrTok | undefined {
  let top: StrTok | undefined, any: StrTok | undefined;
  const isTop = topLevel(s);
  for (const m of s.masked.matchAll(/\bGame\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?![=>])\s*/g)) {
    if (!sameMember(m[1], name)) continue;
    const at = m.index! + m[0].length;
    const t = s.strings.find((x) => x.start === at);
    if (!t) continue;
    any ??= t;
    if (isTop(m.index!)) top = t;
  }
  return top ?? any;
}

/** An array literal assigned to a Game option, with its string entries. */
export interface FolderList {
  /** The option name as Nucleus spells it, e.g. "FileSymlinkExclusions". */
  option: string;
  kind: ListKind;
  /** Offsets of `[` and `]`. */
  open: number;
  close: number;
  items: { start: number; end: number; value: string }[];
  /** The quote the entries use (for inserting). */
  quote: string;
}
/** names: compared with file names; root-dirs / root-files: paths from the game root; exe-entries: from the exe's folder. */
export type ListKind = 'names' | 'root-dirs' | 'root-files' | 'exe-entries';

const LIST_OPTIONS: Record<string, ListKind> = {
  FileSymlinkExclusions: 'names',
  FileSymlinkCopyInstead: 'names',
  DirSymlinkExclusions: 'root-dirs',
  DirSymlinkCopyInstead: 'root-dirs',
  DirExclusions: 'root-dirs',
  SymlinkFiles: 'root-files',
  CopyFiles: 'root-files',
  ExecutableContext: 'exe-entries',
};

function listsIn(s: Scan): FolderList[] {
  const out: FolderList[] = [];
  for (const m of s.masked.matchAll(/\bGame\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?![=>])\s*\[/g)) {
    const option = Object.keys(LIST_OPTIONS).find((o) => sameMember(m[1], o));
    if (!option) continue;
    const open = m.index! + m[0].length - 1;
    let depth = 0, close = -1;
    const starts = new Map(s.strings.map((t) => [t.start, t]));
    const items: FolderList['items'] = [];
    for (let k = open; k < s.masked.length; k++) {
      const ch = s.masked[k];
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { close = k; break; } }
      else if (depth === 1 && starts.has(k)) { const t = starts.get(k)!; items.push({ start: t.start, end: t.end, value: t.value }); }
    }
    if (close < 0) continue;
    const first = items[0] && s.strings.find((t) => t.start === items[0].start);
    out.push({ option, kind: LIST_OPTIONS[option], open, close, items, quote: first?.quote ?? '"' });
  }
  return out;
}

/** The lists the folder picker can add to, in the handler text. */
export const folderLists = (handlerText: string): FolderList[] => listsIn(scan(handlerText));

// ---------------------------------------------------------------------------------------------------------------
// Folder helpers.

const lower = (s: string) => s.toLowerCase();
export const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
export const join = (a: string, b: string) => (a ? (b ? `${a}/${b}` : a) : b);
const under = (p: string, root: string) => (root ? lower(p).startsWith(lower(root) + '/') : true);
const rel = (p: string, root: string) => (root ? p.slice(root.length + 1) : p);
const winPath = (p: string) => p.replace(/\//g, '\\');

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 8) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** The closest candidate (any case), only when close enough to be a likely typo. */
function closest(want: string, candidates: Iterable<string>): string | undefined {
  const w = lower(want);
  let best: string | undefined, bestD = Infinity;
  for (const c of candidates) {
    const d = lev(w, lower(c));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best !== undefined && bestD > 0 && bestD <= Math.max(2, Math.floor(w.length / 4)) ? best : undefined;
}

interface Located {
  /** The exe the handler names (path in the folder), if found. */
  exe?: string;
  exeDir?: string;
  /** The game root relative to the picked folder; undefined when it can't be told (exe missing, or above the folder). */
  root?: string;
  binaries?: StrTok;
}

function locate(s: Scan, folder: GameFolder): Located {
  const nameTok = scalar(s, 'ExecutableName');
  const names = new Set<string>();
  if (nameTok?.value) names.add(lower(nameTok.value));
  for (const m of s.masked.matchAll(/\bGame\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?![=>])\s*\[([^\]]*)\]/g)) {
    if (!sameMember(m[1], 'ExecutableNames')) continue;
    const a = m.index! + m[0].indexOf('['), b = m.index! + m[0].length;
    for (const t of s.strings) if (t.start > a && t.end <= b && t.value) names.add(lower(t.value));
  }
  const hits = folder.files.filter((f) => names.has(lower(base(f.path)))).sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  const binaries = scalar(s, 'BinariesFolder');
  if (!hits.length) return { binaries };
  const exe = hits[0].path, exeDir = dirOf(exe);
  if (!binaries?.value) return { exe, exeDir, root: exeDir, binaries };
  const pathFix = /\bGame\s*\.\s*[Bb]inariesFolderPathFix\s*=\s*true\b/.test(s.masked);
  const dirWin = winPath(exeDir);
  if (pathFix) { // StringUtil.GetRootFromBinariesFolder: the path up to the first part equal to BinariesFolder's first part
    const first = lower(binaries.value.split('\\')[0]);
    const parts = exeDir ? exeDir.split('/') : [];
    const i = parts.findIndex((p) => lower(p) === first);
    return { exe, exeDir, root: i >= 0 ? parts.slice(0, i).join('/') : undefined, binaries };
  }
  // StringUtil.ReplaceCaseInsensitive on the exe's (Windows) folder path: the first occurrence removed, as text.
  const at = lower(dirWin).indexOf(lower(binaries.value));
  if (at < 0) return { exe, exeDir, root: undefined, binaries };
  const left = dirWin.slice(0, at), right = dirWin.slice(at + binaries.value.length);
  if (right.replace(/\\/g, '') !== '') return { exe, exeDir, root: undefined, binaries }; // not a suffix: unclear
  return { exe, exeDir, root: norm(left), binaries };
}

/** The exe the handler names, found in the folder (shallowest first), if any. */
export function findExe(handlerText: string, folder: GameFolder): string | undefined {
  return locate(scan(handlerText), folder).exe;
}

// ---------------------------------------------------------------------------------------------------------------
// Engine facts (from the folder alone).

export interface EngineFact { id: 'unity' | 'unreal' | 'steam' | 'xinput' | 'dinput8'; title: string; text: string }

export function engineFacts(folder: GameFolder): EngineFact[] {
  const out: EngineFact[] = [];
  const files = folder.files.map((f) => f.path);
  const dirSet = new Set(folder.dirs.map(lower));
  const named = (re: RegExp) => files.filter((p) => re.test(base(p)));
  const list = (ps: string[]) => ps.slice(0, 3).map((p) => p).join(', ') + (ps.length > 3 ? ` and ${ps.length - 3} more` : '');

  const unityDll = named(/^unityplayer\.dll$/i);
  const unityData = folder.dirs.filter((d) => /_Data$/i.test(base(d)) && (dirSet.has(lower(d) + '/managed') || dirSet.has(lower(d) + '/il2cpp_data') || files.some((f) => lower(f) === lower(d) + '/globalgamemanagers')));
  if (unityDll.length || unityData.length) {
    const mono = unityData.some((d) => dirSet.has(lower(d) + '/managed'));
    const il2 = named(/^gameassembly\.dll$/i).length > 0;
    out.push({
      id: 'unity', title: 'Unity game',
      text: `Found ${list([...unityDll, ...unityData.map((d) => d + '/')])}${mono ? ' (Mono scripting backend: _Data/Managed)' : il2 ? ' (IL2CPP: GameAssembly.dll)' : ''}. Unity players accept -screen-fullscreen 0, -screen-width and -screen-height on the command line; handlers commonly pass them in Context.StartArguments.`,
    });
  }
  const shipping = named(/-Win64-Shipping\.exe$/i);
  const ueBin = folder.dirs.filter((d) => /(^|\/)Engine\/Binaries$/i.test(d));
  if (shipping.length || ueBin.length) {
    out.push({
      id: 'unreal', title: 'Unreal Engine game',
      text: `Found ${list([...shipping, ...ueBin.map((d) => d + '/')])}. The game itself is usually <Project>/Binaries/Win64/<Project>-Win64-Shipping.exe (a top-level exe is often only a launcher); handlers for Unreal games commonly name that exe in Game.ExecutableName and its folder in Game.BinariesFolder, and pass -windowed -ResX= -ResY=.`,
    });
  }
  const steam = named(/^steam_api(64)?\.dll$/i);
  if (steam.length) {
    out.push({
      id: 'steam', title: 'Steam API DLL',
      text: `Found ${list(steam)}. With Game.UseGoldberg, Nucleus replaces every steam_api*.dll under the game root in each instance with Goldberg's emulator (SteamFunctions.cs, Directory.GetFiles(rootFolder, "steam_api*.dll", AllDirectories)).`,
    });
  }
  const xi = named(/^xinput(1_[34]|9_1_0)\.dll$/i);
  if (xi.length) {
    out.push({
      id: 'xinput', title: 'The game ships an XInput DLL',
      text: `Found ${list(xi)}. Nucleus' own xinput1_3.dll (Game.Hook.CustomDllEnabled) is kept out of linking and placed in the instance instead, so the game's copy is replaced there.`,
    });
  }
  const di = named(/^dinput8\.dll$/i);
  if (di.length) {
    out.push({
      id: 'dinput8', title: 'A dinput8.dll in the game folder',
      text: `Found ${list(di)}. A dinput8.dll next to a game is often a mod or plugin loader (an ASI loader, a widescreen fix) rather than part of the game; it is linked into every instance like the other files.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The checks.

const KNOWN_EXT = /\.(ini|cfg|json|txt|xml|dll|exe|dat|sav)$/i;
// Files Nucleus (or its Goldberg / hook setup) creates itself: never expected in the game folder.
const NUCLEUS_MADE = /(^|\/)(steam_settings|settings)(\/|$)|(^|\/)(steam_appid\.txt|local_save\.txt|account_name\.txt|user_steam_id\.txt|language\.txt|steam_interfaces\.txt|ncoop\.ini|xinput1_[34]\.dll|xinput9_1_0\.dll|dinput8?\.dll|[^/]*nucleus[^/]*)$/i;
// A line that creates, copies, moves, deletes or tests a file: a missing file there is expected.
const MAKES_FILES = /\b(Write\w*|Create\w*|Copy\w*|Move\w*|Delete\w*|Exists|Writer|Replace\w*|ModifySaveFile|IniFile)\b/;

function lineAt(text: string, at: number) {
  const a = text.lastIndexOf('\n', at - 1) + 1, b = text.indexOf('\n', at);
  return text.slice(a, b < 0 ? text.length : b);
}
const inner = (t: { start: number; end: number }) => ({ start: t.start + 1, end: Math.max(t.start + 1, t.end - 1) });
const srcEscape = (v: string) => v.replace(/\\/g, '\\\\');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function checkAgainstFolder(handlerText: string, folder: GameFolder): FolderProblem[] {
  const s = scan(handlerText);
  const out: FolderProblem[] = [];
  const loc = locate(s, folder);
  const fname = folder.name;
  const where = (d: string) => (d ? `${fname}/${d}` : fname);

  // Game.ExecutableName
  const exeTok = scalar(s, 'ExecutableName');
  if (exeTok?.value && !loc.exe) {
    const exes = folder.files.filter((f) => /\.exe$/i.test(f.path));
    const near = closest(exeTok.value, new Set(exes.map((f) => base(f.path))));
    const biggest = [...exes].filter((f) => !/^(unins|crash|vc_?redist|dxsetup|ue4prereq|unitycrashhandler|setup|launcher)/i.test(base(f.path))).sort((a, b) => b.size - a.size).slice(0, 3).map((f) => f.path);
    out.push({
      ...inner(exeTok), severity: 'warning',
      title: 'The executable is not in the game folder',
      why: `Nucleus adds the game by matching this file name, in any case, with the exe the player picks. ${fname} has no file named ${exeTok.value}${folder.truncated ? ' (not every file was listed: the folder is very large)' : ''}.`
        + (near ? ` Did you mean ${near}?` : biggest.length ? ` Its largest executables: ${biggest.join(', ')}.` : ' It has no .exe at all: is it the install folder?'),
      fix: near ? { title: `Use ${near}`, text: near, ...inner(exeTok) } : undefined,
    });
  } else if (exeTok?.value && loc.exe && loc.exeDir && !loc.binaries?.value) {
    const stmtEnd = handlerText.indexOf('\n', exeTok.end);
    const at = stmtEnd < 0 ? handlerText.length : stmtEnd;
    out.push({
      ...inner(exeTok), severity: 'info',
      title: `Found in ${loc.exeDir}`,
      why: `Nucleus finds the exe by its name, and without Game.BinariesFolder it treats the exe's own folder (${where(loc.exeDir)}) as the game folder: only that folder is linked into the instances, and the paths in the symlink lists start there. If the game needs the folders above it, Game.BinariesFolder = "${srcEscape(winPath(loc.exeDir))}" makes ${fname} the game folder (when ${fname} is the install folder).`,
      fix: { title: 'Add Game.BinariesFolder', text: `${handlerText[at - 1] === '\r' ? '\r\n' : '\n'}Game.BinariesFolder = "${srcEscape(winPath(loc.exeDir))}";`, start: at, end: at },
    });
  }

  // Game.BinariesFolder
  const bin = loc.binaries;
  if (bin?.value && loc.exe) {
    if (bin.value.includes('/')) {
      out.push({
        ...inner(bin), severity: 'warning',
        title: 'Game.BinariesFolder with "/"',
        why: 'Nucleus removes this text from the exe\'s folder path, which is a Windows path with backslashes, so a "/" never matches and the exe\'s folder stays the game folder. Write the folders with \\\\ (a backslash, escaped).',
        fix: { title: 'Use backslashes', text: srcEscape(bin.value.replace(/\//g, '\\')), ...inner(bin) },
      });
    } else if (loc.root === undefined && loc.exeDir) {
      out.push({
        ...inner(bin), severity: 'warning',
        title: 'Game.BinariesFolder is not in the exe\'s path',
        why: `The exe is in ${where(loc.exeDir)}, whose path doesn't contain "${bin.value}" as its last folders. Nucleus would then use the exe's folder as the game folder. Game.BinariesFolder is the exe's folder, relative to the game's root folder.`,
        fix: { title: `Use ${winPath(loc.exeDir)}`, text: srcEscape(winPath(loc.exeDir)), ...inner(bin) },
      });
    }
  }

  const root = loc.root;
  const rootFiles = root === undefined ? folder.files : folder.files.filter((f) => under(f.path, root));
  const rootNames = new Set(rootFiles.map((f) => base(f.path)));
  const rootDirs = root === undefined ? [] : folder.dirs.filter((d) => under(d, root) && lower(d) !== lower(root)).map((d) => rel(d, root));
  const rootFileRel = root === undefined ? [] : rootFiles.map((f) => rel(f.path, root));

  for (const l of listsIn(s)) {
    const opt = `Game.${l.option}`;
    for (const it of l.items) {
      const v = it.value;
      if (!v || !v.trim()) continue;
      const r = inner(it);
      if (l.kind === 'names') {
        if (/[\\/]/.test(v)) {
          out.push({ ...r, severity: 'warning', title: `A path in ${opt}`,
            why: `Nucleus compares each entry with file names only, never with their folders, so an entry with a folder in it matches nothing. Every file whose name contains "${base(norm(v))}" is matched, in any folder.`,
            fix: { title: `Use ${base(norm(v))}`, text: srcEscape(base(norm(v))), ...r } });
          continue;
        }
        if (NUCLEUS_MADE.test(v)) continue;
        const lv = lower(v);
        const hits = [...rootNames].filter((n) => lower(n).includes(lv));
        if (!hits.length) {
          const near = closest(v, rootNames);
          out.push({ ...r, severity: near ? 'warning' : 'info', title: 'Not in the game folder',
            why: `No file name in ${where(root ?? '')} contains "${v}" (Nucleus matches ${opt} by "the name contains it", in any case).${near ? ` Did you mean ${near}?` : ' Fine if the handler adds this file itself.'}`,
            fix: near ? { title: `Use ${near}`, text: srcEscape(near), ...r } : undefined });
        } else if (/\.[a-z0-9]{1,5}$/i.test(v)) {
          const others = hits.filter((n) => lower(n) !== lv);
          if (others.length && others.length < hits.length) out.push({ ...r, severity: 'info', title: `Also matches ${plural(others.length, 'other file')}`,
            why: `Nucleus applies ${opt} to every file whose name contains "${v}": also ${others.slice(0, 4).join(', ')}${others.length > 4 ? ', …' : ''}.` });
        }
      } else if (root !== undefined && (l.kind === 'root-dirs' || l.kind === 'root-files')) {
        const p = norm(v);
        const pool = l.kind === 'root-dirs' ? rootDirs : rootFileRel;
        const found = pool.some((d) => lower(d) === lower(p));
        if (l.kind === 'root-files' && NUCLEUS_MADE.test(p)) continue;
        if (!found) {
          const sameBase = pool.filter((d) => lower(base(d)) === lower(base(p)));
          const near = sameBase.length === 1 ? sameBase[0] : closest(p, pool);
          const what = l.kind === 'root-dirs' ? 'folder' : 'file';
          // A typo is likely when a close name exists; otherwise the game or the handler may create it later.
          out.push({ ...r, severity: near || l.kind === 'root-files' ? 'warning' : 'info', title: `${what === 'folder' ? 'Folder' : 'File'} not in the game folder`,
            why: `${opt} entries are paths from the game folder (${where(root)}), and it has no ${what} ${p}.${near ? ` Did you mean ${near}?` : l.kind === 'root-dirs' ? ' Fine if the game creates it when it runs.' : ''}${l.option === 'DirSymlinkCopyInstead' ? ' Nucleus skips a missing one.' : l.option === 'CopyFiles' ? ' Copying a missing file fails.' : ''}`,
            fix: near ? { title: `Use ${near}`, text: srcEscape(winPath(near)), ...r } : undefined });
        } else if (l.kind === 'root-dirs' && v.includes('/')) {
          out.push({ ...r, severity: 'warning', title: 'A nested folder written with "/"',
            why: `Nucleus compares ${opt} with each folder's Windows path as text, so with "/" the folders above it match but ${base(p)} itself doesn't. Write it with \\\\ (a backslash, escaped).`,
            fix: { title: 'Use backslashes', text: srcEscape(winPath(p)), ...r } });
        }
      } else if (l.kind === 'exe-entries' && loc.exe) {
        const ed = loc.exeDir ?? '';
        const p = join(ed, norm(v));
        const ok = folder.files.some((f) => lower(f.path) === lower(p)) || folder.dirs.some((d) => lower(d) === lower(p));
        if (!ok) {
          const pool = [...folder.files.map((f) => f.path), ...folder.dirs].filter((x) => dirOf(x) === ed || under(x, ed)).map((x) => rel(x, ed));
          const near = closest(norm(v), pool);
          out.push({ ...r, severity: 'warning', title: 'Not next to the executable',
            why: `Nucleus only matches this handler to the exe when every ${opt} entry exists in the exe's folder (${where(ed)}); ${v} doesn't.${near ? ` Did you mean ${near}?` : ''}`,
            fix: near ? { title: `Use ${near}`, text: srcEscape(winPath(near)), ...r } : undefined });
        }
      }
    }
  }

  // Path.Combine(Context.RootFolder, "a", "b.ini") and Context.RootFolder + "\\a\\b.ini"
  if (root !== undefined) {
    const bases: Record<string, string> = { RootFolder: root, OrigRootFolder: root, RootInstallFolder: loc.exeDir ?? root };
    const tokAt = new Map(s.strings.map((t) => [t.start, t]));
    const report = (toks: StrTok[], baseDir: string) => {
      const parts = toks.map((t) => norm(t.value)).filter(Boolean);
      if (!parts.length) return;
      const p = norm(parts.join('/'));
      const last = toks[toks.length - 1];
      if (!KNOWN_EXT.test(p) || NUCLEUS_MADE.test(p) || p.includes('..') || /[%*?<>|:]/.test(p)) return;
      if (MAKES_FILES.test(lineAt(handlerText, toks[0].start))) return;
      const full = join(baseDir, p);
      if (folder.files.some((f) => lower(f.path) === lower(full))) return;
      if (folder.truncated) return;
      const sameName = folder.files.filter((f) => under(f.path, baseDir) && lower(base(f.path)) === lower(base(p))).map((f) => rel(f.path, baseDir));
      const inDir = folder.files.filter((f) => lower(dirOf(f.path)) === lower(dirOf(full))).map((f) => base(f.path));
      const near = sameName.length === 1 ? sameName[0] : undefined;
      const nearName = near ? undefined : closest(base(p), inDir);
      out.push({ start: toks[0].start + 1, end: last.end - 1, severity: 'info', title: 'Not in the game folder',
        why: `${where(join(baseDir, dirOf(p)))} has no ${base(p)}.${near ? ` It is at ${near}.` : nearName ? ` Did you mean ${nearName}?` : ''} Fine if the handler or the game creates it.` });
    };
    for (const m of s.masked.matchAll(/\bPath\s*\.\s*Combine\s*\(\s*Context\s*\.\s*(RootFolder|OrigRootFolder|RootInstallFolder)\s*,/g)) {
      const toks: StrTok[] = [];
      let k = m.index! + m[0].length, ok = false;
      for (;;) {
        while (/\s/.test(s.masked[k] ?? '')) k++;
        const t = tokAt.get(k);
        if (!t) break;
        toks.push(t);
        k = t.end;
        while (/\s/.test(s.masked[k] ?? '')) k++;
        if (s.masked[k] === ',') { k++; continue; }
        if (s.masked[k] === ')') ok = true;
        break;
      }
      if (ok) report(toks, bases[m[1]]);
    }
    for (const m of s.masked.matchAll(/\bContext\s*\.\s*(RootFolder|OrigRootFolder|RootInstallFolder)\s*\+\s*/g)) {
      const t = tokAt.get(m.index! + m[0].length);
      if (!t) continue;
      const after = s.masked.slice(t.end).match(/^\s*(\S)/)?.[1];
      if (after === '+' || after === '.' || after === '[') continue; // more path follows, or a method call on the string
      if (!/^[\\/]/.test(t.value)) continue; // Nucleus' folders have no trailing backslash: without one it's a sibling name
      report([t], bases[m[1]]);
    }
  }

  // Engine facts: on Game.GameName, else on line 1.
  const gn = scalar(s, 'GameName');
  const anchor = gn ? inner(gn) : { start: 0, end: Math.max(1, handlerText.indexOf('\n') < 0 ? handlerText.length : handlerText.indexOf('\n')) };
  for (const f of engineFacts(folder)) out.push({ ...anchor, severity: 'info', title: `Your game: ${f.title}`, why: f.text });

  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Picker options and inserting.

export interface PickOption { value: string; label: string; detail?: string; present: boolean }

/** What the "+" of a list offers, in the form Nucleus expects for that list. */
export function pickerOptions(handlerText: string, list: FolderList, folder: GameFolder): PickOption[] {
  const s = scan(handlerText);
  const loc = locate(s, folder);
  const root = loc.root ?? (loc.exe ? loc.exeDir ?? '' : '');
  const have = new Set(list.items.map((i) => lower(norm(i.value))));
  const sizeOf = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
  if (list.kind === 'names') {
    const byName = new Map<string, { name: string; paths: string[]; size: number }>();
    for (const f of folder.files) {
      if (!under(f.path, root)) continue;
      const n = base(f.path), k = lower(n);
      const e = byName.get(k) ?? { name: n, paths: [], size: f.size };
      e.paths.push(rel(f.path, root));
      byName.set(k, e);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({
      value: e.name, label: e.name,
      detail: e.paths.length === 1 ? (dirOf(e.paths[0]) || '(game folder)') + ` · ${sizeOf(e.size)}` : `${e.paths.length} files with this name`,
      present: have.has(lower(e.name)),
    }));
  }
  if (list.kind === 'root-dirs') {
    return folder.dirs.filter((d) => under(d, root) && lower(d) !== lower(root)).map((d) => rel(d, root)).sort((a, b) => a.localeCompare(b))
      .map((d) => ({ value: winPath(d), label: d + '/', present: have.has(lower(d)) }));
  }
  if (list.kind === 'root-files') {
    return folder.files.filter((f) => under(f.path, root)).map((f) => ({ p: rel(f.path, root), size: f.size })).sort((a, b) => a.p.localeCompare(b.p))
      .map((f) => ({ value: winPath(f.p), label: f.p, detail: sizeOf(f.size), present: have.has(lower(f.p)) }));
  }
  const ed = loc.exeDir ?? '';
  const entries = [...folder.files.map((f) => f.path), ...folder.dirs.map((d) => d + '/')].filter((p) => dirOf(p.replace(/\/$/, '')) === ed);
  return entries.map((p) => rel(p.replace(/\/$/, ''), ed) + (p.endsWith('/') ? '/' : '')).sort((a, b) => a.localeCompare(b))
    .map((p) => ({ value: p.replace(/\/$/, ''), label: p, present: have.has(lower(p.replace(/\/$/, ''))) }));
}

/** The edit that adds a value to a list: quoted and escaped like its entries, comma-separated. */
export function insertEntry(handlerText: string, list: FolderList, value: string): { at: number; text: string } {
  const q = list.quote;
  const lit = q + value.replace(/\\/g, '\\\\').split(q).join('\\' + q) + q;
  const masked = scan(handlerText).masked;
  const body = masked.slice(list.open + 1, list.close);
  const trimmed = body.replace(/\s+$/, '');
  if (!trimmed.trim()) return { at: list.open + 1, text: lit };
  return { at: list.open + 1 + trimmed.length, text: trimmed.endsWith(',') ? ` ${lit}` : `, ${lit}` };
}


/** What the workbench's folder summary (and VS Code's status) shows: the exe found, the game root, the facts. */
export function folderSummary(folder: GameFolder, handlerText: string): { exe?: string; exeName?: string; root?: string; facts: EngineFact[]; bytes: number } {
  const s = scan(handlerText);
  const loc = locate(s, folder);
  return { exe: loc.exe, exeName: scalar(s, 'ExecutableName')?.value, root: loc.root, facts: engineFacts(folder), bytes: folder.files.reduce((n, f) => n + f.size, 0) };
}
