import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hubHandlers, hubPackage, LIST_TTL_MS, USER_AGENT, HUB_INDEX_URL, _resetMemory } from '../hubcache';
import { writeZip } from '../core/zip';

const H = { _id: 'abc', title: 'T', gameName: 'G', ownerName: 'O', currentVersion: 3, currentPackage: 'p1' };
function fakeFetch(opts: { index?: 'ok' | 'down' | 'stale' } = {}) {
  const calls: { url: string; ua?: string; inm?: string }[] = [];
  const f = (async (url: string, init?: any) => {
    calls.push({ url: String(url), ua: init?.headers?.['user-agent'], inm: init?.headers?.['if-none-match'] });
    if (String(url) === HUB_INDEX_URL) {
      if (opts.index === 'down') return new Response('', { status: 503 });
      if (init?.headers?.['if-none-match'] === '"v1"') return new Response(null, { status: 304 });
      const syncedAt = new Date(opts.index === 'stale' ? Date.now() - 5 * 86400_000 : Date.now()).toISOString();
      return new Response(JSON.stringify({ syncedAt, handlers: [H] }), { headers: { etag: '"v1"' } });
    }
    if (String(url).endsWith('/allhandlers')) return new Response(JSON.stringify({ Handlers: [H] }));
    return new Response(writeZip([{ name: 'handler.js', data: Buffer.from('Game.GameName = "T";') }]));
  }) as unknown as typeof fetch;
  return { f, calls };
}
const isIndex = (c: { url: string }) => c.url === HUB_INDEX_URL;
const isHub = (c: { url: string }) => c.url.endsWith('/allhandlers');

test('hub cache: the list comes from our index, revalidated once an hour; packages once per version', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubcache-'));
  const { f, calls } = fakeFetch();
  _resetMemory();
  const t0 = Date.now();
  await hubHandlers(dir, t0, f);
  await hubHandlers(dir, t0 + 60_000, f);
  _resetMemory(); // a new process: read from disk
  await hubHandlers(dir, t0 + 120_000, f);
  assert.equal(calls.filter(isIndex).length, 1);
  assert.equal(calls.filter(isHub).length, 0, 'the Hub API is not asked');
  _resetMemory();
  await hubHandlers(dir, t0 + LIST_TTL_MS + 1, f);
  assert.equal(calls.filter(isIndex).length, 2, 'revalidated after an hour');
  assert.equal(calls.filter(isIndex)[1].inm, '"v1"', 'with its ETag (an unchanged index is a 304)');

  const a = await hubPackage(H as any, dir, f);
  const b = await hubPackage(H as any, dir, f);
  assert.equal(a[0].name, 'handler.js');
  assert.deepEqual(a, b);
  assert.equal(calls.filter((c) => c.url.endsWith('.nc')).length, 1, 'one download per version');
  await hubPackage({ ...H, currentVersion: 4 } as any, dir, f);
  assert.equal(calls.filter((c) => c.url.endsWith('.nc')).length, 2, 'a new version is downloaded');

  // neither reachable: an older list is used
  _resetMemory();
  const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
  assert.equal((await hubHandlers(dir, t0 + 10 * LIST_TTL_MS, down)).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub cache: the Hub API only when our index is missing or stale', async () => {
  for (const index of ['down', 'stale'] as const) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubcache-'));
    const { f, calls } = fakeFetch({ index });
    _resetMemory();
    assert.equal((await hubHandlers(dir, Date.now(), f)).length, 1);
    assert.equal(calls.filter(isHub).length, 1, index);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hub cache: requests name the tool', () => {
  assert.match(USER_AGENT, /^nucleus-handler-tools\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\//);
});
