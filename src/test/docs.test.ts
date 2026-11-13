import { test } from 'node:test';
import assert from 'node:assert/strict';
import raw from '../../data/claude-docs.json';
import { api, claudeNote, memberMarkdown } from '../core/api';
import { markdownReference } from '../core/lookup';

const docs = (raw as unknown as { docs: Record<string, { doc: string; basis: string; override?: boolean }> }).docs;
const OBJ: Record<string, string> = { Hub: 'Hub', 'Hub.Handler': 'HubHandler', 'Hub.Maintainer': 'HubMaintainer', Game: 'Game', 'Game.Hook': 'GameHook', 'Game.ProtoInput': 'GameProtoInput', Context: 'Context', Player: 'PlayerInfo', ProtoInput: 'ProtoInputRuntime', 'ProtoInput.Values': 'ProtoInputValues' };

test('Claude-written docs: each says what it is based on, and the tools label it', () => {
  for (const [key, d] of Object.entries(docs)) {
    assert.ok(d.doc.trim() && d.basis.trim(), `${key}: doc and basis`);
    assert.ok(!/—/.test(d.doc), `${key}: no em dashes`);
    const i = key.lastIndexOf('.');
    const obj = api.objects[OBJ[key.slice(0, i)]];
    assert.ok(obj, `${key}: known object`);
    const m = obj.members[key.slice(i + 1)];
    assert.ok(m, `${key}: a real member`);
    assert.equal(m.docBy, 'claude', `${key}: used and marked (a human doc exists? then drop it here)`);
    assert.equal(m.doc, d.doc);
  }
  const [owner, name] = ['Game', 'Play'];
  const md = memberMarkdown(owner, name, api.objects.Game.members.Play);
  assert.match(md, /AI-written, based on Nucleus/);
  assert.match(markdownReference(), /_✎ AI-written/);
  // Human docs carry no label.
  const human = Object.values(api.objects.Game.members).find((m) => m.doc && !m.docBy)!;
  assert.equal(claudeNote(human), '');
});

test('claude-param-docs.json: every entry is a real method, every parameter one of its own, all used', () => {
  const file = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'data', 'claude-param-docs.json'), 'utf8'));
  const owners: Record<string, string> = { Context: 'Context', Game: 'Game', ProtoInput: 'ProtoInputRuntime' };
  const model = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'data', 'nucleus-api.json'), 'utf8'));
  for (const [key, entry] of Object.entries<any>(file.params)) {
    const [owner, name] = key.split('.');
    const m = model.objects[owners[owner]]?.members[name];
    assert.equal(m?.kind, 'method', key);
    assert.ok(entry.basis, `${key}: basis`);
    const names = new Set(m.overloads.flatMap((o: any) => o.params.map((p: any) => p.name)));
    for (const p of Object.keys(entry.params)) assert.ok(names.has(p), `${key}(${p})`);
    for (const p of names) assert.ok(m.overloads.some((o: any) => o.params.some((x: any) => x.name === p && x.doc)), `${key}: ${String(p)} has its doc in the model (npm run generate)`);
  }
});
