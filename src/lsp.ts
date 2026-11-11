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
import { rangeFormatEdits } from './core/features';
import { docsPageUrl } from './core/docspage';
import { CodeActionEntry, CompletionEntry, documentSymbols, SymbolEntry, CompletionKind, completionsAt, explainLine, fixAllCodeAction, formatEdits, hoverAt, inlayHints, isHandlerFile, quickFixes, RULES_URL, SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES, semanticTokens, signatureHelpAt } from './core/features';
import { RULE_DOCS, ruleUrl } from './core/ruledocs';
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
import { setHubTool } from './hubcache';
import { pluginsFor } from './sandbox';
import { simWorker, isCancelled } from './simworker';
import { formatSimulation } from './simformat';
import { buildPackage } from './core/pkg';
import { installHandler } from './install';
import { AFTER_START, debugLogOn, debugLogPath, nucleusStatus, setDebugLog, stopNucleusSync, testInNucleus } from './nucleusrun';
import { FEATURES, Feature, renderHandler, toHandlerFileName, validateGameName } from './core/templates';

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
  /** Formatting style (core/format.ts): quotes "double" (default) | "single" | "keep", semicolons "add" (default) | "keep". */
  format: { quotes: 'double' | 'single' | 'keep'; semicolons: 'add' | 'keep' };
  /** The Nucleus Co-op folder (with NucleusCoop.exe and `handlers`), for Install. */
  nucleusPath?: string;
}
const DEFAULTS: LspSettings = { detection: 'auto', handlerGlobs: [], lint: { enable: true, rules: {}, compareWithHub: true, workspace: true }, completion: { enable: true }, gameFolders: {}, format: { quotes: 'double', semicolons: 'add' } };

export const COMMANDS = { tryIt: 'nucleus.tryIt', fixAll: 'nucleus.fixAll', workbenchLink: 'nucleus.workbenchLink', package: 'nucleus.package', install: 'nucleus.install', newHandler: 'nucleus.newHandler', testInNucleus: 'nucleus.testInNucleus', explainLine: 'nucleus.explainLine' } as const;
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
  private docsLink?: (path: string) => string;
  private shutdown = false;
  private nextId = 1;
  private roots: string[] = [];
  private canWatch = false;
  private relativeWatch = false;
  /** <Name>/ folders of the handlers seen so far: their files are watched for the package checks. */
  private handlerDirs = new Set<string>();
  private watching: { id: string; key: string } | undefined;
  private watchTimer: NodeJS.Timeout | undefined;
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
    if (['double', 'single', 'keep'].includes(s.format?.quotes)) d.format.quotes = s.format.quotes;
    if (['add', 'keep'].includes(s.format?.semicolons)) d.format.semicolons = s.format.semicolons;
    if (typeof s.nucleusPath === 'string') d.nucleusPath = s.nucleusPath || undefined;
    if (s.gameFolders && typeof s.gameFolders === 'object') d.gameFolders = Object.fromEntries(Object.entries(s.gameFolders).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  }

  private formatStyle(o: any) {
    return { insertSpaces: o?.insertSpaces !== false, tabSize: typeof o?.tabSize === 'number' ? o.tabSize : 4, ...this.settings.format };
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
    this.watchFolderOf(pathOf(uri));
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

  /** Requests still being answered (Try it runs in the simulator's worker), by id, so $/cancelRequest can stop them. */
  private running = new Map<string | number, AbortController>();
  private current: AbortSignal | undefined; // the signal of the request being dispatched

  /** Handle one message; returns the response for requests (undefined for notifications), or a promise of it
   *  for the few requests answered off the main thread. */
  handle(msg: any): unknown | Promise<unknown> | undefined {
    const { id, method, params } = msg ?? {};
    if (method === undefined) return undefined; // a response to one of our requests (applyEdit)
    const isRequest = id !== undefined && id !== null;
    const failed = (e: any) => {
      if (isCancelled(e)) return isRequest ? { jsonrpc: '2.0', id, error: { code: -32800, message: 'Request cancelled' } } : undefined;
      this.log(`${method} failed: ${e?.stack ?? e}`);
      return isRequest ? { jsonrpc: '2.0', id, error: { code: -32603, message: String(e?.message ?? e) } } : undefined;
    };
    const answer = (result: unknown) => {
      if (!isRequest) return undefined;
      if (result === NOT_FOUND) return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
      return { jsonrpc: '2.0', id, result: result ?? null };
    };
    const ac = isRequest ? new AbortController() : undefined;
    this.current = ac?.signal;
    try {
      const result = this.dispatch(method, params ?? {});
      if (!(result instanceof Promise)) return answer(result);
      this.running.set(id, ac!);
      return result.then(answer, failed).finally(() => this.running.delete(id));
    } catch (e: any) {
      return failed(e);
    } finally {
      this.current = undefined;
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
        // API names in hovers, hints and suggestion docs link to their docs pages on the site (docs/<name>/), tagged with the
        // editor's name for the anonymous visit counts (clientInfo: "Neovim", "Zed"…; "lsp" when it says none).
        const ref = String(p.clientInfo?.name ?? 'lsp').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'lsp';
        this.docsLink = (path: string) => docsPageUrl(path, ref);
        linkRef = ref;
        // Hub requests (the guid-changed check) name the server and the editor, not the person.
        setHubTool(p.clientInfo?.name ? `ncdev-lsp/${ref}` : 'ncdev-lsp');
        this.roots = (Array.isArray(p.workspaceFolders) && p.workspaceFolders.length ? p.workspaceFolders.map((f: any) => f.uri) : p.rootUri ? [p.rootUri] : []).map((u: string) => pathOf(u)).filter((x: string | undefined): x is string => !!x);
        this.canWatch = !!p.capabilities?.workspace?.didChangeWatchedFiles?.dynamicRegistration;
        this.relativeWatch = !!p.capabilities?.workspace?.didChangeWatchedFiles?.relativePatternSupport;
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
            documentRangeFormattingProvider: true,
            documentOnTypeFormattingProvider: { firstTriggerCharacter: "}", moreTriggerCharacter: [";", "\n"] },
            inlayHintProvider: true,
            semanticTokensProvider: { legend: { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS] }, full: true },
            executeCommandProvider: { commands: Object.values(COMMANDS) },
          },
          serverInfo: { name: 'nucleus', version: VERSION },
        };
      }
      case 'initialized':
        // Every handler in the workspace, opened or not (like VS Code's Lint All Handlers), and on-disk changes.
        this.updateWatchers(0);
        setTimeout(() => this.scanWorkspace(), 0);
        return undefined;
      case 'workspace/didChangeWatchedFiles':
        for (const c of p.changes ?? []) this.fileChanged(String(c.uri), c.type);
        return undefined;
      case '$/cancelRequest':
        this.running.get(p.id)?.abort();
        return undefined;
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
        const h = hoverAt(doc.text, l.offset(p.position), { docsLink: this.docsLink });
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
        const items = completionsAt(doc.text, at, { explicit: p.context?.triggerKind !== 2, docsLink: this.docsLink });
        return items ? { isIncomplete: false, items: items.map((e) => this.toCompletionItem(l, e)) } : null;
      }
      case 'textDocument/signatureHelp': {
        if (!this.featuresOn(doc)) return null;
        const s = signatureHelpAt(doc.text, linesOf(doc).offset(p.position), { docsLink: this.docsLink });
        if (!s) return null;
        return {
          signatures: s.signatures.map((x) => ({ label: x.label, documentation: x.documentation === undefined ? undefined : { kind: 'markdown', value: x.documentation }, parameters: x.parameters.map((label, i) => ({ label, ...(x.parameterDocs?.[i] ? { documentation: { kind: 'markdown', value: x.parameterDocs[i] } } : {}) })) })),
          activeSignature: s.activeSignature,
          activeParameter: s.activeParameter,
        };
      }
      case 'textDocument/semanticTokens/full': {
        if (!this.featuresOn(doc)) return { data: [] };
        // Relative positions, five numbers a token (LSP 3.16): line delta, start (relative on the same line), length,
        // type index, modifier bits. Tokens never span lines here (a name).
        const l = linesOf(doc);
        const data: number[] = [];
        let line = 0, char = 0;
        for (const t of semanticTokens(doc.text)) {
          const s = l.position(t.start), e = l.position(t.end);
          if (e.line !== s.line) continue;
          data.push(s.line - line, s.line === line ? s.character - char : s.character, e.character - s.character, SEMANTIC_TOKEN_TYPES.indexOf(t.type), t.modifiers.reduce((m, x) => m | (1 << SEMANTIC_TOKEN_MODIFIERS.indexOf(x)), 0));
          line = s.line;
          char = s.character;
        }
        return { data };
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
      case 'textDocument/rangeFormatting':
      case 'textDocument/onTypeFormatting': {
        if (!doc || !this.isHandler(doc)) return null;
        const l = linesOf(doc);
        let from: number, to: number;
        if (method === 'textDocument/rangeFormatting') (from = l.offset(p.range.start)), (to = l.offset(p.range.end));
        else {
          // The line just finished: after Enter, the one above.
          const line = p.ch === '\n' ? Math.max(0, p.position.line - 1) : p.position.line;
          from = to = l.offset({ line, character: 0 });
        }
        const r = rangeFormatEdits(doc.text, from, to, this.formatStyle(p.options));
        if ('error' in r) {
          if (method === 'textDocument/rangeFormatting') this.notify('window/showMessage', { type: 2, message: `Nucleus: ${r.error}` });
          return [];
        }
        return r.edits.map((e) => ({ range: l.range(e), newText: e.text }));
      }
      case 'textDocument/formatting': {
        if (!doc || !this.isHandler(doc)) return null;
        const r = formatEdits(doc.text, this.formatStyle(p.options));
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

/** In a folder the workspace scan skips (node_modules, dot folders such as .git), relative to its workspace folder. */
  private skipped(file: string): boolean {
    const root = this.roots.find((r) => file.startsWith(r + path.sep));
    return !!root && path.relative(root, file).split(/[\\/]/).slice(0, -1).some(skipName);
  }

  /** A handler's <Name>/ folder joins the watched ones. */
  private watchFolderOf(file: string | undefined) {
    if (!file || !this.canWatch || !/\.js$/i.test(file) || this.skipped(file)) return;
    const dir = file.slice(0, -3);
    if (this.handlerDirs.has(dir) || this.handlerDirs.size >= MAX_WATCHED_FOLDERS) return;
    this.handlerDirs.add(dir);
    this.updateWatchers();
  }

  /** What the client watches for us: handler files (`**\/*.js`) and the <Name>/ folders of known handlers, not
   *  every file in the workspace (node_modules, .git and build output would flood the server). Re-registered,
   *  at most every half second, when a handler folder is added. */
  private updateWatchers(delay = 500) {
    if (!this.canWatch) return;
    clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      const watchers = watchersFor([...this.handlerDirs].sort(), this.relativeWatch);
      const key = JSON.stringify(watchers);
      if (this.watching?.key === key || this.shutdown) return;
      if (this.watching) this.request('client/unregisterCapability', { unregisterations: [{ id: this.watching.id, method: 'workspace/didChangeWatchedFiles' }] });
      const id = `nucleus-files-${this.nextId}`;
      this.request('client/registerCapability', { registrations: [{ id, method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers } }] });
      this.watching = { id, key };
    }, delay);
    this.watchTimer.unref?.();
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
        if (skipName(e.name)) continue;
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
    if (!file || this.skipped(file)) return;
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
    // Source actions (an editor's "Source Action…" menu, or every action when it asks for no kind): the handler's
    // .nc package for the Hub, and installing it into Nucleus Co-op.
    const source: unknown[] = [];
    if (pathOf(doc.uri) && (!only || only.some((k) => k === 'source' || k.startsWith('source.nucleus')))) {
      source.push({ title: 'Nucleus: Package as .nc (for the Hub)', kind: 'source.nucleus.package', command: { title: 'Package', command: COMMANDS.package, arguments: [{ uri: doc.uri }] } });
      if (this.settings.nucleusPath) source.push({ title: 'Nucleus: Install to Nucleus Co-op', kind: 'source.nucleus.install', command: { title: 'Install', command: COMMANDS.install, arguments: [{ uri: doc.uri }] } });
    }
    if (wantsFixAll && !only!.includes('quickfix')) {
      const a = fixAllCodeAction(doc.text, this.settings.lint.rules);
      return [...(a ? [toAction(a)] : []), ...source].filter((x: any) => only!.some((k) => x.kind === k || x.kind.startsWith(`${k}.`)));
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
    const actions: any[] = quickFixes(doc.text, pairs.map(([m]) => m), this.settings.lint.rules).map((a) => toAction(a, pairs.find(([m]) => m === a.diagnostic)?.[1]));
    actions.push(...source);
    // Game-folder problems carry their fix (the exe's real name, BinariesFolder…) in `data`.
    for (const cd of p.context?.diagnostics ?? []) {
      const f = cd?.code === 'game-folder' ? cd.data?.fix : undefined;
      if (f && typeof f.start === 'number') actions.push({ title: f.title, kind: 'quickfix', diagnostics: [cd], isPreferred: true, edit: { changes: { [doc.uri]: [{ range: l.range({ start: f.start, end: f.end }), newText: f.text }] } } } as any);
    }
    // Explain this line: on request from the actions menu, never on screen by itself.
    if (!only && p.range?.start && (doc.text.split('\n')[p.range.start.line] ?? '').trim()) actions.push({ title: 'Nucleus: Explain this line', command: { title: 'Explain this line', command: COMMANDS.explainLine, arguments: [{ uri: doc.uri, line: p.range.start.line }] } });
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
        // In the simulator's worker: the server keeps answering (completion, hover) while it runs.
        return simWorker()
          .simulate(text, { players, width: a.width ?? 1920, height: a.height ?? 1080, keyboardPlayer: kb, plugins: file ? pluginsFor(file) : undefined }, { signal: this.current })
          .then((r) => formatSimulation(r, kb));
      }
      case COMMANDS.workbenchLink: {
        // The browser workbench with this handler open (a share link); `ref` says which editor asked.
        const ref = typeof (args[0] as any)?.ref === 'string' && /^[\w.-]{1,40}$/.test((args[0] as any).ref) ? (args[0] as any).ref : 'lsp';
        return workbenchLinkFor(doc?.text, ref);
      }
      case COMMANDS.package: {
        // The .nc package for the Hub: handler.js + the <Name>/ folder (core/pkg.ts), next to the handler.
        const file = typeof a.uri === 'string' ? pathOf(a.uri) : undefined;
        if (!file) throw new Error('nucleus.package: give { uri } of a handler file.');
        const errors = lint(doc?.text ?? fs.readFileSync(file, 'utf8')).filter((d) => d.severity === 'error').length;
        if (errors && !(args[0] as any)?.force) throw new Error(`The handler has ${errors} error(s), so Nucleus may not load it: fix them first (or pass { force: true }).`);
        const out = typeof (args[0] as any)?.out === 'string' ? (args[0] as any).out : file.replace(/\.js$/i, '.nc');
        const { zip, assetCount } = buildPackage(file);
        fs.writeFileSync(out, zip);
        this.notify('window/showMessage', { type: 3, message: `Nucleus: wrote ${path.basename(out)} (handler.js + ${assetCount} file(s) from its folder). Upload it at https://hub.splitscreen.me/` });
        return { file: out, assetCount };
      }
      case COMMANDS.install: {
        const file = typeof a.uri === 'string' ? pathOf(a.uri) : undefined;
        const nucleus = typeof (args[0] as any)?.nucleusPath === 'string' ? (args[0] as any).nucleusPath : this.settings.nucleusPath;
        if (!file) throw new Error('nucleus.install: give { uri } of a handler file.');
        if (!nucleus) throw new Error('Set nucleus.nucleusPath (the Nucleus Co-op folder, with NucleusCoop.exe) first.');
        const errors = lint(doc?.text ?? fs.readFileSync(file, 'utf8')).filter((d) => d.severity === 'error').length;
        const force = !!(args[0] as any)?.force;
        if (errors && !force) throw new Error(`The handler has ${errors} error(s), so Nucleus may not load it: fix them first (or pass { force: true }).`);
        const r = installHandler(file, nucleus, { overwrite: force || (args[0] as any)?.overwrite !== false });
        this.notify('window/showMessage', { type: 3, message: `Nucleus: installed ${path.basename(r.dest)}${r.assets ? ` and ${r.assets} file(s)` : ''}. Restart Nucleus Co-op (or re-add the game) to pick it up.` });
        return { file: r.dest, assetCount: r.assets };
      }
      case COMMANDS.testInNucleus: {
        // { uri, restart?, debugLog? }: install, then start Nucleus Co-op (Windows) with the handler's game selected.
        const o = (args[0] ?? {}) as { uri?: string; restart?: boolean; debugLog?: boolean; nucleusPath?: string; force?: boolean };
        const file = typeof o.uri === 'string' ? pathOf(o.uri) : undefined;
        const nucleus = o.nucleusPath ?? this.settings.nucleusPath;
        if (!file) throw new Error('nucleus.testInNucleus: give { uri } of a handler file.');
        if (!nucleus) throw new Error('Set nucleus.nucleusPath (the Nucleus Co-op folder, with NucleusCoop.exe) first.');
        const status = nucleusStatus(nucleus);
        if (!status.canStart) throw new Error(status.why);
        const errors = lint(doc?.text ?? fs.readFileSync(file, 'utf8')).filter((d) => d.severity === 'error').length;
        if (errors && !o.force) throw new Error(`The handler has ${errors} error(s), so Nucleus may not load it: fix them first (or pass { force: true }).`);
        if (status.running && !o.restart) return { started: false, running: true, message: 'Nucleus Co-op is running and only reads handlers when it starts: ask the user, then call again with { restart: true }.' };
        if (status.running) stopNucleusSync();
        if (typeof o.debugLog === 'boolean') setDebugLog(nucleus, o.debugLog);
        const r = testInNucleus(file, nucleus);
        this.notify('window/showMessage', { type: 3, message: `Nucleus: ${AFTER_START}` });
        return { started: true, guid: r.guid, debugLog: debugLogOn(nucleus), log: debugLogPath(nucleus) };
      }
      case COMMANDS.newHandler: {
        // { name, exe, dir, steamId?, maxPlayers?, features? }: writes <dir>/<name>.js from the template and opens it.
        const o = (args[0] ?? {}) as { name?: string; exe?: string; dir?: string; steamId?: string; maxPlayers?: number; features?: string[] };
        if (!o.name || !o.exe || !o.dir) throw new Error('nucleus.newHandler: give { name, exe, dir } (and optionally steamId, maxPlayers, features).');
        const badName = validateGameName(o.name);
        if (badName) throw new Error(`nucleus.newHandler: name: ${badName}`);
        const dir = /^file:/i.test(o.dir) ? fileURLToPath(o.dir) : o.dir;
        const out = path.join(dir, `${toHandlerFileName(o.name)}.js`);
        if (fs.existsSync(out)) throw new Error(`${path.basename(out)} already exists there.`);
        const features = (o.features ?? []).filter((f) => FEATURES.some((x) => x.id === f)) as Feature[];
        fs.writeFileSync(out, renderHandler({ gameName: o.name, executableName: o.exe, steamId: o.steamId, maxPlayers: o.maxPlayers, features }));
        const uri = pathToFileURL(out).href;
        this.request('window/showDocument', { uri, takeFocus: true });
        return { uri };
      }
      case COMMANDS.explainLine: {
        if (!doc) throw new Error('nucleus.explainLine: give the uri of an open document and a 0-based line.');
        const line = Number((a as { line?: number }).line ?? 0);
        const e = explainLine(doc.text, linesOf(doc).offset({ line, character: 0 }));
        if (!e) return { markdown: undefined };
        // Plain text for the message popup; the Markdown for clients that can show it.
        const plain = e.markdown.replace(/\*\*/g, '').replace(/`/g, '');
        this.notify('window/showMessage', { type: 3, message: plain });
        return { markdown: e.markdown, aiPrompt: e.aiPrompt };
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

/** Folders the workspace scan and the file watcher skip. */
export const skipName = (name: string) => name.startsWith('.') || name === 'node_modules';
const MAX_WATCHED_FOLDERS = 500;

/** The file watchers to register: every .js file, and each handler's <Name>/ folder. */
export function watchersFor(handlerDirs: string[], relative: boolean): { globPattern: string | { baseUri: string; pattern: string } }[] {
  return [
    { globPattern: '**/*.js' },
    ...handlerDirs.map((dir) => ({ globPattern: relative ? { baseUri: pathToFileURL(dir).href, pattern: '**/*' } : `${dir.replace(/\\/g, '/')}/**/*` })),
  ];
}

/** The editor's name for links to the site (set at initialize), as for the docs links. */
let linkRef = 'lsp';

function toLspDiagnostic(l: Lines, d: LintDiagnostic) {
  return {
    range: l.range(d),
    severity: SEVERITY[d.severity],
    code: d.rule,
    codeDescription: { href: RULE_DOCS[d.rule] ? ruleUrl(d.rule, linkRef) : RULES_URL }, // the check's own page
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
          if (out instanceof Promise) void out.then((o) => o && write(o));
          else if (out) write(out);
          if (server.exited) return finish(0);
        }
      }
    });
    input.on('end', () => finish(0));
  });
}
