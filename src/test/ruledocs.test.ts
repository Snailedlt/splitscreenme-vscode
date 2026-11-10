// The page for each check (core/ruledocs.ts): every rule has one, and its examples are honest:
// the wrong one triggers the rule, the right one doesn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint, RULES } from '../core/lint';
import { RULE_DOCS, ruleUrl } from '../core/ruledocs';

const HEADER = 'Game.GUID = "My Game";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";\n';

test('ruledocs: every check has a page with a title, why and fix', () => {
  for (const id of Object.keys(RULES)) {
    const d = RULE_DOCS[id];
    assert.ok(d, `no page for ${id}`);
    assert.ok(d.title && d.why && d.fix, id);
    assert.ok((d.bad && d.good) || d.noExample, `${id}: examples, or why not`);
  }
  for (const id of Object.keys(RULE_DOCS)) assert.ok(id in RULES, `a page for a rule that doesn't exist: ${id}`);
  assert.equal(ruleUrl('es5-only'), 'https://snailedlt.github.io/nucleuscoop-handler-testbench/rules/es5-only/');
});

test('ruledocs: the wrong example triggers the rule, the right one does not', () => {
  const wrong: string[] = [];
  for (const [id, d] of Object.entries(RULE_DOCS)) {
    if (!d.bad || !d.good) continue;
    const src = (x: string) => (d.whole ? x : HEADER + x);
    const bad = lint(src(d.bad)).filter((p) => p.rule === id);
    const good = lint(src(d.good)).filter((p) => p.rule === id);
    if (!bad.length) wrong.push(`${id}: the wrong example doesn't trigger it`);
    if (good.length) wrong.push(`${id}: the right example triggers it (${good[0].message})`);
    // The right example is clean of errors too (it's what people copy).
    const errs = lint(src(d.good)).filter((p) => p.severity === 'error');
    if (errs.length) wrong.push(`${id}: the right example has errors: ${errs.map((e) => `${e.rule}: ${e.message}`).join('; ')}`);
  }
  assert.deepEqual(wrong, []);
});
