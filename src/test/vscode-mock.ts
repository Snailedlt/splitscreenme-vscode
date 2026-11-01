// A small stand-in for the `vscode` module so the extension glue can be tested
// with node:test. Only what src/extension.ts and src/commands.ts touch.
export class Position {
  constructor(public line: number, public character: number) {}
  with(line?: number, character?: number) {
    return new Position(line ?? this.line, character ?? this.character);
  }
}
export class Range {
  constructor(public start: Position, public end: Position) {}
}
export enum DiagnosticSeverity { Error, Warning, Information, Hint }
export enum DiagnosticTag { Unnecessary = 1, Deprecated = 2 }
export class Diagnostic {
  source?: string;
  code?: any;
  tags?: DiagnosticTag[];
  constructor(public range: Range, public message: string, public severity: DiagnosticSeverity) {}
}
export class CodeActionKind {
  static QuickFix = new CodeActionKind('quickfix');
  constructor(public value: string) {}
}
export class WorkspaceEdit {
  edits: { uri: any; range: Range; text: string }[] = [];
  replace(uri: any, range: Range, text: string) {
    this.edits.push({ uri, range, text });
  }
  insert(uri: any, pos: Position, text: string) {
    this.edits.push({ uri, range: new Range(pos, pos), text });
  }
}
export class CodeAction {
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  constructor(public title: string, public kind: CodeActionKind) {}
}
export enum CompletionItemKind { Method = 1, Field = 4, Variable = 5, Class = 6, Module = 8, Property = 9, Enum = 12, EnumMember = 19 }
export enum CompletionItemTag { Deprecated = 1 }
export class SnippetString {
  constructor(public value: string) {}
}
export class MarkdownString {
  isTrusted?: boolean;
  constructor(public value: string) {}
}
export class CompletionItem {
  kind?: CompletionItemKind;
  detail?: string;
  documentation?: MarkdownString;
  insertText?: SnippetString | string;
  range?: Range;
  sortText?: string;
  tags?: CompletionItemTag[];
  command?: any;
  constructor(public label: string, kind?: CompletionItemKind) {
    this.kind = kind;
  }
}
export class Hover {
  constructor(public contents: MarkdownString, public range?: Range) {}
}
export class ParameterInformation {
  constructor(public label: string) {}
}
export class SignatureInformation {
  parameters: ParameterInformation[] = [];
  constructor(public label: string, public documentation?: MarkdownString) {}
}
export class SignatureHelp {
  signatures: SignatureInformation[] = [];
  activeSignature = 0;
  activeParameter = 0;
}
export class Uri {
  constructor(public fsPath: string) {}
  static parse(s: string) {
    return new Uri(s);
  }
  static file(s: string) {
    return new Uri(s);
  }
  toString() {
    return this.fsPath;
  }
}
export class FileSystemError extends Error {
  code = '';
}
export enum ConfigurationTarget { Global = 1, Workspace, WorkspaceFolder }
export enum ProgressLocation { Notification = 15 }

// --- registries the tests can inspect --------------------------------------
export const __registered: Record<string, any[]> = { completion: [], hover: [], signature: [], codeAction: [], commands: [] };
export const __diagnostics = new Map<string, Diagnostic[]>();
export const __config: Record<string, any> = {};

const disposable = { dispose() {} };

export const languages = {
  createDiagnosticCollection: () => ({
    set: (uri: Uri, d: Diagnostic[]) => __diagnostics.set(uri.toString(), d),
    delete: (uri: Uri) => __diagnostics.delete(uri.toString()),
    dispose() {},
  }),
  registerCompletionItemProvider: (_s: any, p: any) => (__registered.completion.push(p), disposable),
  registerHoverProvider: (_s: any, p: any) => (__registered.hover.push(p), disposable),
  registerSignatureHelpProvider: (_s: any, p: any) => (__registered.signature.push(p), disposable),
  registerCodeActionsProvider: (_s: any, p: any) => (__registered.codeAction.push(p), disposable),
};
export const workspace = {
  textDocuments: [] as any[],
  workspaceFolders: undefined,
  onDidOpenTextDocument: () => disposable,
  onDidChangeTextDocument: () => disposable,
  onDidCloseTextDocument: () => disposable,
  onDidChangeConfiguration: () => disposable,
  getConfiguration: (section: string) => ({
    get: (key: string, def?: any) => (`${section}.${key}` in __config ? __config[`${section}.${key}`] : def),
    update: async () => {},
  }),
};
export const commands = {
  registerCommand: (id: string, fn: any) => (__registered.commands.push({ id, fn }), disposable),
  executeCommand: async () => {},
};
export const window = {
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
};
export const env = { openExternal: async () => true };

/** A minimal TextDocument over a string. */
export function makeDocument(text: string, fileName = '/work/handlers/Game.js') {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const positionAt = (o: number) => {
    let l = 0;
    while (l + 1 < starts.length && starts[l + 1] <= o) l++;
    return new Position(l, o - starts[l]);
  };
  const lines = text.split('\n');
  return {
    uri: Uri.file(fileName),
    fileName,
    languageId: 'javascript',
    isUntitled: false,
    getText: () => text,
    positionAt,
    offsetAt: (p: Position) => starts[p.line] + p.character,
    lineAt: (line: number) => ({
      text: lines[line],
      range: new Range(new Position(line, 0), new Position(line, lines[line].length)),
      firstNonWhitespaceCharacterIndex: lines[line].search(/\S|$/),
    }),
    getWordRangeAtPosition: (p: Position, re: RegExp) => {
      const t = lines[p.line];
      let s = p.character;
      let e = p.character;
      const w = new RegExp(`^${re.source}$`);
      while (s > 0 && w.test(t[s - 1])) s--;
      while (e < t.length && w.test(t[e])) e++;
      return s === e ? undefined : new Range(new Position(p.line, s), new Position(p.line, e));
    },
  };
}
