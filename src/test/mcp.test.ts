import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { handle, TOOLS } from '../mcp';

const call = async (name: string, args: unknown) => (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as any;
const HEADER = 'Game.GameName = "Test";\nGame.ExecutableName = "test.exe";\nGame.GUID = "Test";\nGame.MaxPlayers = 4;\n';

test('mcp: initialize, tools and prompts', async () => {
  const init = (await handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } })) as any;
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined, 'notifications get no reply');
  const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as any;
  assert.deepEqual(list.result.tools.map((t: any) => t.name), TOOLS.map((t) => t.name));
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object', t.name);
  const p = (await handle({ jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'nucleus-handler' } })) as any;
  assert.match(p.result.messages[0].content.text, /ES5/);
  assert.equal(((await handle({ jsonrpc: '2.0', id: 4, method: 'nope' })) as any).error.code, -32601);
});

test('mcp: lint, fix, api', async () => {
  const lint = await call('nucleus_lint', { source: HEADER + 'Game.KillMutx = ["a"];\nGame.Play = function () { var f = () => 1; };\n' });
  assert.equal(lint.result.isError, false);
  const r = lint.result.structuredContent.result;
  assert.ok(r.errors >= 1);
  assert.ok(r.diagnostics.some((d: any) => d.rule === 'unknown-member' && d.line === 5));
  const fix = await call('nucleus_fix', { source: HEADER + 'Game.KillMutx = ["a"];\n' });
  assert.match(fix.result.structuredContent.result.source, /Game\.KillMutex = \["a"\];/);
  const api = await call('nucleus_api', { query: 'Nucleus.DPIHandling' });
  assert.match(api.result.content[0].text, /Nucleus\.DPIHandling\.True = 0/);
  const none = await call('nucleus_api', { query: 'Game.KillMutx' });
  assert.match(none.result.content[0].text, /Did you mean/);
  const missing = await call('nucleus_lint', {});
  assert.equal(missing.result.isError, true);
});

test('mcp: simulate runs isolated', async () => {
  const sim = await call('nucleus_simulate', { source: HEADER + 'Game.Play = function () { Context.StartArguments = "-w " + Context.Width; };\n', players: 2 });
  assert.equal(sim.result.structuredContent.result.players[1].startArguments, '-w 960');
  const escape = await call('nucleus_simulate', { source: HEADER + 'Game.Play = function () { Context.StartArguments = typeof process + " " + typeof require; };\n', players: 1 });
  assert.equal(escape.result.structuredContent.result.players[0].startArguments, 'undefined undefined');
});

test('mcp: simulate keeps to its limits; initialize answers a version it speaks', async () => {
  for (const [players, want] of [[0, 1], [5000, 16], [-3, 1]] as const) {
    const r = await call('nucleus_simulate', { source: HEADER, players });
    assert.equal(r.result.structuredContent.result.playerCount, want, `players ${players}`);
  }
  const init = async (v: string) => ((await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v } })) as any).result.protocolVersion;
  assert.equal(await init('2025-03-26'), '2025-03-26');
  assert.equal(await init('1999-01-01'), '2025-06-18');
});

test('mcp: over stdio', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js');
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nucleus_rules', arguments: {} } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const r = spawnSync(process.execPath, [cli, 'mcp'], { input, encoding: 'utf8', timeout: 20000 });
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2, r.stderr);
  assert.equal(lines[0].result.serverInfo.name, 'nucleus');
  assert.match(lines[1].result.content[0].text, /unknown-member/);
});

test('mcp: explain, debug, a check explained, docs links, the hard rules', async () => {
  const call = async (name: string, args: Record<string, unknown>) => ((await handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })) as any).result;
  const src = 'Game.GUID = "X";\nGame.GameName = "X";\nGame.ExecutableName = "x.exe";\nGame.Play = function () {\n  var w = Context.Width;\n  Context.StartArguments = "-w " + w;\n};\nGame.KillMutex = "m";\n';
  const lint = await call('nucleus_lint', { source: src });
  assert.match(lint.structuredContent.result.diagnostics[0].docs, /\/rules\/type-mismatch\/\?ref=mcp$/);
  const ex = await call('nucleus_explain', { source: src, line: 5 });
  assert.match(ex.content[0].text, /Context\.Width/);
  assert.ok((await call('nucleus_explain', { source: src, line: 99 })).isError);
  const rule = await call('nucleus_rules', { rule: 'type-mismatch' });
  assert.match(rule.content[0].text, /Fix: [\s\S]*Wrong:[\s\S]*rules\/type-mismatch\//);
  assert.ok((await call('nucleus_rules', { rule: 'nope' })).isError);
  const ok = src.replace('Game.KillMutex = "m";', 'Game.KillMutex = ["m"];');
  const dbg = await call('nucleus_debug', { source: ok, breakpoints: ['6 if Context.PlayerID == 1'], watches: ['w'] });
  assert.match(dbg.content[0].text, /line 6/i);
  assert.match(dbg.content[0].text, /w = 1920|w = 960/);
  const init = ((await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as any).result;
  assert.match(init.instructions, /ES5 JavaScript only[\s\S]*Hub\.\* lines/);
});
