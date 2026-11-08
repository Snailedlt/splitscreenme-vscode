// "Open in the Browser Workbench" for Node hosts (VS Code, `ncdev lsp`): the handler compressed as the workbench's
// share links expect (core/sharelink.ts).
import zlib from 'node:zlib';
import { MAX_LINK, workbenchLink } from './core/sharelink';

/** The link, and whether the handler fit in it (a very large one opens the workbench without it). */
export function workbenchLinkFor(text: string | undefined, ref: string): { url: string; withHandler: boolean } {
  const packed = text === undefined ? undefined : new Uint8Array(zlib.deflateRawSync(Buffer.from(text, 'utf8'), { level: 9 }));
  const url = workbenchLink(packed, ref);
  return { url, withHandler: !!packed && url.includes('#share-') && url.length <= MAX_LINK };
}
