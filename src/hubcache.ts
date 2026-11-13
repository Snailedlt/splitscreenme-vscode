// A small on-disk cache in front of the Hub API, so these tools (people, CI and AI agents through the
// CLI, the MCP server and the extension) don't add load to hub.splitscreen.me:
// - the handler list comes from our daily index on GitHub (not the Hub's API), checked at most once an
//   hour with its ETag (an agent searching ten times costs one tiny request); the Hub is asked only
//   when the index is missing or stale, and an older copy is used when neither can be reached;
// - a package is downloaded once per handler version, then read from disk (a version never changes);
// - every request says it comes from our devtools, which tool and which feature sent it (User-Agent and
//   X-Requested-With, core/hub.ts hubClientHeaders), so the Hub's maintainers can see it and reach us:
//   nothing about the person or their computer;
// - callers at the same time share one request (the list, and each package);
// - at most two package downloads at once;
// - every request has a time limit, and 429 / 5xx / network errors are retried at most twice, after
//   Retry-After (capped at 30 s) or 1 s, then 3 s;
// - when neither our index nor the Hub can be reached, the last list is used and nobody asks again for
//   five minutes (every process: it's written to the cache file), instead of on every search.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchHandlers, packageUrl, HubHandler, hubClientHeaders, slugId, type HubFeature, type HubTool } from './core/hub';
import { readZip, ZipEntry } from './core/zip';

declare const __VERSION__: string;
declare const __HUB_TOOL__: string; // per bundle (scripts/build.mjs): vscode-extension, ncdev-cli, claude-skill
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';

/** Which tool this process is (the headers' <tool>): NCDEV_CLIENT when a tool that runs ncdev says so (the
 *  Notepad++ plugin sets `notepadpp-plugin`), else what the server or bundle sets. */
let tool: HubTool = process.env.NCDEV_CLIENT ? slugId(process.env.NCDEV_CLIENT) : typeof __HUB_TOOL__ === 'string' ? __HUB_TOOL__ : 'ncdev-cli';
const toolFromEnv = !!process.env.NCDEV_CLIENT;
/** `ncdev lsp` (with the editor's name) and `ncdev mcp` say which they are; a tool that ran ncdev keeps its name. */
export function setHubTool(t: HubTool) {
  if (!toolFromEnv) tool = slugId(t);
}
export const hubTool = () => tool;
/** The headers for one request (core/hub.ts hubClientHeaders). */
export const headersFor = (feature: string) => hubClientHeaders(tool, feature, VERSION);
/** The User-Agent of a plain request from this tool. */
export const userAgent = (feature: string) => headersFor(feature)['user-agent'];
export const LIST_TTL_MS = 60 * 60_000;
/** After the list couldn't be fetched, how long the old one is used before trying again. */
export const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
export const LIST_TIMEOUT_MS = 20_000;
export const PACKAGE_TIMEOUT_MS = 120_000;
export const MAX_RETRIES = 2;
export const MAX_RETRY_WAIT_MS = 30_000;
export const MAX_DOWNLOADS = 2;

let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tests: wait without waiting, and see the waits. */
export const _setSleep = (f: (ms: number) => Promise<void>) => (sleep = f);

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
/** How long to wait before retry `attempt` (0-based): Retry-After when the server says, capped. */
export function retryDelay(attempt: number, retryAfter: string | null, now = Date.now()): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(ms)) return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, ms));
  }
  return Math.min(MAX_RETRY_WAIT_MS, 1000 * 3 ** attempt);
}

/** One polite request: our User-Agent, a time limit, and a few spaced-out retries on 429, 5xx and network errors. */
async function request(fetchImpl: typeof fetch, url: string, feature: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    let error: unknown;
    try {
      res = await fetchImpl(url, { headers: { ...headersFor(feature), ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      error = e;
    }
    if (res && !RETRY_STATUS.has(res.status)) return res;
    if (attempt >= MAX_RETRIES) {
      if (res) return res;
      throw error;
    }
    await sleep(retryDelay(attempt, res?.headers.get('retry-after') ?? null));
  }
}

/** At most `n` at once; the rest wait their turn. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(f: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await f();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const downloads = limiter(MAX_DOWNLOADS);

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

interface Cached { at: number; list: HubHandler[]; etag?: string; from?: 'index' | 'hub'; failedAt?: number }
let memory: Cached | undefined;
let listInFlight: Promise<HubHandler[]> | undefined;
const packagesInFlight = new Map<string, Promise<ZipEntry[]>>();
const fresh = (c: Cached, now: number) => now - c.at < LIST_TTL_MS || (c.failedAt !== undefined && now - c.failedAt < RETRY_AFTER_FAILURE_MS && now >= c.failedAt);

/** The Hub's handler list: from memory or disk while less than an hour old, then our index
 *  (revalidated with its ETag, so an unchanged index costs a 304), then the Hub as a last resort.
 *  Callers at the same time share one request. */
export interface HubRequestOptions {
  /** Where in the tool the request comes from (the headers' <feature>). Requests are cached and shared by URL
   *  only: a list request shared by two callers names the first. */
  feature?: HubFeature;
  dir?: string;
  now?: number;
  fetch?: typeof fetch;
}

export function hubHandlers(o: HubRequestOptions = {}): Promise<HubHandler[]> {
  const now = o.now ?? Date.now();
  if (memory && fresh(memory, now)) return Promise.resolve(memory.list);
  return (listInFlight ??= loadList(o.dir ?? cacheDir(), now, o.fetch ?? fetch, o.feature ?? 'hub-list').finally(() => (listInFlight = undefined)));
}

async function loadList(dir: string, now: number, fetchImpl: typeof fetch, feature: string): Promise<HubHandler[]> {
  const file = path.join(dir, 'hub-handlers.json');
  let stale: Cached | undefined;
  try {
    stale = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stale && fresh(stale, now)) return (memory = stale).list;
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
    const res = await request(fetchImpl, HUB_INDEX_URL, `${feature}/index`, LIST_TIMEOUT_MS, stale?.etag && stale.from === 'index' ? { 'if-none-match': stale.etag } : {});
    if (res.status === 304 && stale) return keep({ ...stale, at: now, failedAt: undefined });
    if (!res.ok) throw new Error(`index ${res.status}`);
    const idx = (await res.json()) as { syncedAt: string; handlers: HubHandler[] };
    if (!(now - Date.parse(idx.syncedAt) < STALE_MS) || !Array.isArray(idx.handlers)) throw new Error('index is stale');
    return keep({ at: now, list: idx.handlers, etag: res.headers.get('etag') ?? undefined, from: 'index' });
  } catch {}
  try {
    return keep({ at: now, list: await fetchHandlers(((url: string) => request(fetchImpl, String(url), `${feature}/index-fallback`, LIST_TIMEOUT_MS)) as unknown as typeof fetch), from: 'hub' });
  } catch (e) {
    // The Hub is down or rate limiting: an older list beats none, and nobody asks again for a while.
    if (stale) return keep({ ...stale, failedAt: now });
    throw new Error(`Can't reach the Hub's handler list (are you offline? hub.splitscreen.me and raw.githubusercontent.com both failed): ${(e as Error)?.message ?? e}. Try again in a few minutes.`);
  }
}

/** A handler version's package, downloaded once and then read from disk. Callers at the same time share one
 *  download; at most two download at once. */
export function hubPackage(h: HubHandler, o: HubRequestOptions = {}): Promise<ZipEntry[]> {
  const dir = o.dir ?? cacheDir();
  const fetchImpl = o.fetch ?? fetch;
  const file = path.join(dir, 'packages', `${h._id.replace(/[^\w-]/g, '')}-v${Number(h.currentVersion)}.nc`);
  try {
    return Promise.resolve(readZip(fs.readFileSync(file)));
  } catch {}
  let p = packagesInFlight.get(file);
  if (!p) {
    p = downloads(async () => {
      const res = await request(fetchImpl, packageUrl(h), o.feature ?? 'hub-fetch', PACKAGE_TIMEOUT_MS);
      if (!res.ok) throw new Error(`Download failed (${res.status}${res.status === 429 ? ': the Hub asks to slow down, try again in a minute' : res.status >= 500 ? ': the Hub has a problem, try again later' : ''})`);
      const buf = Buffer.from(await res.arrayBuffer());
      const entries = readZip(buf); // only cache what reads as a package
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
      } catch {}
      return entries;
    }).finally(() => packagesInFlight.delete(file));
    packagesInFlight.set(file, p);
  }
  return p;
}

/** For tests. */
export const _resetMemory = () => {
  memory = undefined;
  listInFlight = undefined;
  packagesInFlight.clear();
};
