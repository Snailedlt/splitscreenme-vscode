import * as vscode from 'vscode';
import { registerWhatsNew } from './whatsnew';
import { Diagnostic as LintDiagnostic, lint, RuleId, Severity } from './core/lint';
import { registerCommands } from './commands';
import { registerTryIt } from './tryit';
import { docsCommandLink, OPEN_DOCS, registerDocsPanel } from './docspanel';
import { ruleOverrides } from './settings';
import { definitionAt } from './core/definition';
import { rangeFormatEdits } from './core/features';
import { CodeActionEntry, CompletionKind, completionsAt, explainLine, documentSymbols, SymbolEntry, fixAllAction, fixAllCodeAction, formatEdits as coreFormatEdits, hoverAt, inlayHints, isHandlerFile, quickFixes, RULES_URL, SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES, semanticTokens, signatureHelpAt, Span } from './core/features';
import { RULE_DOCS, ruleUrl } from './core/ruledocs';
import { lintPluginsFor } from './plugins';
import { publishedNow } from './published';
import { checkPackage, type PkgProblem } from './core/pkgcheck';
import { gameFolderDiagnostics, registerGameFolders } from './gamefolders';
import { registerDebugger } from './debugvscode';
import { forgetPackageFiles, packageFileForPath, packageFilesFor, packageFilePath } from './pkgfiles';

const SOURCE = 'nucleus';
const SELECTOR: vscode.DocumentSelector = [
  { language: 'javascript', scheme: 'file' },
  { language: 'javascript', scheme: 'untitled' },
];

const lintDiagnosticOf = new WeakMap<vscode.Diagnostic, LintDiagnostic>();

function config() {
  return vscode.workspace.getConfiguration('splitscreenme');
}

/** Is this document a Nucleus handler we should provide features for? */
export function isHandler(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== 'javascript') return false;
  const mode = config().get<'auto' | 'always' | 'off'>('detection', 'auto');
  return isHandlerFile(doc.fileName, doc.getText(), mode);
}

export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);
  // Package checks on the files in a handler's folder (core/pkgcheck.ts): kept apart, since those files aren't handlers.
  const pkgCollection = vscode.languages.createDiagnosticCollection(`${SOURCE}-package`);
  const pkgUris = new Map<string, vscode.Uri[]>();
  context.subscriptions.push(collection, pkgCollection);
  registerWhatsNew(context);

  // AI agents in VS Code (Copilot agent mode, VS Code 1.101+): offer the handler tools as an MCP
  // server, the bundled `nucleus mcp`, run by VS Code's own Node.
  const lm = (vscode as any).lm;
  const McpStdio = (vscode as any).McpStdioServerDefinition;
  if (lm?.registerMcpServerDefinitionProvider && McpStdio) {
    const cli = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.js').fsPath;
    context.subscriptions.push(
      lm.registerMcpServerDefinitionProvider('nucleus', {
        provideMcpServerDefinitions: () => [new McpStdio('Nucleus Co-op handler tools', process.execPath, [cli, 'mcp'], { ELECTRON_RUN_AS_NODE: '1' }, context.extension?.packageJSON?.version)],
      }),
    );
  }

  const timers = new Map<string, NodeJS.Timeout>();
  const refresh = (doc: vscode.TextDocument, delay = 250) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        if (!config().get('lint.enable', true) || !isHandler(doc)) {
          collection.delete(doc.uri);
          return;
        }
        const text = doc.getText();
        // The Hub's published version, for guid-changed: fetched once (cached), then this runs again.
        const published = config().get('lint.compareWithHub', true) ? publishedNow(text, () => refresh(doc, 0)) : undefined;
        const diags = toVsDiagnostics(doc, lint(text, { rules: ruleOverrides(), plugins: doc.uri.scheme === 'file' ? lintPluginsFor(doc.uri.fsPath) : undefined, published }));
        // The handler's folder, as it goes into the .nc: files a Hub install mishandles, files the handler uses that aren't there.
        const files = doc.uri.scheme === 'file' && config().get('lint.packageChecks', true) ? packageFilesFor(doc.uri.fsPath) : undefined;
        const problems = files ? checkPackage(text, files) : [];
        diags.push(...problems.filter((p) => !p.file && p.start !== undefined).map((p) => pkgDiagnostic(p, new vscode.Range(doc.positionAt(p.start!), doc.positionAt(p.end ?? p.start!)))));
        // The game folder linked to this handler (Nucleus: Link the Game's Folder…), if any.
        diags.push(...gameFolderDiagnostics(doc, SOURCE, SEVERITY));
        collection.set(doc.uri, diags);
        for (const u of pkgUris.get(key) ?? []) pkgCollection.delete(u);
        const byFile = new Map<string, vscode.Diagnostic[]>();
        for (const p of problems.filter((p) => p.file)) {
          const line = Math.max(0, (p.line ?? 1) - 1);
          const list = byFile.get(p.file!) ?? [];
          list.push(pkgDiagnostic(p, new vscode.Range(line, 0, line, p.line ? 1000 : 0)));
          byFile.set(p.file!, list);
        }
        const uris = [...byFile].map(([name, list]) => {
          const u = vscode.Uri.file(packageFilePath(doc.uri.fsPath, name));
          pkgCollection.set(u, list);
          return u;
        });
        pkgUris.set(key, uris);
      }, delay),
    );
  };
  const refreshAll = () => vscode.workspace.textDocuments.forEach((d) => refresh(d, 0));

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => refresh(d, 0)),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      // Keep results from "Lint all handlers" for files that aren't open.
      if (d.isUntitled) collection.delete(d.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('splitscreenme') && refreshAll()),
    // A file in a handler's folder changed: check that handler's package again.
    ...(() => {
      const w = vscode.workspace.createFileSystemWatcher('**/*');
      const changed = (u: vscode.Uri) => {
        const handler = packageFileForPath(u.fsPath, vscode.workspace.textDocuments.filter((d) => d.uri.scheme === 'file').map((d) => d.uri.fsPath));
        if (!handler) return;
        forgetPackageFiles(handler);
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === handler);
        if (doc) refresh(doc, 300);
      };
      return [w, w.onDidCreate(changed), w.onDidChange(changed), w.onDidDelete(changed)];
    })(),
  );
  refreshAll();

  const featuresOn = (doc: vscode.TextDocument) => config().get('completion.enable', true) && isHandler(doc);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(SELECTOR, new FixProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, FIX_ALL_KIND] }),
    // Shift+Alt+F in a handler (package.json keybinding): VS Code's own JavaScript formatter would
    // otherwise ask which one to use, and other .js files keep theirs.
    vscode.commands.registerCommand('splitscreenme.formatHandler', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isHandler(editor.document)) return vscode.commands.executeCommand('editor.action.formatDocument');
      const opts = editor.options;
      const [edit] = formatEdits(editor.document, { insertSpaces: opts.insertSpaces !== false, tabSize: typeof opts.tabSize === 'number' ? opts.tabSize : 4 });
      if (edit) await editor.edit((b) => b.replace(edit.range, edit.newText));
      else vscode.window.setStatusBarMessage('Nucleus: already formatted', 2500);
    }),
    // Explain This Line (Ctrl+Alt+E, the editor's right-click menu or the palette): the line's explanation as a hover.
    // `at.line`: a line to explain instead of the cursor's (for other callers); the cursor moves there first.
    vscode.commands.registerCommand(EXPLAIN, async (at?: { line?: number }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isHandler(editor.document)) {
        vscode.window.showInformationMessage('Open a Nucleus handler to explain a line of it.');
        return;
      }
      if (typeof at?.line === 'number' && at.line >= 0 && at.line < editor.document.lineCount) {
        const p = new vscode.Position(at.line, editor.document.lineAt(at.line).firstNonWhitespaceCharacterIndex);
        editor.selection = new vscode.Selection(p, p);
      }
      const pos = editor.selection.active;
      const line = editor.document.lineAt(pos.line);
      if (line.isEmptyOrWhitespace) {
        vscode.window.setStatusBarMessage('Nucleus: an empty line, nothing to explain', 2500);
        return;
      }
      if (pos.character < line.firstNonWhitespaceCharacterIndex) editor.selection = new vscode.Selection(pos.with(undefined, line.firstNonWhitespaceCharacterIndex), pos.with(undefined, line.firstNonWhitespaceCharacterIndex));
      explainPending = { uri: editor.document.uri.toString(), line: pos.line };
      await vscode.commands.executeCommand('editor.action.showHover');
    }),
    vscode.commands.registerCommand('splitscreenme.fixAll', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isHandler(editor.document)) {
        vscode.window.showInformationMessage('Open a Nucleus handler to fix it.');
        return;
      }
      const edit = fixAllEdit(editor.document);
      if (!edit) {
        vscode.window.showInformationMessage('Nothing to fix automatically.');
        return;
      }
      await vscode.workspace.applyEdit(edit.edit);
      const left = lint(editor.document.getText(), { rules: ruleOverrides() }).filter((d) => d.severity === 'error' || d.severity === 'warning').length;
      vscode.window.showInformationMessage(`Fixed ${edit.count} problem${edit.count === 1 ? '' : 's'}.${left ? ` ${left} need${left === 1 ? 's' : ''} your decision: see the Problems panel.` : ' Nothing else to fix.'}`);
    }),
    vscode.languages.registerCompletionItemProvider(SELECTOR, { provideCompletionItems: (d, p) => (featuresOn(d) ? completions(d, p) : undefined) }, '.', '=', ' ', '[', ',', '"', "'"),
    vscode.languages.registerHoverProvider(SELECTOR, { provideHover: (d, p) => (featuresOn(d) ? hover(d, p) : undefined) }),
    // Outline, breadcrumbs and Go to Symbol (Ctrl+Shift+O): the settings by object, the callbacks, the handler's own names.
    // Go to definition: the handler's own functions and variables, `Game.X` to where it's set, and
    // `Context.Options["key"]` to its `Game.AddOption` (VS Code's JavaScript support adds the rest).
    vscode.languages.registerDefinitionProvider(SELECTOR, {
      provideDefinition: (d, pos) => {
        if (!featuresOn(d)) return undefined;
        const r = definitionAt(d.getText(), d.offsetAt(pos));
        return r ? new vscode.Location(d.uri, new vscode.Range(d.positionAt(r.start), d.positionAt(r.end))) : undefined;
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, { provideDocumentSymbols: (d) => (featuresOn(d) ? documentSymbols(d.getText()).map((s) => toVsSymbol(d, s)) : []) }, { label: 'Nucleus handler' }),
    // The name after each number in Game.ProtoInput.BlockedMessages: `0x0008` WM_KILLFOCUS.
    // Nucleus names in the theme's colours: Game/Context as objects, their properties, methods and enum values.
    // Outside handlers it returns nothing, so JavaScript's own semantic colouring applies there.
    (() => {
      const legend = new vscode.SemanticTokensLegend([...SEMANTIC_TOKEN_TYPES], [...SEMANTIC_TOKEN_MODIFIERS]);
      return vscode.languages.registerDocumentSemanticTokensProvider(
        SELECTOR,
        {
          provideDocumentSemanticTokens: (d) => {
            if (!featuresOn(d)) return undefined;
            const b = new vscode.SemanticTokensBuilder(legend);
            for (const t of semanticTokens(d.getText())) {
              const start = d.positionAt(t.start);
              b.push(new vscode.Range(start, d.positionAt(t.end)), t.type, t.modifiers);
            }
            return b.build();
          },
        },
        legend,
      );
    })(),
    vscode.languages.registerInlayHintsProvider(SELECTOR, {
      provideInlayHints: (d) =>
        featuresOn(d)
          ? inlayHints(d.getText()).map((x) => {
              const h = new vscode.InlayHint(d.positionAt(x.offset), x.label);
              h.paddingLeft = true;
              h.tooltip = new vscode.MarkdownString(x.tooltip);
              return h;
            })
          : [],
    }),
    // Format Document (Shift+Alt+F): indentation and spacing only (core/format.ts).
    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, {
      provideDocumentFormattingEdits: (doc, opts) => (isHandler(doc) ? formatEdits(doc, opts) : []),
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider(SELECTOR, {
      provideDocumentRangeFormattingEdits: (doc, range, opts) => (isHandler(doc) ? rangeFormat(doc, doc.offsetAt(range.start), doc.offsetAt(range.end), opts) : []),
    }),
    // Format on type (VS Code's editor.formatOnType): the line just finished, after `}`, `;` or Enter.
    vscode.languages.registerOnTypeFormattingEditProvider(SELECTOR, {
      provideOnTypeFormattingEdits: (doc, pos, ch, opts) => {
        if (!isHandler(doc)) return [];
        const line = ch === '\n' ? Math.max(0, pos.line - 1) : pos.line;
        const at = doc.offsetAt(new vscode.Position(line, 0));
        return rangeFormat(doc, at, at, opts, true);
      },
    }, '}', ';', '\n'),
    vscode.languages.registerSignatureHelpProvider(SELECTOR, { provideSignatureHelp: (d, p) => (featuresOn(d) ? signatureHelp(d, p) : undefined) }, '(', ','),
  );

  registerTryIt(context, isHandler);
  registerDocsPanel(context);
  registerGameFolders(context, isHandler, SELECTOR, (d) => refresh(d, 0));
  registerDebugger(context, isHandler);

  registerCommands(context, {
    lintFiles: (entries) => {
      for (const { uri, text } of entries) {
        const fake = { getText: () => text, positionAt: offsetToPosition(text) } as unknown as vscode.TextDocument;
        collection.set(uri, toVsDiagnostics(fake, lint(text, { rules: ruleOverrides(), plugins: uri.scheme === 'file' ? lintPluginsFor(uri.fsPath) : undefined })));
      }
    },
  });
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Diagnostics


const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

function offsetToPosition(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return new vscode.Position(lo, offset - starts[lo]);
  };
}

const SYMBOL_KIND: Record<SymbolEntry['kind'], vscode.SymbolKind> = { namespace: vscode.SymbolKind.Namespace, property: vscode.SymbolKind.Property, function: vscode.SymbolKind.Function, variable: vscode.SymbolKind.Variable };
function toVsSymbol(doc: vscode.TextDocument, s: SymbolEntry): vscode.DocumentSymbol {
  const sym = new vscode.DocumentSymbol(s.name, s.detail ?? '', SYMBOL_KIND[s.kind], new vscode.Range(doc.positionAt(s.range.start), doc.positionAt(s.range.end)), new vscode.Range(doc.positionAt(s.selection.start), doc.positionAt(s.selection.end)));
  sym.children = (s.children ?? []).map((c) => toVsSymbol(doc, c));
  return sym;
}

/** A package check's problem as a VS Code diagnostic (no quick fixes: moving files is up to the author). */
function pkgDiagnostic(p: PkgProblem, range: vscode.Range): vscode.Diagnostic {
  const v = new vscode.Diagnostic(range, `${p.title}. ${p.why}`, SEVERITY[p.severity]);
  v.source = SOURCE;
  v.code = { value: 'package', target: vscode.Uri.parse(RULES_URL) };
  return v;
}

function toVsDiagnostics(doc: vscode.TextDocument, diags: LintDiagnostic[]): vscode.Diagnostic[] {
  return diags.map((d) => {
    const range = new vscode.Range(doc.positionAt(d.start), doc.positionAt(Math.max(d.end, d.start)));
    const v = new vscode.Diagnostic(range, d.message, SEVERITY[d.severity]);
    v.source = SOURCE;
    v.code = { value: d.rule, target: vscode.Uri.parse(RULE_DOCS[d.rule] ? ruleUrl(d.rule, 'vscode') : RULES_URL) }; // the check's own page
    if (d.tags) {
      v.tags = d.tags.map((t) => (t === 'deprecated' ? vscode.DiagnosticTag.Deprecated : vscode.DiagnosticTag.Unnecessary));
    }
    lintDiagnosticOf.set(v, d);
    return v;
  });
}

/** The edit that formats a handler (core/format.ts), or none. */
function formatStyle(opts: { insertSpaces: boolean; tabSize: number }) {
  const cfg = vscode.workspace.getConfiguration('splitscreenme.format');
  return { insertSpaces: opts.insertSpaces, tabSize: opts.tabSize, quotes: cfg.get<'double' | 'single' | 'keep'>('quotes', 'double'), semicolons: cfg.get<'add' | 'keep'>('semicolons', 'add') };
}
/** Only the lines from `start` to `end` (a selection, or the line just typed). */
function rangeFormat(doc: vscode.TextDocument, start: number, end: number, opts: { insertSpaces: boolean; tabSize: number }, quiet = false): vscode.TextEdit[] {
  const r = rangeFormatEdits(doc.getText(), start, end, formatStyle(opts));
  if ('error' in r) {
    if (!quiet) void vscode.window.showWarningMessage(`Nucleus: ${r.error}`);
    return [];
  }
  return r.edits.map((e) => vscode.TextEdit.replace(toRange(doc, e), e.text));
}

function formatEdits(doc: vscode.TextDocument, opts: { insertSpaces: boolean; tabSize: number }): vscode.TextEdit[] {
  const r = coreFormatEdits(doc.getText(), formatStyle(opts));
  if ('error' in r) {
    void vscode.window.showWarningMessage(`Nucleus: ${r.error}`);
    return [];
  }
  return r.edits.map((e) => vscode.TextEdit.replace(toRange(doc, e), e.text));
}

const FIX_ALL_KIND = vscode.CodeActionKind.SourceFixAll.append('nucleus');

/** One edit replacing the document with the result of "Fix all", or undefined if nothing changes. */
function fixAllEdit(doc: vscode.TextDocument): { edit: vscode.WorkspaceEdit; count: number } | undefined {
  const fix = fixAllAction(doc.getText(), ruleOverrides());
  if (!fix) return undefined;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, toRange(doc, fix.edit), fix.edit.text);
  return { edit, count: fix.count };
}

function toCodeAction(doc: vscode.TextDocument, a: CodeActionEntry, diag?: vscode.Diagnostic): vscode.CodeAction {
  const action = new vscode.CodeAction(a.title, a.kind === 'source.fixAll' ? FIX_ALL_KIND : vscode.CodeActionKind.QuickFix);
  if (diag) action.diagnostics = [diag];
  if (a.preferred !== undefined) action.isPreferred = a.preferred;
  action.edit = new vscode.WorkspaceEdit();
  for (const e of a.edits) {
    if (e.start === e.end) action.edit.insert(doc.uri, doc.positionAt(e.start), e.text);
    else action.edit.replace(doc.uri, toRange(doc, e), e.text);
  }
  return action;
}

class FixProvider implements vscode.CodeActionProvider {
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    // "Fix all" (also runs on save with "editor.codeActionsOnSave": {"source.fixAll.nucleus": "explicit"}).
    if (ctx.only && FIX_ALL_KIND.intersects(ctx.only)) {
      if (!isHandler(doc)) return [];
      const a = fixAllCodeAction(doc.getText(), ruleOverrides());
      return a ? [toCodeAction(doc, a)] : [];
    }
    const ours = ctx.diagnostics.filter((d) => d.source === SOURCE && lintDiagnosticOf.has(d));
    const byLint = new Map(ours.map((d) => [lintDiagnosticOf.get(d)!, d]));
    return quickFixes(doc.getText(), [...byLint.keys()], ruleOverrides()).map((a) => toCodeAction(doc, a, a.diagnostic && byLint.get(a.diagnostic)));
  }
}

// ---------------------------------------------------------------------------
// Completion, hover, signature help: core/features.ts, converted to VS Code types.

const KIND: Record<CompletionKind, vscode.CompletionItemKind> = {
  field: vscode.CompletionItemKind.Field,
  property: vscode.CompletionItemKind.Property,
  method: vscode.CompletionItemKind.Method,
  function: vscode.CompletionItemKind.Function,
  keyword: vscode.CompletionItemKind.Keyword,
  module: vscode.CompletionItemKind.Module,
  variable: vscode.CompletionItemKind.Variable,
  class: vscode.CompletionItemKind.Class,
  enum: vscode.CompletionItemKind.Enum,
  enumMember: vscode.CompletionItemKind.EnumMember,
  constant: vscode.CompletionItemKind.Constant,
  value: vscode.CompletionItemKind.Value,
  snippet: vscode.CompletionItemKind.Snippet,
};

const toRange = (doc: vscode.TextDocument, s: Span) => new vscode.Range(doc.positionAt(s.start), doc.positionAt(s.end));

function completions(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
  const entries = completionsAt(doc.getText(), doc.offsetAt(pos), { own: false, docsLink: docsCommandLink });
  return entries?.map((e) => {
    const item = new vscode.CompletionItem(e.labelDetail ? { label: e.label, description: e.labelDetail } : e.label, KIND[e.kind]);
    if (e.range) item.range = toRange(doc, e.range);
    if (e.insertText !== undefined) item.insertText = e.snippet ? new vscode.SnippetString(e.insertText) : e.insertText;
    if (e.filterText) item.filterText = e.filterText;
    if (e.detail !== undefined) item.detail = e.detail;
    if (e.documentation !== undefined) item.documentation = markdown(e.documentation);
    if (e.sortText) item.sortText = e.sortText;
    if (e.preselect) item.preselect = true;
    if (e.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];
    if (e.signatureHelp) item.command = { command: 'editor.action.triggerParameterHints', title: '' };
    return item;
  });
}

function markdown(s: string) {
  const md = new vscode.MarkdownString(s);
  // API names link to the Nucleus Docs panel: that one command may run from a link, nothing else.
  md.isTrusted = { enabledCommands: [OPEN_DOCS] };
  return md;
}

const EXPLAIN = 'splitscreenme.explainLine';
/** Set by Explain This Line until the hover it opens has shown. */
let explainPending: { uri: string; line: number } | undefined;

function hover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
  const p = explainPending;
  explainPending = undefined;
  if (p && p.uri === doc.uri.toString() && p.line === pos.line) {
    const e = explainLine(doc.getText(), doc.offsetAt(pos));
    if (e) return new vscode.Hover(markdown(e.markdown), doc.lineAt(pos.line).range);
  }
  const h = hoverAt(doc.getText(), doc.offsetAt(pos), { own: false, docsLink: docsCommandLink });
  return h && new vscode.Hover(markdown(h.markdown), toRange(doc, h.range));
}

function signatureHelp(doc: vscode.TextDocument, pos: vscode.Position): vscode.SignatureHelp | undefined {
  const s = signatureHelpAt(doc.getText(), doc.offsetAt(pos), { own: false, docsLink: docsCommandLink });
  if (!s) return undefined;
  const help = new vscode.SignatureHelp();
  for (const sig of s.signatures) {
    const info = new vscode.SignatureInformation(sig.label, sig.documentation === undefined ? undefined : markdown(sig.documentation));
    info.parameters = sig.parameters.map((p, i) => new vscode.ParameterInformation(p, sig.parameterDocs?.[i] ? markdown(sig.parameterDocs[i]!) : undefined));
    help.signatures.push(info);
  }
  help.activeSignature = s.activeSignature;
  help.activeParameter = s.activeParameter;
  return help;
}
