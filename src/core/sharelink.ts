// The workbench's share links (nucleuscoop-handler-testbench playground/src/share.ts): the handler, compressed with
// deflate-raw and written in base-62 (every 5 bytes become 7 letters or digits), after "#share-". Used by "Open in
// the Browser Workbench" in VS Code, the Language Server and the Notepad++ plugin. The compressing is the host's
// (zlib in Node, CompressionStream in the browser); this part is pure, and the workbench imports it.
export const WORKBENCH_URL = 'https://snailedlt.github.io/nucleuscoop-handler-testbench/';
export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Characters for a tail of n bytes (every 5 bytes become 7: 62^7 > 2^40). */
export const TAIL_CHARS = [0, 2, 3, 5, 6, 7];
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

/** The bytes `toBase62` wrote. Throws on a damaged text (a wrong length or a character outside the alphabet). */
export function fromBase62(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 7) {
    const part = text.slice(i, i + 7);
    const bytes = TAIL_CHARS.indexOf(part.length);
    if (bytes < 1) throw new Error('bad share link');
    let n = 0;
    for (const c of part) {
      const v = ALPHABET.indexOf(c);
      if (v < 0) throw new Error('bad share link');
      n = n * 62 + v;
    }
    const chunk: number[] = [];
    for (let k = 0; k < bytes; k++) {
      chunk.unshift(n % 256);
      n = Math.floor(n / 256);
    }
    out.push(...chunk);
  }
  return new Uint8Array(out);
}

/** The workbench with this handler open (`compressed`: its UTF-8 text, deflate-raw), tagged with where it was opened from. */
export function workbenchLink(compressed: Uint8Array | undefined, ref: string): string {
  const base = `${WORKBENCH_URL}?ref=${encodeURIComponent(ref)}`;
  if (!compressed) return base;
  const url = `${base}#share-${toBase62(compressed)}`;
  return url.length <= MAX_LINK ? url : base;
}
