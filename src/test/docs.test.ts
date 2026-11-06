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
  assert.match(md, /Written by Claude \(AI\), based on Nucleus/);
  assert.match(markdownReference(), /_✎ Written by Claude/);
  // Human docs carry no label.
  const human = Object.values(api.objects.Game.members).find((m) => m.doc && !m.docBy)!;
  assert.equal(claudeNote(human), '');
});
