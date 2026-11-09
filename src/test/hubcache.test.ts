import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hubHandlers, hubPackage, LIST_TTL_MS, HUB_INDEX_URL, RETRY_AFTER_FAILURE_MS, MAX_RETRY_WAIT_MS, MAX_DOWNLOADS, retryDelay, setHubTool, headersFor, _resetMemory, _setSleep } from '../hubcache';
import { hubClientHeaders } from '../core/hub';
import { writeZip } from '../core/zip';

const H = { _id: 'abc', title: 'T', gameName: 'G', ownerName: 'O', currentVersion: 3, currentPackage: 'p1' };
const ZIP = writeZip([{ name: 'handler.js', data: Buffer.from('Game.GameName = "T";') }]);
type Call = { url: string; ua?: string; xrw?: string; inm?: string };
function fakeFetch(opts: { index?: 'ok' | 'down' | 'stale' | 'busy'; hub?: 'ok' | 'down'; delay?: number } = {}) {
  const calls: Call[] = [];
  let active = 0;
  let maxActive = 0;
  const f = (async (url: string, init?: any) => {
    const h = init?.headers ?? {};
    calls.push({ url: String(url), ua: h['user-agent'], xrw: h['x-requested-with'], inm: h['if-none-match'] });
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (String(url) === HUB_INDEX_URL) {
        if (opts.index === 'down') return new Response('', { status: 503 });
        if (opts.index === 'busy') return new Response('', { status: 429, headers: { 'retry-after': '7' } });
        if (h['if-none-match'] === '"v1"') return new Response(null, { status: 304 });
        const syncedAt = new Date(opts.index === 'stale' ? Date.now() - 5 * 86400_000 : Date.now()).toISOString();
        return new Response(JSON.stringify({ syncedAt, handlers: [H, { ...H, _id: 'def', title: 'Halo', gameName: 'Halo' }] }), { headers: { etag: '"v1"' } });
      }
      if (String(url).endsWith('/allhandlers')) return opts.hub === 'down' ? new Response('', { status: 502 }) : new Response(JSON.stringify({ Handlers: [H] }));
      return new Response(ZIP);
    } finally {
      active--;
    }
  }) as unknown as typeof fetch;
  return { f, calls, maxActive: () => maxActive };
}
const isIndex = (c: Call) => c.url === HUB_INDEX_URL;
const isHub = (c: Call) => c.url.endsWith('/allhandlers');
const isPkg = (c: Call) => c.url.endsWith('.nc');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hubcache-'));
const waits: number[] = [];

beforeEach(() => {
  _resetMemory();
  waits.length = 0;
  _setSleep(async (ms) => void waits.push(ms));
  setHubTool('ncdev-cli');
});

test('hub cache: the list comes from our index, revalidated once an hour; packages once per version', async () => {
  const dir = tmp();
  const { f, calls } = fakeFetch();
  const t0 = Date.now();
  await hubHandlers({ dir, now: t0, fetch: f });
  await hubHandlers({ dir, now: t0 + 60_000, fetch: f });
  _resetMemory(); // a new process: read from disk
  await hubHandlers({ dir, now: t0 + 120_000, fetch: f });
  assert.equal(calls.filter(isIndex).length, 1);
  assert.equal(calls.filter(isHub).length, 0, 'the Hub API is not asked');
  _resetMemory();
  await hubHandlers({ dir, now: t0 + LIST_TTL_MS + 1, fetch: f });
  assert.equal(calls.filter(isIndex).length, 2, 'revalidated after an hour');
  assert.equal(calls.filter(isIndex)[1].inm, '"v1"', 'with its ETag (an unchanged index is a 304)');

  const a = await hubPackage(H as any, { dir, fetch: f });
  const b = await hubPackage(H as any, { dir, fetch: f });
  assert.equal(a[0].name, 'handler.js');
  assert.deepEqual(a, b);
  assert.equal(calls.filter(isPkg).length, 1, 'one download per version');
  await hubPackage({ ...H, currentVersion: 4 } as any, { dir, fetch: f });
  assert.equal(calls.filter(isPkg).length, 2, 'a new version is downloaded');

  // neither reachable: an older list is used
  _resetMemory();
  const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
  assert.equal((await hubHandlers({ dir, now: t0 + 10 * LIST_TTL_MS, fetch: down })).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub cache: a 304 keeps the list and renews it for an hour', async () => {
  const dir = tmp();
  const { f, calls } = fakeFetch();
  const t0 = Date.now();
  await hubHandlers({ dir, now: t0, fetch: f });
  _resetMemory();
  const t1 = t0 + LIST_TTL_MS + 1;
  assert.equal((await hubHandlers({ dir, now: t1, fetch: f })).length, 2);
  assert.equal(calls.at(-1)!.inm, '"v1"');
  _resetMemory();
  await hubHandlers({ dir, now: t1 + LIST_TTL_MS - 1000, fetch: f });
  assert.equal(calls.filter(isIndex).length, 2, 'the 304 counted as a fresh check');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub cache: the Hub API only when our index is missing or stale', async () => {
  for (const index of ['down', 'stale'] as const) {
    const dir = tmp();
    const { f, calls } = fakeFetch({ index });
    _resetMemory();
    assert.equal((await hubHandlers({ dir, now: Date.now(), fetch: f })).length, 1);
    assert.equal(calls.filter(isHub).length, 1, index);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hub cache: callers at the same time share one request', async () => {
  const dir = tmp();
  const { f, calls, maxActive } = fakeFetch({ delay: 20 });
  const lists = await Promise.all([1, 2, 3, 4, 5].map(() => hubHandlers({ dir, fetch: f })));
  assert.equal(calls.length, 1);
  assert.ok(lists.every((l) => l === lists[0]));
  const pkgs = await Promise.all([1, 2, 3].map(() => hubPackage(H as any, { dir, fetch: f })));
  assert.equal(calls.filter(isPkg).length, 1, 'one download for three callers');
  assert.deepEqual(pkgs[0], pkgs[2]);
  // Different packages: at most MAX_DOWNLOADS at once.
  const many = Array.from({ length: 6 }, (_, i) => ({ ...H, _id: `h${i}` }));
  const before = maxActive();
  await Promise.all(many.map((h) => hubPackage(h as any, { dir, fetch: f })));
  assert.equal(calls.filter(isPkg).length, 7);
  assert.ok(Math.max(before, maxActive()) <= MAX_DOWNLOADS, `at most ${MAX_DOWNLOADS} at once (saw ${maxActive()})`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub cache: 429 and 5xx are retried at most twice, spaced out and capped; Retry-After is honoured', async () => {
  assert.equal(retryDelay(0, null), 1000);
  assert.equal(retryDelay(1, null), 3000);
  assert.equal(retryDelay(9, null), MAX_RETRY_WAIT_MS);
  assert.equal(retryDelay(0, '7'), 7000);
  assert.equal(retryDelay(0, '3600'), MAX_RETRY_WAIT_MS);
  const dir = tmp();
  const { f, calls } = fakeFetch({ index: 'busy', hub: 'down' });
  await assert.rejects(hubHandlers({ dir, fetch: f }), /Can't reach the Hub's handler list .*offline/);
  assert.equal(calls.filter(isIndex).length, 3, 'the index: once and two retries');
  assert.equal(calls.filter(isHub).length, 3, 'the Hub: once and two retries');
  assert.deepEqual(waits, [7000, 7000, 1000, 3000]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub cache: when both are down, the old list is used and nobody asks again for a while', async () => {
  const dir = tmp();
  const t0 = Date.now();
  await hubHandlers({ dir, now: t0, fetch: fakeFetch().f });
  const { f, calls } = fakeFetch({ index: 'down', hub: 'down' });
  const t1 = t0 + 2 * LIST_TTL_MS;
  _resetMemory();
  assert.equal((await hubHandlers({ dir, now: t1, fetch: f })).length, 2);
  const n = calls.length;
  _resetMemory(); // another process (each ncdev run is one)
  await hubHandlers({ dir, now: t1 + 60_000, fetch: f });
  await hubHandlers({ dir, now: t1 + 120_000, fetch: f });
  assert.equal(calls.length, n, 'no requests while the failure is recent');
  _resetMemory();
  await hubHandlers({ dir, now: t1 + RETRY_AFTER_FAILURE_MS + 1, fetch: f });
  assert.ok(calls.length > n, 'tried again later');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub cache: searching filters the cached list without new requests', async () => {
  const dir = tmp();
  const { f, calls } = fakeFetch();
  const search = async (q: string) => (await hubHandlers({ dir, fetch: f, feature: 'hub-search' })).filter((h) => h.title.toLowerCase().includes(q));
  for (const q of ['h', 'ha', 'hal', 'halo', 't']) await search(q);
  assert.equal(calls.length, 1, 'one request for five searches');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub headers: our devtools, the tool and the feature, nothing personal', async () => {
  const h = hubClientHeaders('ncdev-cli', 'hub-search', '0.6.0');
  assert.equal(h['user-agent'], 'SplitScreenMe-DevTools/0.6.0 (ncdev-cli; hub-search; +https://github.com/Snailedlt/splitscreenme-vscode)');
  assert.equal(h['x-requested-with'], 'SplitScreenMe-DevTools/0.6.0 ncdev-cli hub-search');
  // A browser caller can't set User-Agent: only X-Requested-With (the one custom header the Hub's CORS allows).
  assert.deepEqual(Object.keys(hubClientHeaders('workbench', 'hub-browse', '1.0', { browser: true })), ['x-requested-with']);
  // Ids only: free text is cut down to an id.
  assert.equal(hubClientHeaders('ncdev-lsp/Neovim 0.10 (C:\\Users\\jo)', 'hub-list', '1')['x-requested-with'], 'SplitScreenMe-DevTools/1 ncdev-lsp/neovim-0.10-c-users-jo hub-list');
  for (const [tool, feature] of [
    ['vscode-extension', 'hub-browse'],
    ['ncdev-cli', 'hub-fetch'],
    ['ncdev-lsp/neovim', 'package-compare'],
    ['ncdev-mcp', 'hub-search'],
    ['notepadpp-plugin', 'hub-popular'],
    ['claude-skill', 'hub-list'],
  ]) {
    const all = JSON.stringify(hubClientHeaders(tool, feature, '0.6.0'));
    assert.match(all, new RegExp(`SplitScreenMe-DevTools/0\\.6\\.0 ${tool.replace('/', '\\/')} ${feature}`));
    for (const personal of [os.userInfo().username, os.hostname(), os.platform(), os.homedir()]) if (personal.length > 3) assert.ok(!all.includes(personal), `${personal} in ${all}`);
  }

  // hubcache sends them on every request, with where the list came from.
  const dir = tmp();
  setHubTool('ncdev-lsp/helix');
  const { f, calls } = fakeFetch({ index: 'down' });
  await hubHandlers({ dir, fetch: f, feature: 'package-compare' });
  await hubPackage(H as any, { dir, fetch: f, feature: 'package-compare' });
  assert.match(calls.find(isIndex)!.ua!, /^SplitScreenMe-DevTools\/\d+\.\d+\.\d+ \(ncdev-lsp\/helix; package-compare\/index; \+https:\/\/github\.com\/Snailedlt\/splitscreenme-vscode\)$/);
  assert.match(calls.find(isHub)!.xrw!, / ncdev-lsp\/helix package-compare\/index-fallback$/);
  assert.match(calls.find(isPkg)!.xrw!, / ncdev-lsp\/helix package-compare$/);
  assert.equal(headersFor('hub-fetch')['user-agent'].includes('ncdev-lsp/helix'), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
