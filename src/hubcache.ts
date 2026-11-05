// A small on-disk cache in front of the Hub API, so these tools (people, CI and AI agents through the
// CLI, the MCP server and the extension) don't add load to hub.splitscreen.me:
// - the handler list comes from our daily index on GitHub (not the Hub's API), checked at most once an
//   hour with its ETag (an agent searching ten times costs one tiny request); the Hub is asked only
//   when the index is missing or stale, and an older copy is used when neither can be reached;
// - a package is downloaded once per handler version, then read from disk (a version never changes);
// - every request names the tool in its User-Agent, so the Hub's maintainers can see it and reach us.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchHandlers, packageUrl, HubHandler } from './core/hub';
import { readZip, ZipEntry } from './core/zip';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';
export const USER_AGENT = `nucleus-handler-tools/${VERSION} (+https://github.com/Snailedlt/splitscreenme-vscode)`;
export const LIST_TTL_MS = 60 * 60_000;

const politeFetch: typeof fetch = (input, init) => fetch(input, { ...init, headers: { 'user-agent': USER_AGENT, ...(init?.headers as Record<string, string> | undefined) } });

/** NUCLEUS_CACHE_DIR, else the platform's user cache folder. */
export function cacheDir(): string {
  if (process.env.NUCLEUS_CACHE_DIR) return process.env.NUCLEUS_CACHE_DIR;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'nucleus-tools', 'cache');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'nucleus-tools');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'nucleus-tools');
}

/** Our daily copy of the Hub's list (the testbench's hub-sync workflow), served by GitHub, so people's
 *  searches never reach the Hub's API. The Hub itself is only asked when the index is missing or stale. */
export const HUB_INDEX_URL = 'https://raw.githubusercontent.com/Snailedlt/nucleuscoop-handler-testbench/data/hub-index.json';
const STALE_MS = 3 * 24 * 60 * 60_000;

interface Cached { at: number; list: HubHandler[]; etag?: string; from?: 'index' | 'hub' }
let memory: Cached | undefined;

/** The Hub's handler list: from memory or disk while less than an hour old, then our index
 *  (revalidated with its ETag, so an unchanged index costs a 304), then the Hub as a last resort. */
export async function hubHandlers(dir = cacheDir(), now = Date.now(), fetchImpl: typeof fetch = politeFetch): Promise<HubHandler[]> {
  if (memory && now - memory.at < LIST_TTL_MS) return memory.list;
  const file = path.join(dir, 'hub-handlers.json');
  let stale: Cached | undefined;
  try {
    stale = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stale && now - stale.at < LIST_TTL_MS) return (memory = stale).list;
  } catch {}
  const keep = (c: Cached) => {
    memory = c;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(c));
    } catch {}
    return c.list;
  };
  try {
    const res = await fetchImpl(HUB_INDEX_URL, { headers: stale?.etag && stale.from === 'index' ? { 'if-none-match': stale.etag } : {} });
    if (res.status === 304 && stale) return keep({ ...stale, at: now });
    if (!res.ok) throw new Error(`index ${res.status}`);
    const idx = (await res.json()) as { syncedAt: string; handlers: HubHandler[] };
    if (!(now - Date.parse(idx.syncedAt) < STALE_MS) || !Array.isArray(idx.handlers)) throw new Error('index is stale');
    return keep({ at: now, list: idx.handlers, etag: res.headers.get('etag') ?? undefined, from: 'index' });
  } catch {}
  try {
    return keep({ at: now, list: await fetchHandlers(fetchImpl), from: 'hub' });
  } catch (e) {
    if (stale) return (memory = stale).list; // the Hub is down or rate limiting: an older list beats none
    throw e;
  }
}

/** A handler version's package, downloaded once and then read from disk. */
export async function hubPackage(h: HubHandler, dir = cacheDir(), fetchImpl: typeof fetch = politeFetch): Promise<ZipEntry[]> {
  const file = path.join(dir, 'packages', `${h._id.replace(/[^\w-]/g, '')}-v${Number(h.currentVersion)}.nc`);
  try {
    return readZip(fs.readFileSync(file));
  } catch {}
  const res = await fetchImpl(packageUrl(h));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const entries = readZip(buf); // only cache what reads as a package
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
  } catch {}
  return entries;
}

/** For tests. */
export const _resetMemory = () => (memory = undefined);
