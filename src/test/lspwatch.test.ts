// `ncdev lsp` file watching: handler files and handler folders only, and changes under node_modules or
// dot folders ignored (they used to flood the server: every file in the workspace was watched).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from './tmp';
import { watchersFor, skipName } from '../lsp';

const HEADER = 'Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\n';

test('lsp watch: the globs', () => {
  assert.deepEqual(watchersFor([], false), [{ globPattern: '**/*.js' }]);
  assert.deepEqual(watchersFor(['/w/handlers/Racer'], false)[1], { globPattern: '/w/handlers/Racer/**/*' });
  assert.deepEqual(watchersFor(['/w/handlers/Racer'], true)[1], { globPattern: { baseUri: 'file:///w/handlers/Racer', pattern: '**/*' } });
  assert.ok(skipName('node_modules') && skipName('.git') && !skipName('Racer'));
});

test('lsp watch: registers narrow watchers and ignores node_modules and dot folders', async (t) => {
  const root = tmpdir(t, 'nucleus-watch-');
  fs.mkdirSync(path.join(root, 'handlers', 'Racer'), { recursive: true });
  fs.writeFileSync(path.join(root, 'handlers', 'Racer.js'), HEADER + 'Game.KillMutex = "x";\n');
  for (const d of ['node_modules/pkg', '.git/x']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, d, 'Bad.js'), HEADER + 'Game.KillMutex = "x";\n');
  }
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'cli.js'), 'lsp', '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const msgs: any[] = [];
  let buf = Buffer.alloc(0);
  proc.stdout!.on('data', (c: Buffer) => {
    buf = Buffer.concat([buf, c]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const len = Number(buf.subarray(0, sep).toString().match(/Content-Length: (\d+)/i)![1]);
      if (buf.length < sep + 4 + len) return;
      msgs.push(JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString('utf8')));
      buf = buf.subarray(sep + 4 + len);
    }
  });
  const send = (m: unknown) => {
    const b = Buffer.from(JSON.stringify(m));
    proc.stdin!.write(`Content-Length: ${b.length}\r\n\r\n`);
    proc.stdin!.write(b);
  };
  const wait = async (f: () => boolean, ms = 5000) => {
    const t = Date.now();
    while (!f()) {
      if (Date.now() - t > ms) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: pathToFileURL(root).href, capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } } } });
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    const racer = pathToFileURL(path.join(root, 'handlers', 'Racer.js')).href;
    // The scan publishes the handler, then the watchers name its folder, not **/*.
    await wait(() => msgs.some((m) => m.method === 'client/registerCapability' && JSON.stringify(m.params).includes('Racer')));
    const regs = msgs.filter((m) => m.method === 'client/registerCapability').flatMap((m) => m.params.registrations);
    const globs = regs.at(-1).registerOptions.watchers.map((w: any) => w.globPattern);
    assert.ok(!globs.includes('**/*'), JSON.stringify(globs));
    assert.equal(globs[0], '**/*.js');
    assert.match(globs[1], /handlers\/Racer\/\*\*\/\*$/);
    assert.ok(msgs.some((m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === racer));
    assert.ok(!msgs.some((m) => m.method === 'textDocument/publishDiagnostics' && /node_modules|\.git/.test(m.params.uri)), 'the scan skips them');
    // Changes under node_modules and .git: nothing happens.
    const before = msgs.length;
    const changes = ['node_modules/pkg/Bad.js', '.git/x/Bad.js'].map((f) => ({ uri: pathToFileURL(path.join(root, f)).href, type: 2 }));
    send({ jsonrpc: '2.0', method: 'workspace/didChangeWatchedFiles', params: { changes } });
    // A change to the handler itself is still picked up.
    send({ jsonrpc: '2.0', method: 'workspace/didChangeWatchedFiles', params: { changes: [{ uri: racer, type: 2 }] } });
    await wait(() => msgs.slice(before).some((m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === racer));
    assert.ok(!msgs.slice(before).some((m) => m.method === 'textDocument/publishDiagnostics' && /node_modules|\.git/.test(m.params.uri)));
  } finally {
    proc.kill();
  }
});
