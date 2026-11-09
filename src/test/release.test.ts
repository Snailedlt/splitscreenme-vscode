// The release scripts (scripts/release-version.mjs, release-notes.mjs, announce.mjs), run by the Release workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from './tmp';

const root = path.join(__dirname, '..');
// Loaded as the ES modules they are (not bundled), as the workflow runs them.
const load = (name: string): Promise<any> => import(pathToFileURL(path.join(root, 'scripts', name)).href);

const LOG = `# Changelog

<!-- how to write it -->

## Unreleased

### ✨ New

- **Unreleased thing.** Not out yet.

---

## 1.2.0 (beta) · 2026-01-02

### ✨ New

- **First.** Details.
- **Second.** Details.

### 🐛 Fixed

- **Third.** Details.
- **Fourth.** Details.
- **Fifth.** Details.
- **Sixth.** Details.

### 🙏 Thanks

- **[Ann](https://github.com/ann)** for testing.
- **Bob** for the report.

---

## 1.1.0 (beta) · 2026-01-01

- **Old.** Details.
`;

test('release-version: the next beta, and plain reasons to stop', async () => {
  const { releaseTag } = await load('release-version.mjs');
  const base = { pkg: '1.2.0', tags: ['v1.1.0-beta.1', 'v1.2.0-beta.1', 'v1.2.0-beta.3'], changelog: LOG };
  assert.deepEqual(releaseTag(base), { tag: 'v1.2.0-beta.4' }, 'the highest beta + 1');
  assert.deepEqual(releaseTag({ ...base, tags: [] }), { tag: 'v1.2.0-beta.1' });
  assert.deepEqual(releaseTag({ ...base, requested: ' v1.2.0 ' }), { tag: 'v1.2.0' });
  assert.equal(releaseTag({ ...base, requested: '1.2.0' }).error.title, 'Bad version');
  assert.equal(releaseTag({ ...base, requested: 'v1.3.0-beta.1' }).error.title, 'Version mismatch');
  assert.equal(releaseTag({ ...base, requested: 'v1.2.0-beta.3' }).error.title, 'Already released');
  assert.deepEqual(releaseTag({ ...base, pushed: 'v1.2.0-beta.3' }), { tag: 'v1.2.0-beta.3' }, 'the tag the workflow ran for');
  assert.equal(releaseTag({ ...base, pkg: '1.3.0', requested: 'v1.3.0-beta.1' }).error.title, 'No release notes');
  assert.match(releaseTag({ ...base, pkg: '1.3.0' }).error.msg, /Rename "## Unreleased"/);
});

test('release-notes: the section, the GitHub notes and the Discord posts', async () => {
  const { section, githubNotes, discordText, discordPayload } = await load('release-notes.mjs');
  const body = section(LOG, '1.2.0');
  assert.ok(body.startsWith('### ✨ New') && body.endsWith('for the report.'), 'without the heading and the --- line');
  assert.equal(section(LOG, '1.2'), undefined, 'a whole version only');
  assert.equal(section(LOG, '9.9.9'), undefined);
  assert.match(section(LOG, '1.1.0'), /^- \*\*Old\.\*\*/);
  const gh = githubNotes(body, 'v1.2.0-beta.2');
  assert.ok(gh.startsWith(body) && gh.includes('splitscreenme-vscode-v1.2.0-beta.2.vsix'));
  assert.equal(
    discordText(body, 'v1.2.0-beta.2'),
    '**v1.2.0 (beta) is out** 🛠️\n• First\n• Second\n• Third\n\n<https://github.com/Snailedlt/splitscreenme-vscode/releases/tag/v1.2.0-beta.2>\nThanks Ann, Bob 🙏',
  );
  const p = discordPayload(body, 'v1.2.0-beta.2', new Date('2026-01-02T00:00:00Z'));
  const e = p.embeds[0];
  assert.equal(e.title, '🧩 SplitScreen.Me for VS Code v1.2.0 (beta)');
  assert.match(e.description, /^• First\n• Second\n• Third\n• Fourth\n• Fifth\n…and 1 more in the release notes\n\n\[Release notes\]/);
  assert.deepEqual(e.fields, [{ name: 'Thanks', value: 'Ann, Bob 🙏' }]);
  assert.equal(e.timestamp, '2026-01-02T00:00:00.000Z');
  assert.equal(p.allowed_mentions, undefined, 'announce.mjs adds that');
  // The CLI: the real CHANGELOG.md has a section for package.json's version or none; --discord needs --tag.
  const run = (...a: string[]) => spawnSync(process.execPath, [path.join(root, 'scripts/release-notes.mjs'), ...a], { encoding: 'utf8' });
  assert.equal(run('--discord').status, 1);
  const missing = run('0.0.0-none');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no "## 0\.0\.0-none" section/);
});

test('announce: Discord webhooks only, never pings, and a failed post is only a warning', async (t) => {
  const { webhookUrls, isDiscordWebhook, buildPayload, announce } = await load('announce.mjs');
  const hook = 'https://discord.com/api/webhooks/123/abc-DEF_9';
  assert.deepEqual(webhookUrls(` ${hook}\n\nhttps://example.com/x \n`), [hook, 'https://example.com/x']);
  assert.ok(isDiscordWebhook(hook) && isDiscordWebhook('https://canary.discord.com/api/webhooks/1/x'));
  for (const bad of ['http://discord.com/api/webhooks/1/x', 'https://discord.com.evil.io/api/webhooks/1/x', 'https://example.com/api/webhooks/1/x']) assert.ok(!isDiscordWebhook(bad), bad);
  assert.deepEqual(buildPayload(' hi @everyone \n', false), { content: 'hi @everyone', allowed_mentions: { parse: [] } });
  assert.equal(buildPayload('x'.repeat(2500), false).content.length, 2000, "Discord's limit");
  assert.deepEqual(buildPayload('{"embeds":[],"allowed_mentions":{"parse":["everyone"]}}', true).allowed_mentions, { parse: [] });

  const calls: string[] = [];
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);
  const offline = async (url: string) => {
    calls.push(url);
    throw new Error('getaddrinfo ENOTFOUND discord.com');
  };
  assert.deepEqual(await announce(['https://example.com/x', hook], { content: 'x' }, { fetch: offline, log }), { posted: 0, failed: 2 });
  assert.deepEqual(calls, [hook], 'a non-Discord URL is never called');
  assert.match(logs[0], /^::warning::Webhook 1 doesn't look like a Discord webhook URL; skipped\.$/);
  assert.match(logs[1], /^::warning::Couldn't reach Discord for webhook 2: getaddrinfo ENOTFOUND/);
  const answers = [{ ok: true }, { ok: false, status: 429, text: async () => 'rate limited' }];
  logs.length = 0;
  assert.deepEqual(await announce([hook, hook], { content: 'x' }, { fetch: async () => answers.shift(), log }), { posted: 1, failed: 1 });
  assert.deepEqual(logs, ['Announced in channel 1 of 2.', '::warning::Discord answered 429 for webhook 2: rate limited']);

  // The CLI exits 0 whatever happens to the post (the release is already out).
  const dir = tmpdir(t, 'ncdev-announce-');
  const msg = path.join(dir, 'msg.txt');
  fs.writeFileSync(msg, 'hello');
  const run = (env: Record<string, string>) => spawnSync(process.execPath, [path.join(root, 'scripts/announce.mjs'), msg], { encoding: 'utf8', env: { ...process.env, DISCORD_WEBHOOKS: '', ANNOUNCE_ALLOW_ANY_URL: '', ...env } });
  let r = run({});
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing announced/);
  r = run({ DISCORD_WEBHOOKS: 'https://example.com/x' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skipped/);
  r = run({ DISCORD_WEBHOOKS: 'http://127.0.0.1:9/hook', ANNOUNCE_ALLOW_ANY_URL: '1' }); // nothing listens there: a network error
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /::warning::Couldn't reach Discord for webhook 1/);
});
