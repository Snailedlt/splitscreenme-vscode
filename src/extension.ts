import * as vscode from 'vscode';
import { api, DOCS_URL, Member, memberMarkdown, memberSignature, membersOf, ownerLabel, Resolved } from './core/api';
import { registerWhatsNew } from './whatsnew';
import { callContextAt, memberContextAt, resolveAt, valueContextAt } from './core/complete';
import { Diagnostic as LintDiagnostic, Fix, lint, looksLikeHandler, RuleId, RULES, Severity } from './core/lint';
import { registerCommands } from './commands';
import { registerTryIt } from './tryit';
import { fixAll } from './core/fix';
import { lintPluginsFor } from './plugins';
import { publishedNow } from './published';

const SOURCE = 'nucleus';
const RULES_URL = 'https://github.com/SplitScreen-Me/splitscreenme-vscode#lint-rules';
const SELECTOR: vscode.DocumentSelector = [
  { language: 'javascript', scheme: 'file' },
  { language: 'javascript', scheme: 'untitled' },
];

const fixesByDiagnostic = new WeakMap<vscode.Diagnostic, Fix[]>();

function config() {
  return vscode.workspace.getConfiguration('splitscreenme');
}

/** Is this document a Nucleus handler we should provide features for? */
export function isHandler(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== 'javascript') return false;
  const mode = config().get<'auto' | 'always' | 'off'>('detection', 'auto');
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  if (/[\\/]handlers[\\/][^\\/]+\.js$/i.test(doc.fileName)) return true;
  return looksLikeHandler(doc.getText());
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
    vscode.languages.registerCompletionItemProvider(SELECTOR, { provideCompletionItems: (d, p) => (featuresOn(d) ? completions(d, p) : undefined) }, '.', '=', ' '),
    vscode.languages.registerHoverProvider(SELECTOR, { provideHover: (d, p) => (featuresOn(d) ? hover(d, p) : undefined) }),
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
    if (d.fixes) fixesByDiagnostic.set(v, d.fixes);
    return v;
  });
}

const FIX_ALL_KIND = vscode.CodeActionKind.SourceFixAll.append('nucleus');

/** One edit replacing the document with the result of "Fix all", or undefined if nothing changes. */
function fixAllEdit(doc: vscode.TextDocument): { edit: vscode.WorkspaceEdit; count: number } | undefined {
  const text = doc.getText();
  const r = fixAll(text, { rules: ruleOverrides() });
  if (r.code === text) return undefined;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), r.code);
  return { edit, count: r.applied.length };
}

class FixProvider implements vscode.CodeActionProvider {
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    // "Fix all" (also runs on save with "editor.codeActionsOnSave": {"source.fixAll.nucleus": "explicit"}).
    if (ctx.only && FIX_ALL_KIND.intersects(ctx.only)) {
      if (!isHandler(doc)) return [];
      const fix = fixAllEdit(doc);
      if (!fix) return [];
      const a = new vscode.CodeAction(`Fix ${fix.count} auto-fixable Nucleus problem${fix.count === 1 ? '' : 's'}`, FIX_ALL_KIND);
      a.edit = fix.edit;
      return [a];
    }
    for (const diag of ctx.diagnostics) {
      if (diag.source !== SOURCE) continue;
      for (const fix of fixesByDiagnostic.get(diag) ?? []) {
        const a = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
        a.diagnostics = [diag];
        a.isPreferred = fix.preferred;
        a.edit = new vscode.WorkspaceEdit();
        for (const e of fix.edits) a.edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
        actions.push(a);
      }
      if (!actions.some((a) => a.kind === FIX_ALL_KIND) && fixesByDiagnostic.get(diag)?.some((f) => f.preferred)) {
        const fix = fixAllEdit(doc);
        if (fix && fix.count > 1) {
          const a = new vscode.CodeAction(`Fix all ${fix.count} auto-fixable problems`, FIX_ALL_KIND);
          a.edit = fix.edit;
          a.diagnostics = [diag];
          actions.push(a);
        }
      }
      const rule = typeof diag.code === 'object' ? String(diag.code.value) : String(diag.code);
      if (rule in RULES && rule !== 'syntax-error') {
        const line = doc.lineAt(diag.range.start.line);
        const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
        const a = new vscode.CodeAction(`Disable ${rule} for this line`, vscode.CodeActionKind.QuickFix);
        a.diagnostics = [diag];
        a.edit = new vscode.WorkspaceEdit();
        a.edit.insert(doc.uri, line.range.start, `${indent}// nucleus-lint-disable-next-line ${rule}\n`);
        actions.push(a);
      }
    }
    return actions;
  }
}

// ---------------------------------------------------------------------------
// Completion

const KIND: Record<Member['kind'], vscode.CompletionItemKind> = {
  field: vscode.CompletionItemKind.Field,
  property: vscode.CompletionItemKind.Property,
  method: vscode.CompletionItemKind.Method,
  object: vscode.CompletionItemKind.Module,
};

function valueSnippet(m: Member): string {
  const t = m.type ?? 'any';
  if (t === 'boolean') return '${1|true,false|}';
  if (t === 'number') return `\${1:${/^-?\d+(\.\d+)?$/.test(m.default ?? '') ? m.default : '0'}}`;
  if (t === 'string') return '"$1"';
  if (t.endsWith('[]')) return '["$1"]';
  if (t === 'function') return 'function () {\n\t$0\n}';
  if (t.startsWith('enum:')) {
    const e = t.slice(5);
    const values = api.enums[e] ? Object.keys(api.enums[e].values) : [];
    return values.length ? `Nucleus.${e}.\${1|${values.join(',')}|}` : '${1:true}';
  }
  return '$1';
}

function completions(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
  const text = doc.getText();
  const offset = doc.offsetAt(pos);
  // `Game.DPIHandling = |`: the option's values (enum values, true / false).
  const value = valueContextAt(text, offset);
  if (value && !value.partial.includes('.')) {
    const range = new vscode.Range(doc.positionAt(value.partialStart), pos);
    return value.values.map(({ value: v, detail }, i) => {
      const item = new vscode.CompletionItem(v, v.startsWith('Nucleus.') ? vscode.CompletionItemKind.EnumMember : vscode.CompletionItemKind.Value);
      item.range = range;
      item.detail = detail;
      item.sortText = String(i).padStart(3, '0');
      // The option's default first (preselected), then the rest in declared order.
      const def = value.member.default?.replace(/^(\w+)\.(\w+)$/, 'Nucleus.$1.$2');
      if (def && (def === v || value.member.default === v)) {
        item.preselect = true;
        item.detail = [detail, 'default'].filter(Boolean).join(' · ');
      }
      item.documentation = markdown(memberMarkdown(value.owner, value.name, value.member));
      return item;
    });
  }
  const ctx = memberContextAt(text, offset);
  if (!ctx) return globalCompletions(doc, pos);

  const lineText = doc.lineAt(pos.line).text;
  const before = lineText.slice(0, pos.character - ctx.partial.length);
  const after = lineText.slice(pos.character).replace(/^[\w$]*/, '');
  // `Game.Foo|` on its own line: complete the whole assignment.
  const assignmentContext = /^\s*(Game|Game\.Hook|Game\.ProtoInput|Context|Context\.Hook)\.$/.test(before) && after.trim() === '';
  const range = new vscode.Range(doc.positionAt(ctx.partialStart), pos.with(undefined, pos.character + (lineText.slice(pos.character).match(/^[\w$]*/)?.[0].length ?? 0)));

  return membersOf(ctx.base).map(({ name, member, enumValue, detail }, i) => {
    const item = new vscode.CompletionItem(name);
    item.range = range;
    if (member) {
      const owner = ownerOf(ctx.base);
      item.kind = KIND[member.kind];
      item.detail = memberSignature(owner, name, member)[0] + (member.overloads && member.overloads.length > 1 ? ` (+${member.overloads.length - 1} overloads)` : '');
      item.documentation = markdown(memberMarkdown(owner, name, member));
      if (member.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];
      // Required and documented options first, deprecated last.
      const rank = member.required ? 0 : member.deprecated ? 3 : member.doc ? 1 : 2;
      item.sortText = `${rank}_${name}`;
      if (member.kind === 'method') {
        item.insertText = new vscode.SnippetString(`${name}($1)`);
        item.command = { command: 'editor.action.triggerParameterHints', title: '' };
      } else if (assignmentContext && member.kind !== 'object' && !member.readonly) {
        item.insertText = new vscode.SnippetString(`${name} = ${valueSnippet(member)};`);
      }
    } else {
      item.kind = enumValue !== undefined ? vscode.CompletionItemKind.EnumMember : vscode.CompletionItemKind.Class;
      if (ctx.base.kind === 'nucleus') item.kind = detail === 'enum' ? vscode.CompletionItemKind.Enum : vscode.CompletionItemKind.Class;
      item.detail = detail;
      item.sortText = String(i).padStart(4, '0');
      if (ctx.base.kind === 'nucleus') {
        const info = api.enums[name] ?? api.nucleusClasses[name];
        if (info?.doc) item.documentation = markdown(info.doc);
      }
    }
    return item;
  });
}

function globalCompletions(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
  const range = doc.getWordRangeAtPosition(pos, /[\w$]+/);
  const word = range ? doc.getText(range) : '';
  if (!word || !/^[A-Z]/.test(word)) return undefined;
  // only at the start of an expression
  const charBefore = range && range.start.character > 0 ? doc.lineAt(pos.line).text[range.start.character - 1] : '';
  if (charBefore === '.') return undefined;
  return Object.entries(api.globals).filter(([, g]) => !g.hidden).map(([name, g]) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
    item.detail = `${name}: ${g.type}`;
    item.documentation = markdown(g.doc + (g.topLevel ? '' : '\n\n_Only available inside callbacks such as `Game.Play`._'));
    item.sortText = `0_${name}`;
    return item;
  });
}

function ownerOf(base: Resolved): string {
  if (base.kind === 'object') return base.type;
  if (base.kind === 'member' && base.member.ref) return base.member.ref;
  return '';
}

function markdown(s: string) {
  const md = new vscode.MarkdownString(s);
  md.isTrusted = false;
  return md;
}

// ---------------------------------------------------------------------------
// Hover

function hover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
  const text = doc.getText();
  const r = resolveAt(text, doc.offsetAt(pos));
  if (!r) return undefined;
  const range = new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end));
  const word = text.slice(r.start, r.end);
  const res = r.resolved;
  switch (res.kind) {
    case 'member':
      return new vscode.Hover(markdown(memberMarkdown(res.owner, res.name, res.member)), range);
    case 'enum': {
      const e = api.enums[res.name];
      return new vscode.Hover(markdown('```ts\nenum Nucleus.' + res.name + '\n```\n\n' + (e.doc ?? '') + '\n\n' + Object.entries(e.values).map(([k, v]) => `- \`${k}\` = ${v}`).join('\n')), range);
    }
    case 'enumValue':
      return new vscode.Hover(markdown('```ts\nNucleus.' + res.enumName + '.' + res.value + ' = ' + api.enums[res.enumName].values[res.value] + '\n```\n\n' + (api.enums[res.enumName].doc ?? '')), range);
    case 'nucleusClass': {
      const c = api.nucleusClasses[res.name];
      return new vscode.Hover(markdown('```ts\nnew Nucleus.' + res.name + '(' + c.params.join(', ') + ')\n```\n\n' + c.doc), range);
    }
    case 'object':
    case 'list':
    case 'nucleus': {
      const g = api.globals[word];
      if (!g) return undefined;
      return new vscode.Hover(markdown('```ts\n' + `${word}: ${g.type}` + '\n```\n\n' + g.doc + (g.topLevel ? '' : '\n\n_Only available inside callbacks such as `Game.Play`._') + `\n\n[Handler API docs](${DOCS_URL})`), range);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Signature help

function signatureHelp(doc: vscode.TextDocument, pos: vscode.Position): vscode.SignatureHelp | undefined {
  const c = callContextAt(doc.getText(), doc.offsetAt(pos));
  if (!c) return undefined;
  const help = new vscode.SignatureHelp();
  if (c.callee.kind === 'member' && c.callee.member.kind === 'method') {
    const { owner, name, member } = c.callee;
    for (const o of member.overloads ?? []) {
      const label = `${ownerLabel(owner)}.${name}(${o.params.map((p) => `${p.rest ? '...' : ''}${p.name}: ${p.type}`).join(', ')}): ${o.returns}`;
      const sig = new vscode.SignatureInformation(label, markdown(member.doc));
      sig.parameters = o.params.map((p) => new vscode.ParameterInformation(`${p.rest ? '...' : ''}${p.name}: ${p.type}`));
      help.signatures.push(sig);
    }
    // Prefer the first overload that has enough parameters for the cursor position.
    const idx = (member.overloads ?? []).findIndex((o) => o.params.length > c.activeParameter || o.params.some((p) => p.rest));
    help.activeSignature = Math.max(0, idx);
  } else if (c.callee.kind === 'nucleusClass') {
    const cls = api.nucleusClasses[c.callee.name];
    const sig = new vscode.SignatureInformation(`new Nucleus.${c.callee.name}(${cls.params.map((p) => `${p}: string`).join(', ')})`, markdown(cls.doc));
    sig.parameters = cls.params.map((p) => new vscode.ParameterInformation(`${p}: string`));
    help.signatures.push(sig);
  } else return undefined;
  help.activeParameter = c.activeParameter;
  return help;
}
