import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hubHandlers, hubPackage, LIST_TTL_MS, USER_AGENT, _resetMemory } from '../hubcache';
import { writeZip } from '../core/zip';

const H = { _id: 'abc', title: 'T', gameName: 'G', ownerName: 'O', currentVersion: 3, currentPackage: 'p1' };
function fakeFetch() {
  const calls: { url: string; ua?: string }[] = [];
  const f = (async (url: string, init?: any) => {
    calls.push({ url: String(url), ua: init?.headers?.['user-agent'] });
    if (String(url).endsWith('/allhandlers')) return new Response(JSON.stringify({ Handlers: [H] }));
    return new Response(writeZip([{ name: 'handler.js', data: Buffer.from('Game.GameName = "T";') }]));
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('hub cache: the list is fetched once an hour, packages once per version', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubcache-'));
  const { f, calls } = fakeFetch();
  _resetMemory();
  const t0 = 1_000_000;
  await hubHandlers(dir, t0, f);
  await hubHandlers(dir, t0 + 60_000, f);
  _resetMemory(); // a new process: read from disk
  await hubHandlers(dir, t0 + 120_000, f);
  assert.equal(calls.filter((c) => c.url.endsWith('/allhandlers')).length, 1);
  _resetMemory();
  await hubHandlers(dir, t0 + LIST_TTL_MS + 1, f);
  assert.equal(calls.filter((c) => c.url.endsWith('/allhandlers')).length, 2, 'refetched after an hour');

  const a = await hubPackage(H as any, dir, f);
  const b = await hubPackage(H as any, dir, f);
  assert.equal(a[0].name, 'handler.js');
  assert.deepEqual(a, b);
  assert.equal(calls.filter((c) => c.url.endsWith('.nc')).length, 1, 'one download per version');
  await hubPackage({ ...H, currentVersion: 4 } as any, dir, f);
  assert.equal(calls.filter((c) => c.url.endsWith('.nc')).length, 2, 'a new version is downloaded');

  // the Hub is down: an older list is used
  _resetMemory();
  const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
  assert.equal((await hubHandlers(dir, t0 + 10 * LIST_TTL_MS, down)).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub cache: requests name the tool', () => {
  assert.match(USER_AGENT, /^nucleus-handler-tools\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\//);
});
