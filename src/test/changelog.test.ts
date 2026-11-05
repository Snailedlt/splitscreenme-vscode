import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Release notes come from CHANGELOG.md (scripts/release-notes.mjs, used by the release workflow).
test('CHANGELOG.md has notes for the next release, each starting with a short bold summary', () => {
  const root = path.join(__dirname, '..');
  const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const heads = [...log.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.ok(heads[0] === 'Unreleased' || heads[0].startsWith(version), `the first section should be "Unreleased" or "${version}", not "${heads[0]}"`);
  const first = log.split(/^## .+$/m)[1];
  for (const line of first.split('\n').filter((l) => l.startsWith('- '))) assert.match(line, /^- \*\*.+?\*\*/, `start with a **short summary**: ${line.slice(0, 80)}`);
  // Groups people (and agents) can scan: the emoji headings listed at the top of the file.
  for (const h of first.split('\n').filter((l) => l.startsWith('### '))) assert.ok(['### ✨ New', '### 🛠️ Improved', '### 🐛 Fixed', '### ⚡ Faster', '### ⚠️ Changed', '### 🙏 Thanks'].includes(h.trim()), h);
  // Thanks lines name the person in bold (a GitHub profile link when it came through GitHub).
  for (const sec of log.split(/^### 🙏.*$/m).slice(1)) for (const l of sec.split(/^##/m)[0].split('\n').filter((x) => x.startsWith('- '))) assert.match(l, /^- \*\*(\[[^\]]+\]\(https:\/\/github\.com\/[\w-]+\)|[^*\[]+)\*\* for /, l);
  // Releases are separated by a --- line, so one doesn't run into the next.
  for (const m of log.matchAll(/\n(.*)\n\n## \d/g)) assert.equal(m[1], '---', 'a --- line before each release');
  // Released sections carry their date.
  for (const h of heads.slice(1)) assert.match(h, /^\d+\.\d+\.\d+ \(beta\) · \d{4}-\d{2}-\d{2}$/, h);
});
