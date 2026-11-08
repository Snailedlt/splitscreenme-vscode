import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { globToRegExp, isHandlerFile } from '../core/features';
import { snippetToPlain } from '../lsp';

// The real server: `node dist/cli.js lsp`, spoken to over stdio like an editor would.
const HEADER = 'Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\n';
const URI = 'file:///tmp/nucleus-lsp-test/handlers/Test.js';

let proc: ChildProcess;
let nextId = 1;
const pending = new Map<number, (msg: any) => void>();
const notifications: any[] = [];
const waiters: { match: (m: any) => boolean; resolve: (m: any) => void }[] = [];

function send(msg: unknown) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  proc.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`);
  proc.stdin!.write(body);
}
const notify = (method: string, params: unknown) => send({ jsonrpc: '2.0', method, params });
function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
}
function nextNotification(match: (m: any) => boolean): Promise<any> {
  const found = notifications.find(match);
  if (found) {
    notifications.splice(notifications.indexOf(found), 1);
    return Promise.resolve(found);
  }
  return new Promise((resolve) => waiters.push({ match, resolve }));
}
const diagnosticsFor = (uri: string, version?: number) => nextNotification((m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri && (version === undefined || m.params.version === version));

before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'cli.js'), 'lsp', '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = Buffer.alloc(0);
  proc.stdout!.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const len = Number(buf.subarray(0, sep).toString().match(/Content-Length: (\d+)/i)![1]);
      if (buf.length < sep + 4 + len) return;
      const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString('utf8'));
      buf = buf.subarray(sep + 4 + len);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      } else {
        const w = waiters.find((x) => x.match(msg));
        if (w) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        } else notifications.push(msg);
      }
    }
  });
  const init = await request('initialize', { processId: null, rootUri: null, capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } } }, initializationOptions: { lint: { compareWithHub: false } } });
  const caps = init.result.capabilities;
  assert.equal(caps.textDocumentSync.change, 1);
  assert.deepEqual(caps.completionProvider.triggerCharacters, ['.', '=', ' ', '[', ',', '"']);
  assert.ok(caps.hoverProvider && caps.documentFormattingProvider && caps.inlayHintProvider && caps.signatureHelpProvider);
  assert.ok(caps.executeCommandProvider.commands.includes('nucleus.tryIt'));
  notify('initialized', {});
});

after(async () => {
  const r = await request('shutdown', null);
  assert.equal(r.result, null);
  const exited = new Promise((resolve) => proc.on('exit', resolve));
  notify('exit', null);
  assert.equal(await exited, 0);
});

test('lsp: diagnostics with codes, links and tags; quick fixes and fix all', async () => {
  const text = HEADER + 'Game.Hook.ForceFocuss = true;\nGame.HookGetCursorPos = true;\nGame.KillMutex = "M";\n';
  notify('textDocument/didOpen', { textDocument: { uri: URI, languageId: 'javascript', version: 1, text } });
  const { params } = await diagnosticsFor(URI, 1);
  const unknown = params.diagnostics.find((d: any) => d.code === 'unknown-member');
  assert.deepEqual(unknown.range.start, { line: 3, character: 10 });
  assert.equal(unknown.severity, 2);
  assert.equal(unknown.source, 'nucleus');
  assert.match(unknown.codeDescription.href, /#lint-rules$/);
  assert.ok(params.diagnostics.some((d: any) => d.tags?.includes(2)), 'deprecated tag');

  const actions = (await request('textDocument/codeAction', { textDocument: { uri: URI }, range: unknown.range, context: { diagnostics: [unknown] } })).result;
  assert.equal(actions[0].title, 'Change to `ForceFocus`');
  assert.equal(actions[0].kind, 'quickfix');
  assert.equal(actions[0].isPreferred, true);
  assert.deepEqual(actions[0].diagnostics, [unknown]);
  const edit = actions[0].edit.changes[URI][0];
  assert.equal(edit.newText, 'ForceFocus');
  assert.deepEqual(edit.range.start, { line: 3, character: 10 });
  assert.ok(actions.some((a: any) => /Disable unknown-member/.test(a.title)));
  assert.ok(actions.some((a: any) => a.kind === 'source.fixAll.nucleus'));

  const fixAll = (await request('textDocument/codeAction', { textDocument: { uri: URI }, range: unknown.range, context: { diagnostics: [], only: ['source.fixAll'] } })).result;
  assert.equal(fixAll.length, 1);
  assert.match(fixAll[0].edit.changes[URI][0].newText, /Game\.KillMutex = \["M"\];/);

  // a change re-lints
  notify('textDocument/didChange', { textDocument: { uri: URI, version: 2 }, contentChanges: [{ text: HEADER }] });
  assert.deepEqual((await diagnosticsFor(URI, 2)).params.diagnostics, []);
});

test('lsp: hover, completion, value suggestions, signature help, inlay hints', async () => {
  const text = HEADER + 'Game.Hook.ForceFocus = true;\nGame.Symlink\nGame.DPIHandling = \nGame.ProtoInput.BlockedMessages = [0x0008];\nGame.Play = function () {\n  Context.RemoveLineInTextFile(path, \n};\n';
  const uri = URI.replace('Test', 'Features');
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'javascript', version: 1, text } });
  const doc = { uri };

  const hover = (await request('textDocument/hover', { textDocument: doc, position: { line: 3, character: 14 } })).result;
  assert.equal(hover.contents.kind, 'markdown');
  assert.match(hover.contents.value, /Game\.Hook\.ForceFocus: boolean/);

  const completion = (await request('textDocument/completion', { textDocument: doc, position: { line: 4, character: 12 } })).result;
  const sym = completion.items.find((i: any) => i.label === 'SymlinkGame');
  assert.equal(sym.textEdit.newText, 'SymlinkGame = ${1|true,false|};');
  assert.equal(sym.insertTextFormat, 2);
  assert.equal(sym.kind, 5);
  assert.deepEqual([sym.textEdit.range.start.character, sym.textEdit.range.end.character], [5, 12]);

  const values = (await request('textDocument/completion', { textDocument: doc, position: { line: 5, character: 19 } })).result;
  assert.deepEqual(values.items.map((i: any) => i.label), ['Nucleus.DPIHandling.True', 'Nucleus.DPIHandling.Scaled', 'Nucleus.DPIHandling.InvScaled']);
  assert.equal(values.items[0].preselect, true);

  const sig = (await request('textDocument/signatureHelp', { textDocument: doc, position: { line: 8, character: 37 } })).result;
  assert.ok(sig.signatures.length >= 2);
  assert.equal(sig.activeParameter, 1);
  assert.match(sig.signatures[0].label, /^Context\.RemoveLineInTextFile\(/);

  const hints = (await request('textDocument/inlayHint', { textDocument: doc, range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } } })).result;
  assert.deepEqual(hints.map((h: any) => h.label), ['WM_KILLFOCUS']);
  assert.deepEqual(hints[0].position, { line: 6, character: 41 });

  const symbols = (await request('textDocument/documentSymbol', { textDocument: doc })).result;
  // (This handler is half-typed, so it gets the line-by-line outline.)
  assert.ok(symbols.some((s: any) => s.name === 'Game.Hook.ForceFocus' && s.kind === 7 && s.detail === '= true'), 'the settings');
  assert.ok(symbols.some((s: any) => s.name === 'Game.Play' && s.kind === 12), 'the callbacks');
  assert.ok(symbols.every((s: any) => s.range && s.selectionRange));

  // A request on a file that isn't open, or garbage params, doesn't crash the server.
  assert.equal((await request('textDocument/hover', { textDocument: { uri: 'file:///nope.js' }, position: { line: 0, character: 0 } })).result, null);
  assert.ok((await request('textDocument/hover', {})).result === null);
  assert.equal((await request('nucleus/unknown', {})).error.code, -32601);
});

test('lsp: formatting, and refusing code that is not ES5', async () => {
  const uri = URI.replace('Test', 'Format');
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'javascript', version: 1, text: HEADER + 'Game.Play=function(){\nvar x=1;\n};\n' } });
  const edits = (await request('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } })).result;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].newText, HEADER + 'Game.Play = function () {\n  var x = 1;\n};\n');
  notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: HEADER + 'var s = "a\\\n' }] });
  const refused = (await request('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } })).result;
  assert.deepEqual(refused, []);
  const msg = await nextNotification((m) => m.method === 'window/showMessage');
  assert.match(msg.params.message, /^Nucleus: /);
});

test('lsp: Try it returns the simulation text', async () => {
  const uri = URI.replace('Test', 'TryIt');
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'javascript', version: 1, text: HEADER + 'Game.Play = function () { Context.StartArguments = "-w " + Context.Width; };\n' } });
  const r = (await request('workspace/executeCommand', { command: 'nucleus.tryIt', arguments: [{ uri, players: 2 }] })).result;
  assert.match(r, /Nucleus would set up all 2 players/);
  assert.match(r, /-w 960/);
  // handler code stays in the sandbox
  const escape = (await request('workspace/executeCommand', { command: 'nucleus.tryIt', arguments: [{ source: HEADER + 'Game.Play = function () { Context.StartArguments = typeof process + "/" + typeof require; };\n' }] })).result;
  assert.match(escape, /undefined\/undefined/);
});

test('lsp: only handlers get features', async () => {
  const uri = 'file:///tmp/nucleus-lsp-test/app.js';
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'javascript', version: 1, text: 'var x = { Hook: 1 };\nGame.Hook.ForceFocuss = 1;\n' } });
  assert.deepEqual((await diagnosticsFor(uri, undefined)).params.diagnostics, []);
  assert.equal((await request('textDocument/completion', { textDocument: { uri }, position: { line: 1, character: 5 } })).result, null);
  // a glob from the settings makes it one
  notify('workspace/didChangeConfiguration', { settings: { nucleus: { handlerGlobs: ['nucleus-lsp-test/*.js'] } } });
  assert.ok((await diagnosticsFor(uri, 1)).params.diagnostics.some((d: any) => d.code === 'unknown-member'));
  notify('workspace/didChangeConfiguration', { settings: { nucleus: { handlerGlobs: [] } } });
});

test('handler detection and globs (core)', () => {
  assert.equal(isHandlerFile('/x/handlers/Game.js', 'var x;'), true);
  assert.equal(isHandlerFile('/x/app.js', 'var x;'), false);
  assert.equal(isHandlerFile('/x/app.js', HEADER), true);
  assert.equal(isHandlerFile('/x/app.ts', HEADER), false);
  assert.equal(isHandlerFile('/x/app.js', 'var x;', 'always'), true);
  assert.equal(isHandlerFile('/x/handlers/Game.js', HEADER, 'off'), false);
  assert.equal(isHandlerFile('C:\\games\\mine\\a.js', 'var x;', 'auto', ['**/mine/*.js']), true);
  assert.ok(globToRegExp('handlers/*.js').test('/home/me/Nucleus/handlers/Game.js'));
  assert.ok(!globToRegExp('handlers/*.js').test('/home/me/Nucleus/handlers/sub/Game.js'));
  assert.ok(globToRegExp('**/*.js').test('a/b/c.js'));
});

test('snippets become plain text for clients without snippet support', () => {
  assert.equal(snippetToPlain('SymlinkGame = ${1|true,false|};'), 'SymlinkGame = true;');
  assert.equal(snippetToPlain('Width = ${1:0};'), 'Width = 0;');
  assert.equal(snippetToPlain('GetFolder($1)'), 'GetFolder()');
  assert.equal(snippetToPlain('function () {\n\t$0\n}'), 'function () {\n\t\n}');
});

test('lsp: package problems on the files in <Name>/, and the linked game folder (problems, fixes, suggestions)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-lsp-pkg-'));
  const js = path.join(dir, 'Pkg.js');
  fs.mkdirSync(path.join(dir, 'Pkg'));
  fs.writeFileSync(path.join(dir, 'Pkg', 'Config.json'), '{ bad');
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'Binaries', 'Win64'), { recursive: true });
  fs.writeFileSync(path.join(game, 'Binaries', 'Win64', 'Shooter-Win64-Shipping.exe'), 'x');
  fs.writeFileSync(path.join(game, 'readme.txt'), 'x');
  notify('workspace/didChangeConfiguration', { settings: { nucleus: { gameFolders: { 'Pkg.js': game } } } });
  const text = 'Game.GUID = "Pkg";\nGame.GameName = "Pkg";\nGame.ExecutableName = "Shooter-Win64-Shiping.exe";\nGame.FileSymlinkExclusions = [""];\n';
  const uri = pathToFileURL(js).href;
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'javascript', version: 1, text } });
  const own = (await diagnosticsFor(uri, 1)).params.diagnostics;
  const exe = own.find((d: any) => d.code === 'game-folder' && /executable/i.test(d.message));
  assert.ok(exe, JSON.stringify(own.map((d: any) => d.message)));
  assert.equal(exe.data.fix.text, 'Shooter-Win64-Shipping.exe');
  const fileDiags = (await diagnosticsFor(pathToFileURL(path.join(dir, 'Pkg', 'Config.json')).href)).params.diagnostics;
  assert.match(fileDiags[0].message, /Not valid JSON/);

  const actions = (await request('textDocument/codeAction', { textDocument: { uri }, range: exe.range, context: { diagnostics: [exe] } })).result;
  const fix = actions.find((a: any) => a.title === exe.data.fix.title);
  assert.equal(fix.edit.changes[uri][0].newText, 'Shooter-Win64-Shipping.exe');

  const list = (await request('textDocument/completion', { textDocument: { uri }, position: { line: 3, character: 32 } })).result;
  assert.ok(list.items.some((i: any) => i.label.includes('readme.txt')), JSON.stringify(list.items.map((i: any) => i.label)));
});
