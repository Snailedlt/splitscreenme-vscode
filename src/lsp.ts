// `nucleus lsp`: the editor features as a Language Server (LSP 3.17, JSON-RPC over stdio with
// Content-Length framing), so Neovim, Helix, Zed, Sublime Text, Emacs, JetBrains (LSP4IJ), Kate, ...
// get what the VS Code extension has: diagnostics with quick fixes, hover, completion, signature
// help, Format Document, inlay hints and "Try it". It only converts core/features.ts results to
// LSP types (see PORTING.md). No dependencies. Handler code only runs in the isolated simulator
// (src/sandbox.ts). Logs go to stderr; stdout carries only protocol messages.
import { fileURLToPath } from 'node:url';
import { Diagnostic as LintDiagnostic, lint, RuleId, Severity } from './core/lint';
import { definitionAt, referencesAt, renameEdits, renameTargetAt } from './core/definition';
import { workbenchLinkFor } from './workbenchlink';
import { CodeActionEntry, CompletionEntry, documentSymbols, SymbolEntry, CompletionKind, completionsAt, fixAllCodeAction, formatEdits, hoverAt, inlayHints, isHandlerFile, quickFixes, RULES_URL, signatureHelpAt } from './core/features';
import { EVERY_KEYBOARD } from './core/sim';
import { lintPluginsFor } from './plugins';
import { checkPackage } from './core/pkgcheck';
import { forgetPackageFiles, packageFilePath, packageFilesFor } from './pkgfiles';
import fs from 'node:fs';
import { checkAgainstFolder, folderLists, pickerOptions } from './core/gamefolder';
import { folderAt } from './gamefolder-node';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { publishedNow } from './published';
import { pluginsFor, simulateIsolated } from './sandbox';
import { formatSimulation } from './simformat';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';

/** Settings: initializationOptions, or `workspace/didChangeConfiguration` `settings.nucleus`
 *  (also accepted: `settings.splitscreenme`, the VS Code names, or the object itself). */
export interface LspSettings {
  /** 'auto' (default): a .js in a `handlers` folder, a file matching `handlerGlobs`, or one that looks like a handler. */
  detection: 'auto' | 'always' | 'off';
  /** Extra paths that always count as handlers, e.g. ["**\/my-handlers/*.js"]. */
  handlerGlobs: string[];
  lint: { enable: boolean; rules: Partial<Record<RuleId, Severity | 'off'>>; compareWithHub: boolean; /** Check every handler in the workspace folders, opened or not (default true). */ workspace: boolean };
  completion: { enable: boolean };
  /** The game's install folder per handler file name, e.g. { "MyGame.js": "C:\\Games\\MyGame" }: checks against the real files. */
  gameFolders: Record<string, string>;
}
const DEFAULTS: LspSettings = { detection: 'auto', handlerGlobs: [], lint: { enable: true, rules: {}, compareWithHub: true, workspace: true }, completion: { enable: true }, gameFolders: {} };

export const COMMANDS = { tryIt: 'nucleus.tryIt', fixAll: 'nucleus.fixAll', workbenchLink: 'nucleus.workbenchLink' } as const;
const FIX_ALL_KIND = 'source.fixAll.nucleus';

// LSP enums (numbers in the protocol)
const SEVERITY: Record<Severity, number> = { error: 1, warning: 2, info: 3, hint: 4 };
const TAG = { unnecessary: 1, deprecated: 2 } as const;
const KIND: Record<CompletionKind, number> = { method: 2, function: 3, keyword: 14, field: 5, variable: 6, class: 7, module: 9, property: 10, value: 12, enum: 13, snippet: 15, enumMember: 20, constant: 21 };

interface Position {
  line: number;
  character: number;
}
interface Range {
  start: Position;
  end: Position;
}

/** Offsets <-> LSP positions (UTF-16, which JavaScript strings index; lines end at \n). */
class Lines {
  private starts = [0];
  constructor(readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  position(offset: number): Position {
    offset = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: offset - this.starts[lo] };
  }
  offset(p: Position): number {
    if (p.line >= this.starts.length) return this.text.length;
    const start = this.starts[Math.max(0, p.line)];
    const end = p.line + 1 < this.starts.length ? this.starts[p.line + 1] - 1 : this.text.length;
    return Math.min(start + Math.max(0, p.character), end);
  }
  range(s: { start: number; end: number }): Range {
    return { start: this.position(s.start), end: this.position(Math.max(s.end, s.start)) };
  }
}

interface Doc {
  uri: string;
  text: string;
  version: number;
  languageId: string;
  lines?: Lines;
}
const linesOf = (d: Doc) => (d.lines ??= new Lines(d.text));

const pathOf = (uri: string): string | undefined => {
  if (!uri.startsWith('file:')) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
};

/** Turn a snippet into plain text, for clients without snippet support. */
export function snippetToPlain(s: string): string {
  return s
    .replace(/\$\{\d+\|([^,|}]*)[^}]*\|\}/g, '$1')
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{?\d+\}?/g, '')
    .replace(/\\([\\$}])/g, '$1');
}

type Send = (msg: unknown) => void;

/** One LSP session. `send` writes a message to the client. Exported for tests (they use the real
 *  stdio server through `nucleus lsp` too). */
export class Server {
  private docs = new Map<string, Doc>();
  private settings: LspSettings = structuredClone(DEFAULTS);
  private timers = new Map<string, NodeJS.Timeout>();
  private snippets = true;
  private shutdown = false;
  private nextId = 1;
  private roots: string[] = [];
  private canWatch = false;
  /** Package files that have problems published, per handler, so they can be cleared. */
  private pkgUris = new Map<string, Set<string>>();
  constructor(private send: Send, private log: (s: string) => void = (s) => process.stderr.write(`[nucleus lsp] ${s}\n`)) {}

  private notify(method: string, params: unknown) {
    this.send({ jsonrpc: '2.0', method, params });
  }
  private request(method: string, params: unknown) {
    this.send({ jsonrpc: '2.0', id: `nucleus-${this.nextId++}`, method, params });
  }

  private applySettings(raw: any) {
    if (!raw || typeof raw !== 'object') return;
    const s = raw.nucleus ?? raw.splitscreenme ?? raw;
    const d = this.settings;
    if (['auto', 'always', 'off'].includes(s.detection)) d.detection = s.detection;
    if (Array.isArray(s.handlerGlobs)) d.handlerGlobs = s.handlerGlobs.filter((g: unknown) => typeof g === 'string');
    const l = s.lint ?? {};
    if (typeof l.enable === 'boolean') d.lint.enable = l.enable;
    if (l.rules && typeof l.rules === 'object') d.lint.rules = l.rules;
    if (typeof l.compareWithHub === 'boolean') d.lint.compareWithHub = l.compareWithHub;
    if (typeof l.workspace === 'boolean') d.lint.workspace = l.workspace;
    if (typeof s.completion?.enable === 'boolean') d.completion.enable = s.completion.enable;
    if (s.gameFolders && typeof s.gameFolders === 'object') d.gameFolders = Object.fromEntries(Object.entries(s.gameFolders).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  }

  private isHandler(d: Doc): boolean {
    const file = pathOf(d.uri);
    if (!file && d.languageId && !/^(javascript|js)$/i.test(d.languageId)) return false;
    return isHandlerFile(file ?? (/\.js$/i.test(d.uri) ? d.uri : undefined), d.text, this.settings.detection, this.settings.handlerGlobs);
  }
  private featuresOn(d: Doc | undefined): d is Doc {
    return !!d && this.settings.completion.enable && this.isHandler(d);
  }

  private lintDoc(d: Doc, onPublished?: () => void): LintDiagnostic[] {
    const file = pathOf(d.uri);
    const published = this.settings.lint.compareWithHub && onPublished ? publishedNow(d.text, onPublished) : undefined;
    return lint(d.text, { rules: this.settings.lint.rules, plugins: file ? lintPluginsFor(file) : undefined, published });
  }

  private publish(uri: string, closed?: Doc) {
    const d = closed ?? this.docs.get(uri);
    if (!d) return;
    if (!this.settings.lint.enable || !this.isHandler(d)) {
      this.notify('textDocument/publishDiagnostics', { uri, diagnostics: [] });
      return;
    }
    const lines = linesOf(d);
    const diagnostics = this.lintDoc(d, closed ? undefined : () => this.schedule(uri, 0)).map((x) => toLspDiagnostic(lines, x));
    // Package checks on the handler's folder: the ones about the handler's own text (a file it uses that isn't there).
    const file = pathOf(uri);
    const files = file ? packageFilesFor(file) : undefined;
    const byFile = new Map<string, unknown[]>();
    for (const p of files ? checkPackage(d.text, files) : []) {
      if (p.file) {
        // On the file itself (the folder next to the handler), as VS Code shows them.
        const line = Math.max(0, (p.line ?? 1) - 1);
        const list = byFile.get(p.file) ?? [];
        list.push({ range: { start: { line, character: 0 }, end: { line, character: p.line ? 1000 : 0 } }, severity: SEVERITY[p.severity], code: 'package', source: 'nucleus', message: `${p.title}. ${p.why}` });
        byFile.set(p.file, list);
        continue;
      }
      if (p.start === undefined) continue;
      (diagnostics as unknown[]).push({ range: lines.range({ start: p.start, end: p.end ?? p.start }), severity: SEVERITY[p.severity], code: 'package', codeDescription: { href: RULES_URL }, source: 'nucleus', message: `${p.title}. ${p.why}` });
    }
    // The game folder linked to this handler (settings.gameFolders), if any: problems with their fix as data.
    const folder = this.gameFolderOf(uri);
    for (const p of folder ? checkAgainstFolder(d.text, folder) : []) {
      (diagnostics as unknown[]).push({ range: lines.range({ start: p.start, end: Math.max(p.end, p.start) }), severity: SEVERITY[p.severity], code: 'game-folder', source: 'nucleus', message: `${p.title}. ${p.why}`, ...(p.fix ? { data: { fix: p.fix } } : {}) });
    }
    this.notify('textDocument/publishDiagnostics', { uri, ...(closed ? {} : { version: d.version }), diagnostics });
    // Package problems on the files in <Name>/: publish them, and clear the ones that went away.
    const sent = new Set<string>();
    for (const [name, list] of byFile) {
      const fileUri = pathToFileURL(packageFilePath(file!, name)).href;
      sent.add(fileUri);
      this.notify('textDocument/publishDiagnostics', { uri: fileUri, diagnostics: list });
    }
    for (const old of this.pkgUris.get(uri) ?? []) if (!sent.has(old)) this.notify('textDocument/publishDiagnostics', { uri: old, diagnostics: [] });
    this.pkgUris.set(uri, sent);
  }
  private schedule(uri: string, delay = 200) {
    clearTimeout(this.timers.get(uri));
    this.timers.set(
      uri,
      setTimeout(() => {
        this.timers.delete(uri);
        try {
          this.publish(uri);
        } catch (e: any) {
          this.log(`lint failed for ${uri}: ${e?.stack ?? e}`);
        }
      }, delay),
    );
  }

  /** Handle one message; returns the response for requests (undefined for notifications). */
  handle(msg: any): unknown | undefined {
    const { id, method, params } = msg ?? {};
    if (method === undefined) return undefined; // a response to one of our requests (applyEdit)
    const isRequest = id !== undefined && id !== null;
    try {
      const result = this.dispatch(method, params ?? {});
      if (!isRequest) return undefined;
      if (result === NOT_FOUND) return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
      return { jsonrpc: '2.0', id, result: result ?? null };
    } catch (e: any) {
      this.log(`${method} failed: ${e?.stack ?? e}`);
      return isRequest ? { jsonrpc: '2.0', id, error: { code: -32603, message: String(e?.message ?? e) } } : undefined;
    }
  }

  get exited() {
    return this.shutdown;
  }

  private dispatch(method: string, p: any): unknown {
    const doc = p.textDocument?.uri ? this.docs.get(p.textDocument.uri) : undefined;
    switch (method) {
      case 'initialize': {
        this.applySettings(p.initializationOptions);
        this.snippets = p.capabilities?.textDocument?.completion?.completionItem?.snippetSupport !== false;
        this.roots = (Array.isArray(p.workspaceFolders) && p.workspaceFolders.length ? p.workspaceFolders.map((f: any) => f.uri) : p.rootUri ? [p.rootUri] : []).map((u: string) => pathOf(u)).filter((x: string | undefined): x is string => !!x);
        this.canWatch = !!p.capabilities?.workspace?.didChangeWatchedFiles?.dynamicRegistration;
        return {
          capabilities: {
            positionEncoding: 'utf-16',
            textDocumentSync: { openClose: true, change: 1 /* full */ },
            hoverProvider: true,
            documentSymbolProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            documentHighlightProvider: true,
            completionProvider: { triggerCharacters: ['.', '=', ' ', '[', ',', '"'], resolveProvider: false },
            signatureHelpProvider: { triggerCharacters: ['(', ','] },
            codeActionProvider: { codeActionKinds: ['quickfix', FIX_ALL_KIND] },
            documentFormattingProvider: true,
            inlayHintProvider: true,
            executeCommandProvider: { commands: Object.values(COMMANDS) },
          },
          serverInfo: { name: 'nucleus', version: VERSION },
        };
      }
      case 'initialized':
        // Every handler in the workspace, opened or not (like VS Code's Lint All Handlers), and on-disk changes.
        if (this.canWatch) this.request('client/registerCapability', { registrations: [{ id: 'nucleus-files', method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: [{ globPattern: '**/*' }] } }] });
        setTimeout(() => this.scanWorkspace(), 0);
        return undefined;
      case 'workspace/didChangeWatchedFiles':
        for (const c of p.changes ?? []) this.fileChanged(String(c.uri), c.type);
        return undefined;
      case '$/cancelRequest':
      case '$/setTrace':
        return undefined;
      case 'shutdown':
        return null;
      case 'exit':
        this.shutdown = true;
        return undefined;
      case 'workspace/didChangeConfiguration':
        this.applySettings(p.settings);
        for (const uri of this.docs.keys()) this.schedule(uri, 0);
        return undefined;

      case 'textDocument/didOpen': {
        const t = p.textDocument;
        this.docs.set(t.uri, { uri: t.uri, text: String(t.text ?? ''), version: t.version ?? 0, languageId: t.languageId ?? '' });
        this.schedule(t.uri, 0);
        return undefined;
      }
      case 'textDocument/didChange': {
        if (!doc) return undefined;
        for (const c of p.contentChanges ?? []) {
          if (c.range) {
            // Incremental change (we ask for full sync, but accept these too).
            const l = linesOf(doc);
            doc.text = doc.text.slice(0, l.offset(c.range.start)) + c.text + doc.text.slice(l.offset(c.range.end));
          } else doc.text = String(c.text ?? '');
          doc.lines = undefined;
        }
        doc.version = p.textDocument.version ?? doc.version;
        this.schedule(doc.uri);
        return undefined;
      }
      case 'textDocument/didClose':
        this.docs.delete(p.textDocument.uri);
        clearTimeout(this.timers.get(p.textDocument.uri));
        // In the workspace: back to the saved file's problems; elsewhere, none.
        if (!this.fromDisk(p.textDocument.uri)) this.notify('textDocument/publishDiagnostics', { uri: p.textDocument.uri, diagnostics: [] });
        return undefined;
      case 'textDocument/didSave':
        return undefined;

      case 'textDocument/definition': {
        if (!this.featuresOn(doc)) return null;
        const l = linesOf(doc);
        const d = definitionAt(doc.text, l.offset(p.position));
        return d ? { uri: doc.uri, range: l.range(d) } : null;
      }
      case 'textDocument/references': {
        if (!this.featuresOn(doc)) return null;
        const l = linesOf(doc);
        const at = l.offset(p.position);
        const refs = referencesAt(doc.text, at);
        const decl = definitionAt(doc.text, at);
        return refs.filter((r) => p.context?.includeDeclaration !== false || !decl || r.start !== decl.start).map((r) => ({ uri: doc.uri, range: l.range(r) }));
      }
      case 'textDocument/documentHighlight': {
        if (!this.featuresOn(doc)) return null;
        const l = linesOf(doc);
        const at = l.offset(p.position);
        const decl = definitionAt(doc.text, at);
        // 3 = write (the declaration), 2 = read
        return referencesAt(doc.text, at).map((r) => ({ range: l.range(r), kind: decl && r.start === decl.start ? 3 : 2 }));
      }
      case 'textDocument/prepareRename': {
        if (!this.featuresOn(doc)) return null;
        const l = linesOf(doc);
        const span = renameTargetAt(doc.text, l.offset(p.position));
        return span ? { range: l.range(span), placeholder: doc.text.slice(span.start, span.end) } : null;
      }
      case 'textDocument/rename': {
        if (!this.featuresOn(doc)) return null;
        const l = linesOf(doc);
        const r = renameEdits(doc.text, l.offset(p.position), String(p.newName ?? ''));
        if ('error' in r) throw new Error(r.error);
        return { changes: { [doc.uri]: r.edits.map((e) => ({ range: l.range(e), newText: e.text })) } };
      }
      case 'textDocument/documentSymbol': {
        if (!this.featuresOn(doc)) return [];
        const l = linesOf(doc);
        const KIND = { namespace: 3, property: 7, function: 12, variable: 13 } as const; // LSP SymbolKind
        const conv = (s: SymbolEntry): unknown => ({ name: s.name, detail: s.detail, kind: KIND[s.kind], range: l.range(s.range), selectionRange: l.range(s.selection), children: (s.children ?? []).map(conv) });
        return documentSymbols(doc.text).map(conv);
      }
      case 'textDocument/hover': {
        if (!this.featuresOn(doc)) return null;
        const l = linesOf(doc);
        const h = hoverAt(doc.text, l.offset(p.position));
        return h ? { contents: { kind: 'markdown', value: h.markdown }, range: l.range(h.range) } : null;
      }
      case 'textDocument/completion': {
        if (!this.featuresOn(doc)) return null;
        const l = linesOf(doc);
        const at = l.offset(p.position);
        // Inside DirSymlinkExclusions, HardcopyFiles…: the linked game folder's own files and folders.
        const folder = this.gameFolderOf(doc.uri);
        const list = folder ? folderLists(doc.text).find((x) => at > x.open && at <= x.close) : undefined;
        if (folder && list) {
          const inItem = list.items.find((i) => at >= i.start && at <= i.end);
          const esc = (v: string) => v.replace(/\\/g, '\\\\');
          return {
            isIncomplete: false,
            items: pickerOptions(doc.text, list, folder)
              .filter((o) => !o.present)
              .map((o, i) => ({
                label: o.label,
                kind: o.value.includes('.') ? 17 : 19, // File, Folder
                detail: o.detail ? `${o.detail} · in ${folder.name}` : `in ${folder.name}`,
                sortText: String(i).padStart(4, '0'),
                ...(inItem ? { textEdit: { range: l.range({ start: inItem.start, end: inItem.end }), newText: esc(o.value) } } : { insertText: `${list.quote}${esc(o.value)}${list.quote}` }),
              })),
          };
        }
        const items = completionsAt(doc.text, at, { explicit: p.context?.triggerKind !== 2 });
        return items ? { isIncomplete: false, items: items.map((e) => this.toCompletionItem(l, e)) } : null;
      }
      case 'textDocument/signatureHelp': {
        if (!this.featuresOn(doc)) return null;
        const s = signatureHelpAt(doc.text, linesOf(doc).offset(p.position));
        if (!s) return null;
        return {
          signatures: s.signatures.map((x) => ({ label: x.label, documentation: x.documentation === undefined ? undefined : { kind: 'markdown', value: x.documentation }, parameters: x.parameters.map((label, i) => ({ label, ...(x.parameterDocs?.[i] ? { documentation: { kind: 'markdown', value: x.parameterDocs[i] } } : {}) })) })),
          activeSignature: s.activeSignature,
          activeParameter: s.activeParameter,
        };
      }
      case 'textDocument/inlayHint': {
        if (!this.featuresOn(doc)) return [];
        const l = linesOf(doc);
        const from = p.range ? l.offset(p.range.start) : 0;
        const to = p.range ? l.offset(p.range.end) : doc.text.length;
        return inlayHints(doc.text)
          .filter((h) => h.offset >= from && h.offset <= to)
          .map((h) => ({ position: l.position(h.offset), label: h.label, paddingLeft: true, tooltip: { kind: 'markdown', value: h.tooltip } }));
      }
      case 'textDocument/formatting': {
        if (!doc || !this.isHandler(doc)) return null;
        const r = formatEdits(doc.text, { insertSpaces: p.options?.insertSpaces !== false, tabSize: typeof p.options?.tabSize === 'number' ? p.options.tabSize : 4 });
        if ('error' in r) {
          // Refuses rather than risk changing what the code does: say why, change nothing.
          this.notify('window/showMessage', { type: 2, message: `Nucleus: ${r.error}` });
          return [];
        }
        const l = linesOf(doc);
        return r.edits.map((e) => ({ range: l.range(e), newText: e.text }));
      }
      case 'textDocument/codeAction':
        return doc && this.isHandler(doc) ? this.codeActions(doc, p) : [];

      case 'workspace/executeCommand':
        return this.executeCommand(p.command, p.arguments ?? []);
    }
    return NOT_FOUND;
  }

/** Handlers in the workspace folders (skipping node_modules and dot folders), problems published for the closed ones. */
  private scanWorkspace() {
    if (!this.settings.lint.enable || !this.settings.lint.workspace) return;
    let count = 0;
    let dirs = 0;
    const walk = (dir: string, depth: number) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (count >= 2000 || dirs > 3000 || this.shutdown) return; // a whole drive opened: stop early
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          dirs++;
          if (depth < 8) walk(abs, depth + 1);
        } else if (e.isFile() && /\.js$/i.test(e.name)) {
          count++;
          queue.push(pathToFileURL(abs).href);
        }
      }
    };
    const queue: string[] = [];
    for (const r of this.roots) walk(r, 0);
    // A few files at a time, so requests (hover, completion) are answered in between.
    const next = () => {
      for (let i = 0; i < 10 && queue.length && !this.shutdown; i++) this.fromDisk(queue.shift()!);
      if (queue.length && !this.shutdown) setImmediate(next);
    };
    next();
  }
  /** Lint a closed file from disk (if it's in the workspace and a handler); true when it published. */
  private fromDisk(uri: string): boolean {
    const file = pathOf(uri);
    if (!file || this.docs.has(uri) || !this.settings.lint.enable || !this.settings.lint.workspace) return false;
    if (!this.roots.some((r) => file.startsWith(r + path.sep) || file === r)) return false;
    let text: string;
    try {
      if (fs.statSync(file).size > 2 * 1024 * 1024) return false;
      text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      return false;
    }
    const d: Doc = { uri, text, version: 0, languageId: 'javascript' };
    if (!this.isHandler(d)) return false;
    this.publish(uri, d);
    return true;
  }
  /** A file changed on disk: re-check it if it's a closed handler, or the handler whose folder it is in. */
  private fileChanged(uri: string, type: number) {
    const file = pathOf(uri);
    if (!file) return;
    if (/\.js$/i.test(file) && !this.docs.has(uri)) {
      if (type === 3) this.notify('textDocument/publishDiagnostics', { uri, diagnostics: [] });
      else this.fromDisk(uri);
    }
    // A file in <Name>/ next to <Name>.js: that handler's package checks.
    for (let dir = path.dirname(file); dir.length > 1 && dir !== path.dirname(dir); dir = path.dirname(dir)) {
      const handler = `${dir}.js`;
      if (handler === file) continue;
      const hUri = pathToFileURL(handler).href;
      if (fs.existsSync(handler)) {
        forgetPackageFiles(handler);
        if (this.docs.has(hUri)) this.schedule(hUri, 200);
        else this.fromDisk(hUri);
        break;
      }
    }
  }

  private gameFolderOf(uri: string) {
    const file = pathOf(uri);
    const dir = file ? this.settings.gameFolders[path.basename(file)] : undefined;
    return dir ? folderAt(dir) : undefined;
  }

  private toCompletionItem(l: Lines, e: CompletionEntry) {
    const snippet = !!e.snippet && this.snippets;
    const text = e.insertText === undefined ? e.label : e.snippet && !this.snippets ? snippetToPlain(e.insertText) : e.insertText;
    return {
      label: e.label,
      ...(e.labelDetail ? { labelDetails: { description: e.labelDetail } } : {}),
      kind: KIND[e.kind],
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
      ...(e.documentation !== undefined ? { documentation: { kind: 'markdown', value: e.documentation } } : {}),
      ...(e.range ? { textEdit: { range: l.range(e.range), newText: text } } : { insertText: text }),
      insertTextFormat: snippet ? 2 : 1,
      ...(text.includes('\n') ? { insertTextMode: 2 } : {}), // later lines get the line's indentation
      ...(e.filterText ? { filterText: e.filterText } : {}),
      ...(e.sortText ? { sortText: e.sortText } : {}),
      ...(e.preselect ? { preselect: true } : {}),
      ...(e.deprecated ? { tags: [1] } : {}),
    };
  }

  private codeActions(doc: Doc, p: any) {
    const l = linesOf(doc);
    const only: string[] | undefined = p.context?.only;
    const wantsFixAll = only?.some((k) => FIX_ALL_KIND.startsWith(k) && k !== 'quickfix' && k !== '');
    const toAction = (a: CodeActionEntry, diag?: unknown) => ({
      title: a.title,
      kind: a.kind === 'source.fixAll' ? FIX_ALL_KIND : 'quickfix',
      ...(diag ? { diagnostics: [diag] } : {}),
      ...(a.preferred !== undefined ? { isPreferred: a.preferred } : {}),
      edit: { changes: { [doc.uri]: a.edits.map((e) => ({ range: l.range(e), newText: e.text })) } },
    });
    if (wantsFixAll && !only!.includes('quickfix')) {
      const a = fixAllCodeAction(doc.text, this.settings.lint.rules);
      return a ? [toAction(a)] : [];
    }
    // The client sends back the diagnostics it shows; match them to a fresh lint of the current text.
    const current = this.lintDoc(doc);
    const pairs: [LintDiagnostic, unknown][] = [];
    for (const cd of p.context?.diagnostics ?? []) {
      if (cd?.source !== 'nucleus') continue;
      const start = l.offset(cd.range.start);
      const end = l.offset(cd.range.end);
      const match = current.find((x) => x.rule === cd.code && x.message === cd.message && x.start === start && Math.max(x.end, x.start) === end) ?? current.find((x) => x.rule === cd.code && x.start === start);
      if (match && !pairs.some(([m]) => m === match)) pairs.push([match, cd]);
    }
    const actions = quickFixes(doc.text, pairs.map(([m]) => m), this.settings.lint.rules).map((a) => toAction(a, pairs.find(([m]) => m === a.diagnostic)?.[1]));
    // Game-folder problems carry their fix (the exe's real name, BinariesFolder…) in `data`.
    for (const cd of p.context?.diagnostics ?? []) {
      const f = cd?.code === 'game-folder' ? cd.data?.fix : undefined;
      if (f && typeof f.start === 'number') actions.push({ title: f.title, kind: 'quickfix', diagnostics: [cd], isPreferred: true, edit: { changes: { [doc.uri]: [{ range: l.range({ start: f.start, end: f.end }), newText: f.text }] } } } as any);
    }
    if (!only && !actions.some((a) => a.kind === FIX_ALL_KIND)) {
      const all = fixAllCodeAction(doc.text, this.settings.lint.rules);
      if (all) actions.push(toAction(all));
    }
    return only ? actions.filter((a) => only.some((k) => a.kind === k || a.kind.startsWith(`${k}.`))) : actions;
  }

  private executeCommand(command: string, args: any[]): unknown {
    const a = (args[0] && typeof args[0] === 'object' ? args[0] : { uri: args[0] }) as { uri?: string; source?: string; players?: number; width?: number; height?: number; keyboardPlayer?: number | 'all' | 'none' };
    const doc = typeof a.uri === 'string' ? this.docs.get(a.uri) : undefined;
    switch (command) {
      case COMMANDS.tryIt: {
        // "Try it": the simulation as text (the same as `nucleus simulate`), run isolated (src/sandbox.ts).
        const text = typeof a.source === 'string' ? a.source : doc?.text;
        if (text === undefined) throw new Error('nucleus.tryIt: give { uri } of an open document or { source }.');
        const players = Number.isInteger(a.players) && a.players! >= 1 && a.players! <= 16 ? a.players! : 2;
        // keyboardPlayer: 1-based player, 'none' (or 0) for nobody, 'all' (or -1) for each player their own.
        const kb = a.keyboardPlayer === 'all' || a.keyboardPlayer === -1 ? EVERY_KEYBOARD : a.keyboardPlayer === 'none' || a.keyboardPlayer === 0 ? -1 : Math.min(Math.max(1, Number(a.keyboardPlayer ?? 1)), players) - 1;
        const file = typeof a.uri === 'string' ? pathOf(a.uri) : undefined;
        const r = simulateIsolated(text, { players, width: a.width ?? 1920, height: a.height ?? 1080, keyboardPlayer: kb, plugins: file ? pluginsFor(file) : undefined });
        return formatSimulation(r, kb);
      }
      case COMMANDS.workbenchLink: {
        // The browser workbench with this handler open (a share link); `ref` says which editor asked.
        const ref = typeof (args[0] as any)?.ref === 'string' && /^[\w.-]{1,40}$/.test((args[0] as any).ref) ? (args[0] as any).ref : 'lsp';
        return workbenchLinkFor(doc?.text, ref);
      }
      case COMMANDS.fixAll: {
        if (!doc) throw new Error('nucleus.fixAll: give the uri of an open document.');
        const fix = fixAllCodeAction(doc.text, this.settings.lint.rules);
        if (!fix) return { title: undefined };
        const l = linesOf(doc);
        this.request('workspace/applyEdit', { label: fix.title, edit: { changes: { [doc.uri]: fix.edits.map((e) => ({ range: l.range(e), newText: e.text })) } } });
        return { title: fix.title };
      }
    }
    throw new Error(`Unknown command ${command}`);
  }
}
const NOT_FOUND = Symbol('not found');

function toLspDiagnostic(l: Lines, d: LintDiagnostic) {
  return {
    range: l.range(d),
    severity: SEVERITY[d.severity],
    code: d.rule,
    codeDescription: { href: RULES_URL },
    source: 'nucleus',
    message: d.message,
    ...(d.tags?.length ? { tags: d.tags.map((t) => TAG[t]) } : {}),
  };
}

/** Serve LSP on stdin/stdout (Content-Length framed JSON-RPC). Resolves with the exit code. */
export function serve(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<number> {
  return new Promise((resolve) => {
    const write = (msg: unknown) => {
      const body = Buffer.from(JSON.stringify(msg), 'utf8');
      output.write(`Content-Length: ${body.length}\r\n\r\n`);
      output.write(body);
    };
    const server = new Server(write);
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      resolve(code);
    };
    input.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const sep = buf.indexOf('\r\n\r\n');
        if (sep < 0) break;
        const header = buf.subarray(0, sep).toString('ascii');
        const m = header.match(/content-length:\s*(\d+)/i);
        if (!m) {
          // Not a header we understand: drop it and resynchronise.
          process.stderr.write(`[nucleus lsp] bad header: ${JSON.stringify(header)}\n`);
          buf = buf.subarray(sep + 4);
          continue;
        }
        const len = Number(m[1]);
        if (buf.length < sep + 4 + len) break;
        const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
        buf = buf.subarray(sep + 4 + len);
        let msg: any;
        try {
          msg = JSON.parse(body);
        } catch {
          write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
          continue;
        }
        for (const one of Array.isArray(msg) ? msg : [msg]) {
          const out = server.handle(one);
          if (out) write(out);
          if (server.exited) return finish(0);
        }
      }
    });
    input.on('end', () => finish(0));
  });
}
