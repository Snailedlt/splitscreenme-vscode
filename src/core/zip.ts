// Minimal ZIP reader/writer for Nucleus handler packages (.nc), in Node: the bytes are zipbytes.ts (shared with the
// browser workbench), the compressing is zlib's.
import zlib from 'node:zlib';
import { zipBytes, zipRecords, type ZipBytesEntry } from './zipbytes';

export * from './zipbytes';

export interface ZipEntry {
  /** Forward-slash path. Directories end with '/'. */
  name: string;
  data?: Buffer;
}

export function writeZip(entries: ZipBytesEntry[], now = new Date()): Buffer {
  const z = zipBytes(entries, now, (raw) => zlib.deflateRawSync(raw, { level: 9 }));
  return Buffer.from(z.buffer, z.byteOffset, z.length);
}

export function readZip(buf: Buffer): ZipEntry[] {
  return zipRecords(buf).map((r) => {
    if (!r.body) return { name: r.name };
    if (r.method === 0) return { name: r.name, data: Buffer.from(r.body) };
    if (r.method === 8) return { name: r.name, data: zlib.inflateRawSync(r.body) };
    throw new Error(`Unsupported compression method ${r.method} (${r.name})`);
  });
}
