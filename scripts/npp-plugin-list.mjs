#!/usr/bin/env node
// The Notepad++ Plugins Admin entries for a release (the pull request to notepad-plus-plus/nppPluginList, task #78),
// and the checks its validator makes, so a listing never fails on something we could have caught:
// - each DLL's FileVersion (its VS_FIXEDFILEINFO) is package.json's version as a.b.c.0 (npp-plugin/build.sh);
// - each zip holds NcDev.dll at its root, named like the folder (folder-name);
// - "id" is the SHA-256 of the zip exactly as uploaded to the release.
//
//   node scripts/npp-plugin-list.mjs --tag v0.6.0-beta.1 [--x64 NcDev.zip] [--x86 NcDev-x86.zip] [--json]
//
// Prints the two entries (src/pl.x64.json and src/pl.x86.json in nppPluginList) to paste into a pull request there.
// It lists nothing by itself.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const REPO = 'https://github.com/Snailedlt/splitscreenme-vscode';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};

/** The DLL's file version from its VS_FIXEDFILEINFO (signature 0xFEEF04BD), as "a.b.c.d"; undefined without one. */
export function dllVersion(buf) {
  for (let i = buf.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe])); i >= 0; i = buf.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]), i + 1)) {
    if (i % 4 !== 0 || i + 16 > buf.length) continue; // DWORD-aligned in the resource
    const ms = buf.readUInt32LE(i + 8), ls = buf.readUInt32LE(i + 12);
    return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
  }
  return undefined;
}

/** The names of the files in a zip (its central directory), without unpacking it. */
export function zipNames(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < count; n++) {
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + extra + comment;
  }
  return names;
}

export const wantedVersion = (v = pkg.version) => {
  const [a = 0, b = 0, c = 0] = v.replace(/[-+].*/, '').split('.').map(Number);
  return `${a}.${b}.${c}.0`;
};

function main() {
  const tag = arg('--tag', `v${pkg.version}`);
  const want = wantedVersion();
  const problems = [];
  const entries = {};
  for (const [arch, dll, zipDefault] of [['x64', 'dist-sea/NcDev.dll', 'NcDev.zip'], ['x86', 'dist-sea/NcDev-x86.dll', 'NcDev-x86.zip']]) {
    const dllPath = path.resolve(root, dll);
    if (!fs.existsSync(dllPath)) { problems.push(`${dll} is missing: run sh npp-plugin/build.sh`); continue; }
    const v = dllVersion(fs.readFileSync(dllPath));
    if (v !== want) problems.push(`${dll}: FileVersion ${v ?? 'missing'}, the list needs ${want} (package.json ${pkg.version})`);
    const zipPath = path.resolve(arg(`--${arch}`, zipDefault));
    let id = '(the SHA-256 of the uploaded zip)';
    if (fs.existsSync(zipPath)) {
      const zip = fs.readFileSync(zipPath);
      const names = zipNames(zip);
      if (!names.includes('NcDev.dll')) problems.push(`${path.basename(zipPath)} has no NcDev.dll at its root (has: ${names.join(', ')})`);
      id = crypto.createHash('sha256').update(zip).digest('hex');
    } else problems.push(`${path.basename(zipPath)} not found: the entry's id can't be filled in`);
    entries[arch] = {
      'folder-name': 'NcDev',
      'display-name': 'Nucleus Co-op handlers',
      version: want,
      id,
      repository: `${REPO}/releases/download/${tag}/${arch === 'x64' ? 'NcDev.zip' : 'NcDev-x86.zip'}`,
      description: 'Write Nucleus Co-op (SplitScreen.Me) game handlers: problems underlined as you type, suggestions and docs for the handler API, fixes, Try it (what Nucleus sets up per player), the Hub, packaging and testing in Nucleus. Uses ncdev (offered on first use, checked against its SHA-256).',
      author: 'Snailedlt',
      homepage: `${REPO}#notepad`,
    };
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: !problems.length, problems, entries }, null, 2));
  else {
    for (const [arch, e] of Object.entries(entries)) console.log(`src/pl.${arch}.json:\n${JSON.stringify(e, null, 2)}\n`);
    console.log(problems.length ? `Not ready:\n- ${problems.join('\n- ')}` : 'Ready: versions, zips and ids check out.');
  }
  process.exitCode = problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
