// A small on-disk cache in front of the Hub API, so these tools (people, CI and AI agents through the
// CLI, the MCP server and the extension) don't add load to hub.splitscreen.me:
// - the handler list is fetched at most once an hour (an agent searching ten times costs one fetch),
//   and an older copy is used when the Hub can't be reached;
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

let memory: { at: number; list: HubHandler[] } | undefined;

/** The Hub's handler list, from memory or disk when it is less than an hour old. */
export async function hubHandlers(dir = cacheDir(), now = Date.now(), fetchImpl: typeof fetch = politeFetch): Promise<HubHandler[]> {
  if (memory && now - memory.at < LIST_TTL_MS) return memory.list;
  const file = path.join(dir, 'hub-handlers.json');
  let stale: { at: number; list: HubHandler[] } | undefined;
  try {
    stale = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stale && now - stale.at < LIST_TTL_MS) return (memory = stale).list;
  } catch {}
  try {
    const list = await fetchHandlers(fetchImpl);
    memory = { at: now, list };
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(memory));
    } catch {}
    return list;
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
