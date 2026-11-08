// The debug adapter (src/dap.ts): VS Code's Run and Debug over core/debug.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HandlerDebugSession } from '../dap';

const HANDLER = [
  'Game.GameName = "Demo";',
  'Game.ExecutableName = "demo.exe";',
  'Game.GUID = "Demo";',
  'Game.MaxPlayers = 4;',
  'Game.Play = function () {',
  '  var args = "-w " + Context.Width;',
  '  Context.StartArguments = args + " -id " + Context.PlayerID;',
  '};',
  '',
].join('\n');

function session() {
  const out: any[] = [];
  const s = new HandlerDebugSession((m) => out.push(m));
  let seq = 1;
  const req = (command: string, args: unknown = {}) => {
    const n = out.length;
    s.handle({ seq: seq++, type: 'request', command, arguments: args });
    const got = out.slice(n);
    return { res: got.find((m) => m.type === 'response'), events: got.filter((m) => m.type === 'event') };
  };
  return { req };
}

test('dap: breakpoint, stack, scopes, variables, evaluate, stepping back and on to the end', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-dap-')), 'Demo.js');
  fs.writeFileSync(file, HANDLER);
  const { req } = session();
  const init = req('initialize', { adapterID: 'nucleus' });
  assert.equal(init.res.body.supportsStepBack, true);
  assert.ok(init.events.some((e) => e.event === 'initialized'));
  assert.equal(req('launch', { program: file, players: 2 }).res.success, true);
  req('setBreakpoints', { source: { path: file }, breakpoints: [{ line: 7, condition: 'Context.PlayerID == 1' }] });
  req('setExceptionBreakpoints', { filters: ['errors'] });
  const stopped = req('configurationDone').events.find((e) => e.event === 'stopped');
  assert.equal(stopped.body.reason, 'breakpoint');
  assert.match(stopped.body.description, /line 7 for player 2 of 2, in Game\.Play/);

  const frames = req('stackTrace', { threadId: 1 }).res.body.stackFrames;
  assert.equal(frames[0].line, 7);
  assert.match(frames[0].name, /player 2 of 2/);
  const scopes = req('scopes', { frameId: 0 }).res.body.scopes;
  const names = scopes.map((s: any) => s.name);
  assert.ok(names.includes('Variables') && names.includes('Context'), names.join(', '));
  const vars = req('variables', { variablesReference: scopes.find((s: any) => s.name === 'Variables').variablesReference }).res.body.variables;
  assert.equal(vars.find((v: any) => v.name === 'args').value, '"-w 960"');
  assert.equal(req('evaluate', { expression: 'Context.PlayerID', context: 'hover' }).res.body.result, '1');

  const back = req('stepBack', { threadId: 1 }).events.find((e) => e.event === 'stopped');
  assert.equal(back.body.reason, 'step');
  assert.equal(req('stackTrace', { threadId: 1 }).res.body.stackFrames[0].line, 6);
  const end = req('continue', { threadId: 1 });
  assert.ok(end.events.some((e) => e.event === 'stopped' && e.body.reason === 'breakpoint') || end.events.some((e) => e.event === 'terminated'));
  const done = req('continue', { threadId: 1 });
  assert.ok(done.events.some((e) => e.event === 'terminated'));
});

test('dap: an error stops where it ends the run; unsaved text is debugged as it is', () => {
  const { req } = session();
  req('initialize');
  const src = HANDLER.replace('var args', 'var x = null; x.y; var args');
  req('launch', { program: path.join(os.tmpdir(), 'Unsaved.js'), source: src });
  req('setExceptionBreakpoints', { filters: ['errors'] });
  const stopped = req('configurationDone').events.find((e) => e.event === 'stopped');
  assert.equal(stopped.body.reason, 'exception');
  assert.equal(req('launch', {}).res.success, false, 'no program, a clear error');
});
