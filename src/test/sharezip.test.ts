// The share-link letters and the zip bytes (core/sharelink.ts, core/zipbytes.ts through zip.ts), shared with the browser workbench
// (nucleuscoop-handler-testbench playground/src/share.ts and package.ts), which compresses with the browser's own
// CompressionStream: these parts must work on plain Uint8Arrays, without Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { ALPHABET, TAIL_CHARS, fromBase62, toBase62 } from '../core/sharelink';
import { readZip, writeZip } from '../core/zip';
import { crc32, handlerPackageEntries, packageEntries, zipBytes, zipRecords } from '../core/zipbytes';

test('base 62: every length round-trips, and damaged text throws', () => {
  assert.equal(ALPHABET.length, 62);
  assert.deepEqual(TAIL_CHARS, [0, 2, 3, 5, 6, 7]);
  for (let n = 0; n <= 23; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 255) & 0xff);
    const text = toBase62(bytes);
    assert.match(text, /^[0-9A-Za-z]*$/);
    assert.deepEqual(fromBase62(text), bytes);
  }
  assert.deepEqual(fromBase62(toBase62(new Uint8Array([255, 255, 255, 255, 255]))), new Uint8Array([255, 255, 255, 255, 255]));
  assert.throws(() => fromBase62('A'), /bad share link/); // no tail is one character long
  assert.throws(() => fromBase62('AB-'), /bad share link/);
});

test('base 62 + deflate-raw: the handler back, unicode included', () => {
  const text = 'Game.GameName = "Ünïcode ✓ 日本";\n'.repeat(200);
  const packed = zlib.deflateRawSync(Buffer.from(text));
  assert.equal(zlib.inflateRawSync(fromBase62(toBase62(packed))).toString('utf8'), text);
});

test('zipBytes without deflate: stored, readable by readZip, the same entries as writeZip', () => {
  const enc = new TextEncoder();
  const entries = packageEntries(enc.encode('Game.GUID = "a";'), [
    { name: 'My Game/readme.txt', data: enc.encode('hello') },
    { name: 'My Game/utils/x.ini', data: enc.encode('[a]\nb=1') },
    { name: 'root.txt', data: enc.encode('dropped by a Hub install') },
  ]);
  assert.deepEqual(entries.map((e) => e.name), ['handler.js', 'My Game/', 'My Game/utils/', 'My Game/readme.txt', 'My Game/utils/x.ini', 'root.txt']);
  const z = zipBytes(entries, new Date(2026, 10, 9, 12, 0, 0));
  assert.ok(!(z instanceof Buffer), 'plain bytes');
  const records = zipRecords(z);
  assert.deepEqual(records.map((r) => [r.name, r.method]), entries.map((e) => [e.name, 0]));
  const back = readZip(Buffer.from(z));
  assert.equal(back[3].data!.toString(), 'hello');
  assert.equal(back[1].data, undefined);
  // The Node writer: the same entries, compressed where that helps.
  const w = writeZip(entries);
  assert.ok(Buffer.isBuffer(w));
  assert.deepEqual(readZip(w).map((e) => e.name), entries.map((e) => e.name));
});

test('handlerPackageEntries: the same as packageEntries under the folder; nothing without a folder', () => {
  const b = Buffer.from('x');
  assert.deepEqual(handlerPackageEntries(b, 'G', [{ rel: 'a/b.txt', data: b }]).map((e) => e.name), ['handler.js', 'G/', 'G/a/', 'G/a/b.txt']);
  assert.deepEqual(handlerPackageEntries(b, undefined, [{ rel: 'a.txt', data: b }]).map((e) => e.name), ['handler.js']);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zipRecords: names without the UTF-8 flag read as UTF-8 when they are, else Latin-1; not a zip throws', () => {
  const z = zipBytes([{ name: 'Ünï.txt', data: new Uint8Array([1]) }, { name: 'café.txt', data: new Uint8Array([2]) }]);
  const v = new DataView(z.buffer);
  // Clear the flag in both central entries, and write the second name as Latin-1 (é = 0xE9, one byte shorter).
  let p = v.getUint32(z.length - 22 + 16, true);
  for (let i = 0; i < 2; i++) {
    v.setUint16(p + 8, 0, true);
    p += 46 + v.getUint16(p + 28, true);
  }
  assert.equal(zipRecords(z)[0].name, 'Ünï.txt');
  const latin = zipBytes([{ name: 'cafe.txt', data: new Uint8Array([2]) }]);
  const lv = new DataView(latin.buffer);
  const cd = lv.getUint32(latin.length - 22 + 16, true);
  lv.setUint16(cd + 8, 0, true);
  latin[cd + 46 + 3] = 0xe9;
  assert.equal(zipRecords(latin)[0].name, 'café.txt');
  assert.throws(() => zipRecords(new TextEncoder().encode('not a zip')), /Not a zip file/);
});
