// Client for the public SplitScreen.Me hub API (https://hub.splitscreen.me).
import { readZip, ZipEntry } from './zip';

export const HUB = 'https://hub.splitscreen.me';

export interface HubHandler {
  _id: string;
  title: string;
  gameName: string;
  ownerName: string;
  description?: string;
  downloadCount?: number;
  stars?: number;
  verified?: boolean;
  currentVersion: number;
  currentPackage: string;
  maxPlayers?: number;
  playableControllers?: boolean;
  playableMouseKeyboard?: boolean;
  playableMultiMouseKeyboard?: boolean;
  updatedAt?: string;
}

export async function fetchHandlers(fetchImpl: typeof fetch = fetch): Promise<HubHandler[]> {
  const res = await fetchImpl(`${HUB}/api/v1/allhandlers`);
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  const json = (await res.json()) as { Handlers?: HubHandler[] };
  return (json.Handlers ?? []).sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0));
}

export function packageUrl(h: Pick<HubHandler, '_id' | 'currentPackage' | 'currentVersion'>): string {
  return `${HUB}/cdn/storage/packages/${h.currentPackage}/original/handler-${h._id}-v${h.currentVersion}.nc`;
}

export function handlerPageUrl(id: string): string {
  return `${HUB}/handler/${id}`;
}

export async function downloadPackage(h: HubHandler, fetchImpl: typeof fetch = fetch): Promise<ZipEntry[]> {
  const res = await fetchImpl(packageUrl(h));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return readZip(Buffer.from(await res.arrayBuffer()));
}
