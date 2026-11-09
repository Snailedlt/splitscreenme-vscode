// The bytes of a zip file (no dependencies, no Node APIs: only Uint8Array and DataView), for Nucleus handler
// packages (.nc, .zip). Shared with the browser workbench (nucleuscoop-handler-testbench playground/src/package.ts),
// which compresses with the browser's CompressionStream. Node code uses zip.ts (writeZip, readZip with zlib), which
// re-exports all of this.

/** A zip entry in bytes (a Buffer is one too): what `zipBytes` writes. */
export interface ZipBytesEntry {
  /** Forward-slash path. Directories end with '/'. */
  name: string;
  data?: Uint8Array;
}

/** An entry as it is stored: `body` is still compressed when `method` is 8 (deflate). Directories have no body. */
export interface ZipRecord {
  name: string;
  /** 0: stored, 8: deflate. */
  method: number;
  body?: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * A zip file of `entries`. With `deflate` (raw deflate), an entry is stored compressed when that makes it smaller;
 * without, every entry is stored as is.
 */
export function zipBytes(entries: ZipBytesEntry[], now = new Date(), deflate?: (raw: Uint8Array) => Uint8Array): Uint8Array {
  const { time, date } = dosDateTime(now);
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const isDir = e.name.endsWith('/');
    const raw = isDir ? new Uint8Array(0) : e.data ?? new Uint8Array(0);
    const deflated = raw.length && deflate ? deflate(raw) : raw;
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const crc = crc32(raw);
    const method = useDeflate ? 8 : 0;
    const flags = 0x0800; // UTF-8 names

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, body);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, flags, true);
    central.setUint16(10, method, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(38, isDir ? 0x10 : 0x20, true); // folder or file (MS-DOS attributes)
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.length + body.length;
  }
  const cd = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cd.length, true);
  end.setUint32(16, offset, true);
  return concat([...locals, cd, new Uint8Array(end.buffer)]);
}

/** A name with the UTF-8 flag, or that reads as UTF-8, is UTF-8; else each byte is one character (Latin-1). */
function entryName(bytes: Uint8Array, utf8Flag: boolean): string {
  try {
    return new TextDecoder('utf-8', { fatal: !utf8Flag }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

/** The entries of a zip file, in its central directory's order, their bodies still compressed. Throws when it isn't one. */
export function zipRecords(buf: Uint8Array): ZipRecord[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipRecord[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = entryName(buf.subarray(p + 46, p + 46 + nlen), !!(flags & 0x0800)).replace(/\\/g, '/');
    p += 46 + nlen + xlen + clen;
    if (flags & 1) throw new Error(`Encrypted zip entries are not supported (${name})`);
    if (name.endsWith('/')) {
      out.push({ name, method });
      continue;
    }
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, method, body: buf.subarray(start, start + csize) });
  }
  return out;
}

/**
 * A package's entries: `handler.js` at the root, then an explicit entry for every folder the files are in (Nucleus
 * only picks up folders that have one), then the files. `files` are named by their path in the package.
 */
export function packageEntries<T extends Uint8Array>(handlerJs: T, files: { name: string; data: T }[]): { name: string; data?: T }[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.name.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join('/')}/`);
  }
  return [{ name: 'handler.js', data: handlerJs }, ...[...dirs].sort().map((name) => ({ name })), ...files];
}

/**
 * Build the entries of a Nucleus handler package: `handler.js` at the root and
 * the handler's asset folder as a single top-level folder. Nucleus only picks up
 * folders that have explicit directory entries, so those are always written.
 */
export function handlerPackageEntries<T extends Uint8Array>(handlerJs: T, folderName: string | undefined, files: { rel: string; data: T }[]): { name: string; data?: T }[] {
  return packageEntries(handlerJs, folderName ? files.map((f) => ({ name: `${folderName}/${f.rel}`, data: f.data })) : []);
}
