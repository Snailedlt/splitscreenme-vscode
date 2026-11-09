// Which tag a release gets, checked before anything is built, with messages that say what to do.
//   node scripts/release-version.mjs [vX.Y.Z-beta.N]
// Empty: the next beta of package.json's version (v0.2.0-beta.1, then -beta.2, ...).
// Prints the tag; with GITHUB_OUTPUT set, also writes tag=... there.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * The release tag, or why there can't be one. `pkg`: package.json's version; `tags`: the tags on origin; `requested`:
 * the workflow's input; `pushed`: the tag the workflow ran for, if a tag was pushed; `changelog`: CHANGELOG.md.
 */
export function releaseTag({ pkg, tags, requested = '', pushed = '', changelog }) {
  const fail = (title, msg) => ({ error: { title, msg } });
  pushed = pushed.trim();
  let tag = pushed || requested.trim();
  if (!tag) {
    const n = Math.max(0, ...tags.map((t) => t.match(new RegExp(`^v${pkg.replace(/\./g, '\\.')}-beta\\.(\\d+)$`))?.[1]).filter(Boolean).map(Number));
    tag = `v${pkg}-beta.${n + 1}`;
  }
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(tag)) return fail('Bad version', `"${tag}" should look like v${pkg}-beta.1 (or leave the field empty for the next beta).`);
  const base = tag.slice(1).replace(/-.*$/, '');
  if (base !== pkg) return fail('Version mismatch', `${tag} is for ${base}, but package.json says ${pkg}. Bump package.json (and plugin/.claude-plugin/plugin.json) first, or use v${pkg}-beta.N.`);
  if (!pushed && tags.includes(tag)) return fail('Already released', `${tag} exists. Leave the version empty to get the next beta, or bump package.json for a new version.`);
  if (!new RegExp(`^## ${pkg.replace(/\./g, '\\.')}(\\s|$)`, 'm').test(changelog)) return fail('No release notes', `CHANGELOG.md has no "## ${pkg} (beta) · <date>" section. Rename "## Unreleased" to it first.`);
  return { tag };
}

function main() {
  const root = new URL('..', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8')).version;
  const tags = execSync('git ls-remote --tags --refs origin', { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.split('refs/tags/')[1])
    .filter(Boolean);
  const r = releaseTag({ pkg, tags, requested: process.argv[2] ?? '', pushed: process.env.PUSHED_TAG ?? '', changelog: fs.readFileSync(new URL('CHANGELOG.md', root), 'utf8') });
  if (r.error) {
    console.log(`::error title=${r.error.title}::${r.error.msg}`);
    console.error(`${r.error.title}: ${r.error.msg}`);
    process.exit(1);
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${r.tag}\n`);
  console.log(r.tag);
}

// Run as a script (not when a test imports it).
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main();
