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
});
