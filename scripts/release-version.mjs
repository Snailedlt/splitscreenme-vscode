// Which tag a release gets, checked before anything is built, with messages that say what to do.
//   node scripts/release-version.mjs [vX.Y.Z-beta.N]
// Empty: the next beta of package.json's version (v0.2.0-beta.1, then -beta.2, ...).
// Prints the tag; with GITHUB_OUTPUT set, also writes tag=... there.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8')).version;
const fail = (title, msg) => {
  console.log(`::error title=${title}::${msg}`);
  console.error(`${title}: ${msg}`);
  process.exit(1);
};
const tags = execSync('git ls-remote --tags --refs origin', { encoding: 'utf8' })
  .split('\n')
  .map((l) => l.split('refs/tags/')[1])
  .filter(Boolean);

const pushed = (process.env.PUSHED_TAG ?? '').trim(); // the workflow ran for a tag that was pushed
let tag = pushed || (process.argv[2] ?? '').trim();
if (!tag) {
  const n = Math.max(0, ...tags.map((t) => t.match(new RegExp(`^v${pkg.replace(/\./g, '\\.')}-beta\\.(\\d+)$`))?.[1]).filter(Boolean).map(Number));
  tag = `v${pkg}-beta.${n + 1}`;
}
if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(tag)) fail('Bad version', `"${tag}" should look like v${pkg}-beta.1 (or leave the field empty for the next beta).`);
const base = tag.slice(1).replace(/-.*$/, '');
if (base !== pkg) fail('Version mismatch', `${tag} is for ${base}, but package.json says ${pkg}. Bump package.json (and plugin/.claude-plugin/plugin.json) first, or use v${pkg}-beta.N.`);
if (!pushed && tags.includes(tag)) fail('Already released', `${tag} exists. Leave the version empty to get the next beta, or bump package.json for a new version.`);
const log = fs.readFileSync(new URL('CHANGELOG.md', root), 'utf8');
if (!new RegExp(`^## ${pkg.replace(/\./g, '\\.')}(\\s|$)`, 'm').test(log)) fail('No release notes', `CHANGELOG.md has no "## ${pkg} (beta) · <date>" section. Rename "## Unreleased" to it first.`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
console.log(tag);
