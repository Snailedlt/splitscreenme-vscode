// "Your game on this PC" in VS Code (splitscreenme-vscode#13): link a handler to the game's install folder, then the
// checks in core/gamefolder.ts (shared with the workbench) compare ExecutableName, BinariesFolder, the symlink lists
// and the like with the real files, with fixes; inside those lists, completion offers the game's own files.
// Only names and sizes are read; nothing leaves the PC.
import * as vscode from 'vscode';
import fs from 'node:fs';
import path from 'node:path';
import { checkAgainstFolder, folderLists, folderSummary, MAX_DEPTH, MAX_ENTRIES, pickerOptions, SKIP_DIRS, type FolderFix, type GameFolder } from './core/gamefolder';

const SETTING = 'gameFolders';

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
function folderAt(dir: string): GameFolder | undefined {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < 60_000) return hit.folder;
  if (!fs.existsSync(dir)) return undefined;
  const folder = readGameFolder(dir);
  cache.set(dir, { at: Date.now(), folder });
  return folder;
}

const keyOf = (doc: vscode.TextDocument) => path.basename(doc.uri.fsPath);
/** The game folder linked to this handler (by its file name), if any. */
export function linkedFolder(doc: vscode.TextDocument): string | undefined {
  if (doc.uri.scheme !== 'file') return undefined;
  const map = vscode.workspace.getConfiguration('splitscreenme', doc.uri).get<Record<string, string>>(SETTING) ?? {};
  return map[keyOf(doc)];
}

const fixOf = new WeakMap<vscode.Diagnostic, FolderFix>();

/** The problems the linked game folder shows in this handler (none when no folder is linked). */
export function gameFolderDiagnostics(doc: vscode.TextDocument, source: string, severity: Record<'error' | 'warning' | 'info', vscode.DiagnosticSeverity>): vscode.Diagnostic[] {
  const dir = linkedFolder(doc);
  const folder = dir ? folderAt(dir) : undefined;
  if (!folder) return [];
  return checkAgainstFolder(doc.getText(), folder).map((p) => {
    const d = new vscode.Diagnostic(new vscode.Range(doc.positionAt(p.start), doc.positionAt(Math.max(p.end, p.start))), `${p.title}. ${p.why}`, severity[p.severity]);
    d.source = source;
    d.code = 'game-folder';
    if (p.fix) fixOf.set(d, p.fix);
    return d;
  });
}

export function registerGameFolders(context: vscode.ExtensionContext, isHandler: (d: vscode.TextDocument) => boolean, selector: vscode.DocumentSelector, recheck: (d: vscode.TextDocument) => void) {
  const save = async (doc: vscode.TextDocument, dir: string | undefined) => {
    const cfg = vscode.workspace.getConfiguration('splitscreenme', doc.uri);
    const map = { ...(cfg.get<Record<string, string>>(SETTING) ?? {}) };
    if (dir) map[keyOf(doc)] = dir;
    else delete map[keyOf(doc)];
    await cfg.update(SETTING, map, vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  };
  const active = () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc || !isHandler(doc) || doc.uri.scheme !== 'file') {
      vscode.window.showInformationMessage('Open a saved Nucleus handler first.');
      return undefined;
    }
    return doc;
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('splitscreenme.linkGameFolder', async () => {
      const doc = active();
      if (!doc) return;
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, title: `The folder ${keyOf(doc)}'s game is installed in (where its .exe is, or above)`, defaultUri: linkedFolder(doc) ? vscode.Uri.file(linkedFolder(doc)!) : undefined });
      const dir = picked?.[0]?.fsPath;
      if (!dir) return;
      cache.delete(dir);
      const folder = folderAt(dir)!;
      await save(doc, dir);
      recheck(doc);
      const sum = folderSummary(folder, doc.getText());
      const facts = sum.facts.map((f) => f.title).join(', ');
      vscode.window.showInformationMessage(
        `Linked ${keyOf(doc)} to ${folder.name} (${folder.files.length.toLocaleString('en')} files${folder.truncated ? ', only partly listed' : ''}). ` +
          (sum.exe ? `Executable: ${sum.exe}.` : sum.exeName ? `${sum.exeName} isn't in it.` : 'Game.ExecutableName isn\'t set.') +
          (facts ? ` ${facts}.` : '') + ' Only names and sizes are read.',
      );
    }),
    vscode.commands.registerCommand('splitscreenme.unlinkGameFolder', async () => {
      const doc = active();
      if (!doc) return;
      await save(doc, undefined);
      recheck(doc);
    }),
    // Fixes for the folder problems (e.g. the exe's real name, BinariesFolder set to where the exe is).
    vscode.languages.registerCodeActionsProvider(selector, {
      provideCodeActions: (doc, _r, ctx) =>
        ctx.diagnostics.flatMap((d) => {
          const f = fixOf.get(d);
          if (!f) return [];
          const a = new vscode.CodeAction(f.title, vscode.CodeActionKind.QuickFix);
          a.edit = new vscode.WorkspaceEdit();
          a.edit.replace(doc.uri, new vscode.Range(doc.positionAt(f.start), doc.positionAt(f.end)), f.text);
          a.diagnostics = [d];
          a.isPreferred = true;
          return [a];
        }),
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    // Inside DirSymlinkExclusions, FileSymlinkExclusions, HardcopyFiles…: the game's own files and folders.
    vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems: (doc, pos) => {
        const dir = isHandler(doc) ? linkedFolder(doc) : undefined;
        const folder = dir ? folderAt(dir) : undefined;
        if (!folder) return undefined;
        const text = doc.getText();
        const at = doc.offsetAt(pos);
        const list = folderLists(text).find((l) => at > l.open && at <= l.close);
        if (!list) return undefined;
        // Inside a quoted entry: replace that entry's text; else insert a quoted one.
        const inItem = list.items.find((i) => at >= i.start && at <= i.end);
        return pickerOptions(text, list, folder)
          .filter((o) => !o.present)
          .map((o, i) => {
            const item = new vscode.CompletionItem(o.label, o.value.includes('.') ? vscode.CompletionItemKind.File : vscode.CompletionItemKind.Folder);
            item.detail = o.detail ? `${o.detail} · in ${folder.name}` : `in ${folder.name}`;
            item.sortText = String(i).padStart(4, '0');
            if (inItem) {
              item.insertText = o.value.replace(/\\/g, '\\\\');
              item.range = new vscode.Range(doc.positionAt(inItem.start), doc.positionAt(inItem.end));
            } else item.insertText = `${list.quote}${o.value.replace(/\\/g, '\\\\')}${list.quote}`;
            return item;
          });
      },
    }, '"', "'", '[', ','),
  );
}
