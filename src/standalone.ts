// The standalone ncdev (#18: Node's single executable, scripts/sea.mjs): what's inside it, where it lives, and
// `ncdev update`, which replaces it with the newest release (checked against the release's SHA256SUMS.txt).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { cacheDir } from './hubcache';

declare const __VERSION__: string;
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';
export const TOOL = 'ncdev';
const REPO = 'Snailedlt/splitscreenme-vscode';

/** Running as the standalone ncdev (not `node cli.js`). */
export function isStandalone(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}
/** A file built into the standalone ncdev (the Notepad++ plugin, the skill). */
export function builtIn(name: string): Buffer | undefined {
  if (!isStandalone()) return undefined;
  try {
    return Buffer.from(require('node:sea').getRawAsset(name) as ArrayBuffer);
  } catch {
    return undefined;
  }
}

/** The release asset for this platform. */
export function assetName(platform = process.platform, arch = process.arch): string | undefined {
  if (platform === 'win32') return arch === 'arm64' ? 'ncdev-arm64.exe' : 'ncdev.exe';
  if (platform === 'linux' && arch === 'x64') return 'ncdev-linux-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'ncdev-macos-arm64';
  return undefined;
}

/** Where ncdev keeps itself so editors find it at one place: %LOCALAPPDATA%\ncdev\ncdev.exe (~/.local/bin elsewhere). */
export function installPath(): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), TOOL, `${TOOL}.exe`);
  return path.join(os.homedir(), '.local', 'bin', TOOL);
}

/** Copies the running ncdev to installPath() (unless it runs from there) and returns that path. */
export function installSelf(): string {
  const dest = installPath();
  const self = process.execPath;
  if (path.resolve(self).toLowerCase() === path.resolve(dest).toLowerCase()) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.new`;
  fs.copyFileSync(self, tmp);
  fs.chmodSync(tmp, 0o755);
  swapIn(tmp, dest);
  return dest;
}

/** Puts `tmp` in place of `dest`, which may be running (Windows lets a running exe be renamed, not overwritten). */
function swapIn(tmp: string, dest: string) {
  const old = `${dest}.old`;
  try {
    fs.rmSync(old, { force: true });
  } catch {
    /* an older one still running */
  }
  if (fs.existsSync(dest)) {
    try {
      fs.renameSync(dest, old);
    } catch {
      fs.rmSync(dest, { force: true });
    }
  }
  fs.renameSync(tmp, dest);
}

/** "0.6.0" from "v0.6.0" (or an old tag like "v0.5.0-beta.1"); compares x.y.z only. */
export function versionOf(tag: string): string {
  return /(\d+\.\d+\.\d+)/.exec(tag)?.[1] ?? '0.0.0';
}
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export interface Latest {
  tag: string;
  version: string;
  url: string;
  assets: Record<string, string>;
}
interface UpdateCache {
  checkedAt: number;
  etag?: string;
  latest?: Latest;
}

/** The newest release with ncdev in it, old pre-release tags (v0.x.y-beta.N) included. At most once a day unless `force`.
 *  null: GitHub answered but no release has ncdev yet; undefined: GitHub couldn't be reached (and nothing is known). */
export async function latestRelease(force = false, fetchImpl: typeof fetch = fetch, dir = cacheDir(), now = Date.now()): Promise<Latest | null | undefined> {
  const file = path.join(dir, 'update.json');
  let cache: UpdateCache = { checkedAt: 0 };
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* first time */
  }
  if (!force && cache.latest && now - cache.checkedAt < 24 * 3600 * 1000) return cache.latest;
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `${TOOL}/${VERSION}`, ...(cache.etag && cache.latest ? { 'if-none-match': cache.etag } : {}) },
  }).catch(() => undefined);
  if (res?.status === 304 && cache.latest) {
    cache.checkedAt = now;
  } else if (res?.ok) {
    const releases = (await res.json()) as { tag_name: string; draft: boolean; html_url: string; assets: { name: string; browser_download_url: string }[] }[];
    const r = releases.find((x) => !x.draft && x.assets.some((a) => a.name === 'SHA256SUMS.txt'));
    cache = {
      checkedAt: now,
      etag: res.headers.get('etag') ?? undefined,
      latest: r ? { tag: r.tag_name, version: versionOf(r.tag_name), url: r.html_url, assets: Object.fromEntries(r.assets.map((a) => [a.name, a.browser_download_url])) } : undefined,
    };
  } else return cache.latest; // offline or rate limited: what we knew
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache));
  } catch {
    /* read-only cache: check again next time */
  }
  return cache.latest ?? null;
}

/** Downloads this platform's ncdev from `latest`, checks its SHA-256 and puts it in place of `target`. */
export async function installRelease(latest: Latest, target: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const name = assetName();
  if (!name || !latest.assets[name]) throw new Error(`${latest.tag} has no ${name ?? 'build'} for this computer (${process.platform} ${process.arch}).`);
  const sums = await fetchImpl(latest.assets['SHA256SUMS.txt']);
  if (!sums.ok) throw new Error(`Couldn't read ${latest.tag}'s SHA256SUMS.txt (${sums.status}).`);
  const want = new RegExp(`^([0-9a-f]{64})\\s+\\*?${name.replace(/\./g, '\\.')}$`, 'm').exec(await sums.text())?.[1];
  if (!want) throw new Error(`${latest.tag}'s SHA256SUMS.txt doesn't list ${name}.`);
  const res = await fetchImpl(latest.assets[name]);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (crypto.createHash('sha256').update(data).digest('hex') !== want) throw new Error('The download doesn\'t match its SHA-256; nothing was changed.');
  const tmp = `${target}.new`;
  fs.writeFileSync(tmp, data);
  fs.chmodSync(tmp, 0o755);
  swapIn(tmp, target);
}
