import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as mock from './vscode-mock';
import { activate, isHandler } from '../extension';
import { RULES } from '../core/lint';

const m = vscode as unknown as typeof mock;
const tick = () => new Promise((r) => setTimeout(r, 20));
const at = (src: string) => {
  const offset = src.indexOf('|');
  const doc = m.makeDocument(src.replace('|', ''));
  return { doc, pos: doc.positionAt(offset) };
};
const HEADER = 'Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\n';

before(() => {
  activate({ subscriptions: [], asAbsolutePath: (p: string) => p, globalStorageUri: m.Uri.file('/tmp') } as any);
});

test('registers all commands declared in package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const declared = pkg.contributes.commands.map((c: any) => c.command).sort();
  const registered = m.__registered.commands.map((c: any) => c.id).sort();
  assert.deepEqual(registered, declared);
});

test('package.json rule settings match the linter rules', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.contributes.configuration.properties['splitscreenme.lint.rules'].properties).sort(), Object.keys(RULES).sort());
});

test('handler detection', () => {
  assert.equal(isHandler(m.makeDocument(HEADER, '/x/Game.js') as any), true);
  assert.equal(isHandler(m.makeDocument('var x = 1;', '/x/handlers/Game.js') as any), true);
  assert.equal(isHandler(m.makeDocument('var x = 1;', '/x/app.js') as any), false);
});

test('diagnostics are published with codes, tags and positions', async () => {
  const doc = m.makeDocument(HEADER + 'Game.Hook.ForceFocuss = true;\nGame.HookGetCursorPos = true;\n');
  m.workspace.textDocuments = [doc];
  activate({ subscriptions: [] } as any);
  await tick();
  const diags = m.__diagnostics.get(doc.uri.toString())!;
  assert.equal(diags.length, 2);
  assert.equal(diags[0].code.value, 'unknown-member');
  assert.deepEqual([diags[0].range.start.line, diags[0].range.start.character], [3, 10]);
  assert.equal(diags[0].severity, m.DiagnosticSeverity.Warning);
  assert.deepEqual(diags[1].tags, [m.DiagnosticTag.Deprecated]);

  // quick fixes come back through the code action provider
  const actions = m.__registered.codeAction[0].provideCodeActions(doc, diags[0].range, { diagnostics: [diags[0]] });
  assert.equal(actions[0].title, 'Change to `ForceFocus`');
  assert.equal(actions[0].isPreferred, true);
  assert.equal(actions[0].edit.edits[0].text, 'ForceFocus');
  assert.match(actions[1].title, /Disable unknown-member/);
  assert.equal(actions[1].edit.edits[0].text, '// nucleus-lint-disable-next-line unknown-member\n');
  m.workspace.textDocuments = [];
});

test('completion after Game. offers assignment snippets at line start', () => {
  const { doc, pos } = at(HEADER + 'Game.Symlink|');
  const items = m.__registered.completion[0].provideCompletionItems(doc, pos);
  const sym = items.find((i: any) => i.label === 'SymlinkGame');
  assert.equal(sym.insertText.value, 'SymlinkGame = ${1|true,false|};');
  assert.equal(sym.kind, m.CompletionItemKind.Field);
  assert.deepEqual([sym.range.start.character, sym.range.end.character], [5, 12]);
  const guid = items.find((i: any) => i.label === 'GUID');
  assert.ok(guid.sortText.startsWith('0_'), 'required options sort first');
  const dpi = items.find((i: any) => i.label === 'DPIHandling');
  assert.match(dpi.insertText.value, /Nucleus\.DPIHandling\.\$\{1\|True,Scaled,InvScaled\|\}/);
  const hook = items.find((i: any) => i.label === 'Hook');
  assert.equal(hook.insertText, undefined, 'objects are not assigned');
});

test('completion inside expressions inserts names only, methods as calls', () => {
  const { doc, pos } = at(HEADER + 'Game.Play = function () {\n  var p = Context.GetF|\n};');
  const items = m.__registered.completion[0].provideCompletionItems(doc, pos);
  const gf = items.find((i: any) => i.label === 'GetFolder');
  assert.equal(gf.kind, m.CompletionItemKind.Method);
  assert.equal(gf.insertText.value, 'GetFolder($1)');
  const width = items.find((i: any) => i.label === 'Width');
  assert.equal(width.insertText, undefined);
});

test('global completions', () => {
  const { doc, pos } = at('Game.Play = function () {\n  Con|\n};');
  const items = m.__registered.completion[0].provideCompletionItems(doc, pos);
  assert.ok(items.some((i: any) => i.label === 'Context'));
});

test('hover shows docs', () => {
  const { doc, pos } = at('Game.Hook.Force|Focus = true;');
  const h = m.__registered.hover[0].provideHover(doc, pos);
  assert.match(h.contents.value, /Game\.Hook\.ForceFocus: boolean/);
  assert.match(h.contents.value, /focus/i);
  const e = m.__registered.hover[0].provideHover(...Object.values(at('var f = Nucleus.Folder.Docu|ments;')));
  assert.match(e.contents.value, /Nucleus\.Folder\.Documents = 0/);
});

test('signature help', () => {
  const { doc, pos } = at('Game.Play = function () {\n  Context.RemoveLineInTextFile(path, |');
  const s = m.__registered.signature[0].provideSignatureHelp(doc, pos);
  assert.ok(s.signatures.length >= 2);
  assert.equal(s.activeParameter, 1);
  assert.match(s.signatures[0].label, /^Context\.RemoveLineInTextFile\(/);
});

test('features are off for non-handlers and when disabled', () => {
  const plain = m.makeDocument('var x = { Hook: 1 };\nx.', '/x/app.js');
  assert.equal(m.__registered.completion[0].provideCompletionItems(plain, new m.Position(1, 2)), undefined);
  m.__config['splitscreenme.completion.enable'] = false;
  const { doc, pos } = at(HEADER + 'Game.|');
  assert.equal(m.__registered.completion[0].provideCompletionItems(doc, pos), undefined);
  delete m.__config['splitscreenme.completion.enable'];
});

test('fix-all code action (source.fixAll.nucleus) and in quick fixes', async () => {
  const src = HEADER + 'Game.KillMutex = "M";\nGame.SymlinkGame = "true";\nGame.DPIHandling = true;\n';
  const doc = m.makeDocument(src);
  const provider = m.__registered.codeAction[0];
  const all = provider.provideCodeActions(doc, null, { diagnostics: [], only: m.CodeActionKind.SourceFixAll });
  assert.equal(all.length, 1);
  assert.equal(all[0].kind.value, 'source.fixAll.nucleus');
  const text = all[0].edit.edits[0].text;
  assert.match(text, /Game\.KillMutex = \["M"\];\nGame\.SymlinkGame = true;\nGame\.DPIHandling = true;/);
  // nothing to do on a clean handler
  assert.deepEqual(provider.provideCodeActions(m.makeDocument(HEADER), null, { diagnostics: [], only: m.CodeActionKind.SourceFixAll }), []);
});
