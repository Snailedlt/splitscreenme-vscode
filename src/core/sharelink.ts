// The workbench's share links (nucleuscoop-handler-testbench playground/src/share.ts): the handler, compressed with
// deflate-raw and written in base-62 (every 5 bytes become 7 letters or digits), after "#share-". Used by "Open in
// the Browser Workbench" in VS Code, the Language Server and the Notepad++ plugin. The compressing is the host's
// (zlib in Node); this part is pure.
export const WORKBENCH_URL = 'https://snailedlt.github.io/nucleuscoop-handler-testbench/';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TAIL_CHARS = [0, 2, 3, 5, 6, 7];
/** Longer links don't survive every way of opening a browser (a Windows command line holds 32k characters). */
export const MAX_LINK = 30000;

export function toBase62(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 5) {
    const chunk = bytes.subarray(i, i + 5);
    let n = 0;
    for (const b of chunk) n = n * 256 + b;
    let s = '';
    for (let k = 0; k < TAIL_CHARS[chunk.length]; k++) {
      s = ALPHABET[n % 62] + s;
      n = Math.floor(n / 62);
    }
    out += s;
  }
  return out;
}

/** The workbench with this handler open (`compressed`: its UTF-8 text, deflate-raw), tagged with where it was opened from. */
export function workbenchLink(compressed: Uint8Array | undefined, ref: string): string {
  const base = `${WORKBENCH_URL}?ref=${encodeURIComponent(ref)}`;
  if (!compressed) return base;
  const url = `${base}#share-${toBase62(compressed)}`;
  return url.length <= MAX_LINK ? url : base;
}
