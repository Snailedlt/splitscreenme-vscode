// The issue bots (scripts/issue-bots.mjs, run by .github/workflows/doc-review.yml and report-details.yml): they read
// text they don't own (the form's headings, the workbench's details block), so a renamed field would make them go quiet
// without an error. These tests use real issue bodies, rebuild bodies from the forms the way GitHub does, and check that
// the links filling the forms use fields that exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as bots from '../../scripts/issue-bots.mjs';
import { docReviewUrl } from '../core/api';

const root = path.resolve(__dirname, '..');
const TEMPLATES = path.join(root, '.github/ISSUE_TEMPLATE');

interface FormField { type: string; id?: string; label?: string; render?: string; options: string[] }
/** Just enough of the issue form YAML: each body entry's type, id, label, render and dropdown options. */
function readForm(file: string): FormField[] {
  const out: FormField[] = [];
  let cur: FormField | null = null;
  let inOptions = false;
  for (const line of fs.readFileSync(path.join(TEMPLATES, file), 'utf8').split('\n')) {
    const type = line.match(/^  - type: (\w+)/);
    if (type) { cur = { type: type[1], options: [] }; out.push(cur); inOptions = false; continue; }
    if (!cur) continue;
    const kv = line.match(/^\s+(id|label|render): (.+)$/);
    if (kv) { (cur as any)[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, ''); inOptions = false; continue; }
    if (/^\s+options:\s*$/.test(line)) { inOptions = true; continue; }
    const opt = inOptions && line.match(/^\s+- (.+)$/);
    if (opt) cur.options.push(opt[1].trim().replace(/^["']|["']$/g, ''));
    else if (inOptions && line.trim() && !/^\s+- /.test(line)) inOptions = false;
  }
  return out;
}

/** An issue body as GitHub writes it from a form: `### <label>`, a blank line, the answer (fenced when `render` is set). */
function body(file: string, answers: Record<string, string>): string {
  return readForm(file)
    .filter((f) => f.type !== 'markdown' && f.label)
    .map((f) => {
      const v = answers[f.id!];
      const text = !v ? '_No response_' : f.render ? `\`\`\`${f.render}\n${v}\n\`\`\`` : v;
      return `### ${f.label}\n\n${text}`;
    })
    .join('\n\n');
}

// A real details block, as the workbench filled it in (splitscreenme-vscode#7). The workbench's own test checks its
// checksum() gives the same value for these lines, so the two copies of the function can't drift apart.
const REAL_BLOCK = `Workbench: build 9589434, core 70b4a54
Page: https://snailedlt.github.io/nucleuscoop-handler-testbench/
Browser: Chrome 156 on Android, touch
Screen: 360x705 (pixel ratio 3)
Settings: look www, dark, layout rail, advanced, code view, check compact
Open handler: Untitled handler (own code, not included)
Tester: coding dev, Nucleus some
Doc: Context.Arch
Check: 49f16946`;

// splitscreenme-vscode#7, opened from the workbench's "Tell us what's wrong", exactly as GitHub stored it.
const ISSUE_7 = "### Which name\n\nContext.Arch\n\n### What's the problem\n\nIt's missing something important\n\n### What Nucleus really does\n\nTest\n\n### How you know\n\n_No response_\n\n### Details from the workbench\n\n```text\n" + REAL_BLOCK + '\n```';

test('bots: the checksum matches the workbench on a real block', () => {
  const lines = REAL_BLOCK.split('\n');
  assert.equal(bots.checksum(lines.slice(0, -1)), '49f16946');
  assert.equal(bots.checkDetails(REAL_BLOCK).status, 'ok');
});

test('bots: a real doc review issue (#7) gets both comments', () => {
  assert.equal(bots.docReviewMember(ISSUE_7), 'Context.Arch');
  const details = bots.detailsComment(ISSUE_7)!;
  assert.ok(details.startsWith(bots.DETAILS_MARKER));
  assert.match(details, /✅ As the workbench filled it in\./);
  assert.ok(details.includes('Doc: Context.Arch'));
  const doc = bots.docReviewComment('Context.Arch', { doc: 'Architecture of the game executable.', basis: 'Nucleus GenericContext.cs' }, 'abc1234');
  assert.ok(doc.startsWith(bots.DOC_MARKER));
  assert.match(doc, /\*\*The AI-written doc\*\* for `Context\.Arch`/);
  assert.match(doc, /\[GenericContext\.cs\]\(https:\/\/github\.com\/search\?q=/);
});

test('bots: CRLF bodies, edited and hand-typed blocks', () => {
  assert.equal(bots.docReviewMember(ISSUE_7.replace(/\n/g, '\r\n')), 'Context.Arch');
  const edited = ISSUE_7.replace('Chrome 156', 'Chrome 157');
  assert.match(bots.detailsComment(edited)!, /⚠️ Changed before sending/);
  const typed = ISSUE_7.replace('\nCheck: 49f16946', '');
  assert.match(bots.detailsComment(typed)!, /⚠️ No checksum/);
  const moved = ISSUE_7.replace('Check: 49f16946', 'Check: 49f16946\nExtra: line');
  assert.match(bots.detailsComment(moved)!, /⚠️ Changed before sending/);
  // Code fences in the block can't break out of the comment's fence.
  assert.ok(!bots.detailsComment(ISSUE_7.replace('Doc: Context.Arch', 'Doc: ```x'))!.slice(10).includes('```x'));
});

test('bots: a blank issue (or the GitHub app, which has no forms) is skipped', () => {
  assert.equal(bots.detailsComment('Test'), null);
  assert.equal(bots.docReviewMember('Test'), '');
  assert.equal(bots.detailsComment(ISSUE_7.replace(/```text[\s\S]*```/, '_No response_')), null);
  assert.match(bots.docReviewComment('', undefined, 'abc1234'), /couldn't find an AI-written doc for `\(no name given\)`/);
});

test('bots: every field a bot reads is in its form, and bodies built from the forms parse', () => {
  for (const [file, labels] of Object.entries(bots.BOT_FIELDS)) {
    const form = readForm(file);
    for (const label of labels) assert.ok(form.some((f) => f.label === label), `${file} has a field labelled "${label}" (a bot reads it)`);
    const ctx = form.find((f) => f.label === 'Details from the workbench')!;
    const answers: Record<string, string> = { [ctx.id!]: REAL_BLOCK };
    const member = form.find((f) => f.label === 'Which name');
    if (member) answers[member.id!] = '`Game.AddOption`';
    const b = body(file, answers);
    assert.match(bots.detailsComment(b)!, /✅/, `${file}: the details survive GitHub's layout`);
    if (member) assert.equal(bots.docReviewMember(b), 'Game.AddOption');
  }
});

test('bots: the doc review link opens the form and fills fields that exist', () => {
  const u = new URL(docReviewUrl('Context.Arch'));
  const template = u.searchParams.get('template')!;
  assert.ok(fs.existsSync(path.join(TEMPLATES, template)), `${template} exists`);
  const ids = new Set(readForm(template).map((f) => f.id).filter(Boolean));
  for (const key of u.searchParams.keys()) {
    if (['template', 'title', 'labels', 'assignees'].includes(key)) continue;
    assert.ok(ids.has(key), `${template} has a field with id "${key}" (the link fills it)`);
  }
  // The workbench adds its details to this link as ?context=… (withContext in playground/src/report.ts).
  assert.ok(ids.has('context'));
});

test('bots: the workflows use the tested module', () => {
  for (const [wf, fn] of [['doc-review.yml', 'runDocReview'], ['report-details.yml', 'runReportDetails']]) {
    const y = fs.readFileSync(path.join(root, '.github/workflows', wf), 'utf8');
    assert.ok(y.includes('scripts/issue-bots.mjs') && y.includes(`bots.${fn}(`), `${wf} calls ${fn} from scripts/issue-bots.mjs`);
    // The job only starts when the body has a heading a form writes.
    for (const h of y.matchAll(/'### ([^']+)'/g)) assert.ok(Object.values(bots.BOT_FIELDS).flat().includes(h[1]), `${wf}: "### ${h[1]}" is a field a form writes`);
  }
});
