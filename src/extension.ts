import * as vscode from 'vscode';
import { registerWhatsNew } from './whatsnew';
import { Diagnostic as LintDiagnostic, lint, RuleId, Severity } from './core/lint';
import { registerCommands } from './commands';
import { registerTryIt } from './tryit';
import { CodeActionEntry, CompletionKind, completionsAt, fixAllAction, fixAllCodeAction, formatEdits as coreFormatEdits, hoverAt, inlayHints, isHandlerFile, quickFixes, RULES_URL, signatureHelpAt, Span } from './core/features';
import { lintPluginsFor } from './plugins';
import { publishedNow } from './published';

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
  context.subscriptions.push(collection);
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
        collection.set(doc.uri, toVsDiagnostics(doc, lint(text, { rules: ruleOverrides(), plugins: doc.uri.scheme === 'file' ? lintPluginsFor(doc.uri.fsPath) : undefined, published })));
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
      vscode.window.showInformationMessage(`Fixed ${edit.count} problem${edit.count === 1 ? '' : 's'}. Problems that need your decision are still listed.`);
    }),
    vscode.languages.registerCompletionItemProvider(SELECTOR, { provideCompletionItems: (d, p) => (featuresOn(d) ? completions(d, p) : undefined) }, '.', '=', ' ', '[', ','),
    vscode.languages.registerHoverProvider(SELECTOR, { provideHover: (d, p) => (featuresOn(d) ? hover(d, p) : undefined) }),
    // The name after each number in Game.ProtoInput.BlockedMessages: `0x0008` WM_KILLFOCUS.
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
    vscode.languages.registerSignatureHelpProvider(SELECTOR, { provideSignatureHelp: (d, p) => (featuresOn(d) ? signatureHelp(d, p) : undefined) }, '(', ','),
  );

  registerTryIt(context, isHandler);

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

function ruleOverrides(): Partial<Record<RuleId, Severity | 'off'>> {
  return config().get('lint.rules', {});
}

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

function toVsDiagnostics(doc: vscode.TextDocument, diags: LintDiagnostic[]): vscode.Diagnostic[] {
  return diags.map((d) => {
    const range = new vscode.Range(doc.positionAt(d.start), doc.positionAt(Math.max(d.end, d.start)));
    const v = new vscode.Diagnostic(range, d.message, SEVERITY[d.severity]);
    v.source = SOURCE;
    v.code = { value: d.rule, target: vscode.Uri.parse(`${RULES_URL}`) };
    if (d.tags) {
      v.tags = d.tags.map((t) => (t === 'deprecated' ? vscode.DiagnosticTag.Deprecated : vscode.DiagnosticTag.Unnecessary));
    }
    lintDiagnosticOf.set(v, d);
    return v;
  });
}

/** The edit that formats a handler (core/format.ts), or none. */
function formatEdits(doc: vscode.TextDocument, opts: { insertSpaces: boolean; tabSize: number }): vscode.TextEdit[] {
  const r = coreFormatEdits(doc.getText(), opts);
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
  const entries = completionsAt(doc.getText(), doc.offsetAt(pos));
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
  md.isTrusted = false;
  return md;
}

function hover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
  const h = hoverAt(doc.getText(), doc.offsetAt(pos));
  return h && new vscode.Hover(markdown(h.markdown), toRange(doc, h.range));
}

function signatureHelp(doc: vscode.TextDocument, pos: vscode.Position): vscode.SignatureHelp | undefined {
  const s = signatureHelpAt(doc.getText(), doc.offsetAt(pos));
  if (!s) return undefined;
  const help = new vscode.SignatureHelp();
  for (const sig of s.signatures) {
    const info = new vscode.SignatureInformation(sig.label, sig.documentation === undefined ? undefined : markdown(sig.documentation));
    info.parameters = sig.parameters.map((p) => new vscode.ParameterInformation(p));
    help.signatures.push(info);
  }
  help.activeSignature = s.activeSignature;
  help.activeParameter = s.activeParameter;
  return help;
}
