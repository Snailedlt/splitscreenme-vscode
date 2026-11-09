// The Hub's published version of a handler (by its Hub.Handler.Id line), for the guid-changed check.
// Goes through hubcache: the list from our daily index, each package once per version, so this adds
// no Hub API load beyond what the Hub commands already use.
import { hubHandlers, hubPackage } from './hubcache';
import type { LintOptions } from './core/lint';

type Published = NonNullable<LintOptions['published']>;
const memory = new Map<string, Promise<Published | undefined>>();

export const hubIdOf = (text: string): string | undefined => text.match(/^\s*Hub\.Handler\.Id\s*=\s*"([A-Za-z0-9]+)"/m)?.[1];

export function guidOf(source: string): string | undefined {
  const m = source.match(/^\s*Game\.GUID\s*=\s*("(?:[^"\\\r\n]|\\.)*")/m);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

/** The published GUID for this handler, or undefined (no Hub id, offline, not on the Hub). */
export function publishedFor(text: string): Promise<Published | undefined> {
  const id = hubIdOf(text);
  if (!id) return Promise.resolve(undefined);
  let p = memory.get(id);
  if (!p) {
    p = (async () => {
      try {
        const h = (await hubHandlers({ feature: 'package-compare' })).find((x) => x._id === id);
        if (!h) return undefined;
        const entry = (await hubPackage(h, { feature: 'package-compare' })).find((e) => /^handler\.js$/i.test(e.name));
        const guid = entry?.data ? guidOf(new TextDecoder().decode(entry.data)) : undefined;
        return guid ? { version: h.currentVersion, guid } : undefined;
      } catch {
        memory.delete(id); // try again next time
        return undefined;
      }
    })();
    memory.set(id, p);
  }
  return p;
}

/** Already known (resolved) without waiting, for a synchronous lint. */
const settled = new Map<string, Published | undefined>();
export function publishedNow(text: string, onReady: () => void): Published | undefined {
  const id = hubIdOf(text);
  if (!id) return undefined;
  if (settled.has(id)) return settled.get(id);
  publishedFor(text).then((r) => {
    settled.set(id, r);
    if (r) onReady();
  });
  return undefined;
}
