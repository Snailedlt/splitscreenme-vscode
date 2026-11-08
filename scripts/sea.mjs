// Builds `ncdev`, the standalone handler tool (#18): dist/cli.js inside an official Node binary, as a Node
// single executable application (SEA). No Node.js needed on the user's PC; no second code base.
//
//   node scripts/sea.mjs [--targets win-x64,linux-x64] [--out dist-sea]
//
// Needs `npm run build` first. Downloads the pinned Node for each target from nodejs.org (checked against its
// SHASUMS256.txt, cached in .sea-cache/), makes the blob with that same Node version, and injects it with
// postject. Writes ncdev.exe (win-x64), ncdev-linux-x64, ... and SHA256SUMS.txt.
// The skill's files go in as an asset, so `ncdev init-agent` works from the exe too.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** The Node inside ncdev. The only thing here to keep current: bump it with the normal dependency updates. */
export const NODE_VERSION = 'v24.22.2';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const targets = arg('--targets', 'win-x64,linux-x64').split(',');
const out = arg('--out', 'dist-sea');
const cache = '.sea-cache';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);
if (!fs.existsSync('dist/cli.js')) throw new Error('Run npm run build first.');
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const base = `https://nodejs.org/dist/${NODE_VERSION}`;
let sums;
async function download(name) {
  const file = path.join(cache, name);
  if (!sums) {
    const r = await fetch(`${base}/SHASUMS256.txt`);
    if (!r.ok) throw new Error(`SHASUMS256.txt: ${r.status}`);
    sums = Object.fromEntries((await r.text()).trim().split('\n').map((l) => l.trim().split(/\s+/).reverse()));
  }
  const want = sums[name];
  if (!want) throw new Error(`${name} is not in Node ${NODE_VERSION}'s SHASUMS256.txt`);
  const ok = () => fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === want;
  if (!ok()) {
    console.log(`Downloading ${name}`);
    const r = await fetch(`${base}/${name}`);
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    if (!ok()) throw new Error(`${name}: SHA-256 doesn't match nodejs.org's SHASUMS256.txt`);
  }
  return file;
}

/** The node binary of a target, unpacked into the cache. */
async function nodeBinary(target) {
  const dir = path.join(cache, `node-${NODE_VERSION}-${target}`);
  const bin = target.startsWith('win') ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node');
  if (fs.existsSync(bin)) return bin;
  if (target.startsWith('win')) {
    const zip = await download(`node-${NODE_VERSION}-${target}.zip`);
    execFileSync('unzip', ['-q', '-o', zip, `node-${NODE_VERSION}-${target}/node.exe`, '-d', cache]);
  } else {
    const tar = await download(`node-${NODE_VERSION}-${target}.tar.xz`);
    execFileSync('tar', ['-xJf', tar, '-C', cache, `node-${NODE_VERSION}-${target}/bin/node`]);
  }
  return bin;
}

// The blob is made by the same Node version that runs it (a Linux x64 one: the build machine's).
const builder = await nodeBinary('linux-x64');
const skillDir = 'plugin/skills/nucleus-handler';
const skill = {};
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else skill[path.relative(skillDir, p).split(path.sep).join('/')] = fs.readFileSync(p).toString('base64');
  }
})(skillDir);
const tmp = fs.mkdtempSync(path.join(cache, 'blob-'));
fs.writeFileSync(path.join(tmp, 'skill.json'), JSON.stringify(skill));
const config = {
  main: path.resolve('dist/cli.js'),
  output: path.join(tmp, 'sea.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false, // code cache is tied to the platform; the blob is shared by every target
  assets: { 'skill.json': path.join(tmp, 'skill.json') },
};
// The Notepad++ plugin (npp-plugin/build.sh), installed by `ncdev setup notepad++`.
const dll = path.join(out, 'NcDev.dll');
if (fs.existsSync(dll)) config.assets['NcDev.dll'] = path.resolve(dll);
else if (process.argv.includes('--require-plugin')) throw new Error(`${dll} is missing: run npp-plugin/build.sh first.`);
else console.warn('No NcDev.dll: this ncdev installs no Notepad++ plugin (npp-plugin/build.sh builds it).');
fs.writeFileSync(path.join(tmp, 'sea.json'), JSON.stringify(config));
execFileSync(builder, ['--experimental-sea-config', path.join(tmp, 'sea.json')], { stdio: 'inherit' });

const names = { 'win-x64': 'ncdev.exe', 'win-arm64': 'ncdev-arm64.exe', 'linux-x64': 'ncdev-linux-x64', 'darwin-arm64': 'ncdev-macos-arm64' };
const lines = [];
for (const t of targets) {
  const name = names[t];
  if (!name) throw new Error(`Unknown target ${t} (${Object.keys(names).join(', ')})`);
  const dest = path.join(out, name);
  fs.rmSync(dest, { force: true });
  if (t.startsWith('win')) {
    // Node's Authenticode signature doesn't cover our blob: remove it, so the exe is plainly unsigned rather than
    // "signature corrupted" (osslsigncode: apt-get install osslsigncode).
    execFileSync('osslsigncode', ['remove-signature', '-in', await nodeBinary(t), '-out', dest], { stdio: 'ignore' });
  } else fs.copyFileSync(await nodeBinary(t), dest);
  fs.chmodSync(dest, 0o755);
  const postject = path.resolve('node_modules/postject/dist/cli.js');
  execFileSync(process.execPath, [postject, dest, 'NODE_SEA_BLOB', config.output, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(t.startsWith('darwin') ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: ['ignore', 'ignore', 'inherit'] });
  const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  lines.push(`${hash}  ${name}`);
  console.log(`${dest} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
