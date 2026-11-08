// The standalone ncdev (#18) and the Notepad++ plugin's setup (#19): versions, the daily update check, replacing the
// exe safely, and installing/removing the plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assetName, installRelease, latestRelease, newer, versionOf } from '../standalone';
import { nppArch, readIni, setupNotepadPP } from '../setup-npp';
import { mergeNotepadPP } from '../core/notepadpp';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('standalone: versions from tags, and which is newer', () => {
  assert.equal(versionOf('v0.5.0-beta.1'), '0.5.0');
  assert.equal(versionOf('workbench-2026-11-08'), '0.0.0');
  assert.ok(newer('0.6.0', '0.5.0') && newer('0.5.1', '0.5.0') && newer('1.0.0', '0.9.9'));
  assert.ok(!newer('0.5.0', '0.5.0') && !newer('0.4.9', '0.5.0'));
  assert.equal(assetName('win32', 'x64'), 'ncdev.exe');
  assert.equal(assetName('linux', 'x64'), 'ncdev-linux-x64');
  assert.equal(assetName('freebsd', 'x64'), undefined);
});

test('standalone: the update check asks GitHub at most once a day, with the ETag', async () => {
  const dir = tmp('ncdev-update-');
  const calls: Record<string, string>[] = [];
  const releases = [
    { tag_name: 'workbench-2026-11-08', draft: false, html_url: 'w', assets: [] },
    { tag_name: 'v0.6.0-beta.1', draft: false, html_url: 'https://x/v0.6.0', assets: [{ name: 'ncdev.exe', browser_download_url: 'https://x/ncdev.exe' }, { name: 'SHA256SUMS.txt', browser_download_url: 'https://x/sums' }] },
  ];
  const fake = (async (_url: string, init?: any) => {
    calls.push(init?.headers ?? {});
    if (init?.headers?.['if-none-match'] === '"e1"') return new Response(null, { status: 304 });
    return new Response(JSON.stringify(releases), { status: 200, headers: { etag: '"e1"' } });
  }) as unknown as typeof fetch;
  const t0 = Date.UTC(2026, 10, 8);
  const a = await latestRelease(false, fake, dir, t0);
  assert.equal(a?.tag, 'v0.6.0-beta.1', 'the newest release with ncdev, skipping the workbench ones');
  assert.equal(a?.version, '0.6.0');
  await latestRelease(false, fake, dir, t0 + 3600_000);
  assert.equal(calls.length, 1, 'an hour later: from the cache');
  const b = await latestRelease(true, fake, dir, t0 + 7200_000);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]['if-none-match'], '"e1"', 'revalidated with the ETag');
  assert.equal(b?.tag, 'v0.6.0-beta.1', 'a 304 keeps what we knew');
  const offline = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  assert.equal((await latestRelease(true, offline, dir, t0 + 9e7))?.tag, 'v0.6.0-beta.1', 'offline: what we knew');
  assert.equal(await latestRelease(true, offline, tmp('ncdev-update-'), t0), undefined, 'offline, nothing known');
  const none = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
  assert.equal(await latestRelease(true, none, tmp('ncdev-update-'), t0), null, 'no release has ncdev yet');
});

test('standalone: an update replaces the exe only when its SHA-256 matches', async () => {
  const dir = tmp('ncdev-install-');
  const target = path.join(dir, 'ncdev.exe');
  fs.writeFileSync(target, 'old');
  const name = assetName()!;
  const good = Buffer.from('new build');
  const hash = crypto.createHash('sha256').update(good).digest('hex');
  const latest = { tag: 'v9.0.0', version: '9.0.0', url: 'u', assets: { [name]: 'https://x/exe', 'SHA256SUMS.txt': 'https://x/sums' } };
  const serve = (exe: Buffer) =>
    (async (url: string) => (url.endsWith('/sums') ? new Response(`${hash}  ${name}\n${'0'.repeat(64)}  other\n`) : new Response(exe))) as unknown as typeof fetch;
  await assert.rejects(installRelease(latest, target, serve(Buffer.from('tampered'))), /SHA-256/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old', 'a bad download changes nothing');
  await installRelease(latest, target, serve(good));
  assert.equal(fs.readFileSync(target, 'utf8'), 'new build');
  assert.equal(fs.readFileSync(`${target}.old`, 'utf8'), 'old', 'the running one is moved aside (Windows can rename a running exe)');
  await assert.rejects(installRelease({ ...latest, assets: { 'SHA256SUMS.txt': 'x' } }, target, serve(good)), /has no/);
});

test('notepad++: the plugin install (DLL, NcDev.ini, the static list taken out) and its removal', () => {
  const dir = tmp('ncdev-npp-');
  fs.mkdirSync(path.join(dir, 'autoCompletion'));
  const original = '<?xml version="1.0" encoding="UTF-8" ?>\n<NotepadPlus>\n\t<AutoComplete language="JavaScript">\n\t\t<Environment ignoreCase="no" />\n\t\t<KeyWord name="abs" />\n\t</AutoComplete>\n</NotepadPlus>\n';
  const xml = path.join(dir, 'autoCompletion', 'javascript.xml');
  // Set up earlier without the plugin: the names were merged in, with a backup.
  fs.writeFileSync(`${xml}.nucleus-backup`, original);
  fs.writeFileSync(xml, mergeNotepadPP(original, '0.4.0'));
  fs.writeFileSync(path.join(dir, 'doLocalConf.xml'), '');
  const dll = Buffer.from('MZ fake plugin');
  // A 64-bit notepad++.exe (PE machine 0x8664) gets the 64-bit DLL; a 32-bit one the other.
  const exe = Buffer.alloc(512);
  exe.write('MZ', 0);
  exe.writeUInt32LE(0x80, 0x3c);
  exe.write('PE\0\0', 0x80, 'latin1');
  exe.writeUInt16LE(0x8664, 0x84);
  fs.writeFileSync(path.join(dir, 'notepad++.exe'), exe);
  assert.equal(nppArch(dir), 'x64');
  const r = setupNotepadPP({ path: dir, plugins: { x64: dll, x86: Buffer.from('MZ 32-bit') }, toolPath: 'C:\\Users\\Ann\\AppData\\Local\\ncdev\\ncdev.exe', runCommand: 'cmd /k ncdev lint "$(FULL_CURRENT_PATH)"' });
  assert.ok(r.ok, r.lines.join('\n'));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'plugins', 'NcDev', 'NcDev.dll')), dll);
  assert.equal(fs.readFileSync(xml, 'utf8'), original, 'the plugin suggests names itself: the static list goes back to Notepad++\'s own');
  const ini = path.join(dir, 'plugins', 'Config', 'NcDev.ini');
  const raw = fs.readFileSync(ini);
  assert.ok(raw[0] === 0xff && raw[1] === 0xfe, 'UTF-16 with a BOM, for GetPrivateProfileStringW');
  assert.match(readIni(ini), /^\[ncdev\]\r\npath=C:\\Users\\Ann\\AppData\\Local\\ncdev\\ncdev\.exe\r\n/);
  // The plugin keeps linked game folders in the same file: setting up again keeps them.
  fs.writeFileSync(ini, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${readIni(ini)}\r\n[gameFolders]\r\nShooter.js=D:\\Games\\Shooter\r\n`, 'utf16le')]));
  setupNotepadPP({ path: dir, plugins: { x64: Buffer.from('MZ v2') }, toolPath: 'C:\\ncdev.exe' });
  assert.match(readIni(ini), /path=C:\\ncdev\.exe/);
  assert.match(readIni(ini), /\[gameFolders\]\r\nShooter\.js=D:\\Games\\Shooter/);
  assert.equal(fs.readFileSync(path.join(dir, 'plugins', 'NcDev', 'NcDev.dll'), 'utf8'), 'MZ v2');
  assert.equal(fs.readFileSync(path.join(dir, 'plugins', 'NcDev', 'NcDev.dll.old'), 'utf8'), 'MZ fake plugin', 'a loaded DLL is moved aside, not overwritten');
  assert.match(setupNotepadPP({ path: dir, check: true }).lines[0], /plugin is installed.*it runs C:\\ncdev\.exe/);
  exe.writeUInt16LE(0x14c, 0x84);
  fs.writeFileSync(path.join(dir, 'notepad++.exe'), exe);
  assert.equal(nppArch(dir), 'x86');
  setupNotepadPP({ path: dir, plugins: { x64: Buffer.from('MZ v2'), x86: Buffer.from('MZ 32-bit') }, toolPath: 'C:\\ncdev.exe' });
  assert.equal(fs.readFileSync(path.join(dir, 'plugins', 'NcDev', 'NcDev.dll'), 'utf8'), 'MZ 32-bit', '32-bit Notepad++: the 32-bit DLL');
  exe.writeUInt16LE(0xaa64, 0x84);
  fs.writeFileSync(path.join(dir, 'notepad++.exe'), exe);
  assert.match(setupNotepadPP({ path: dir, plugins: { x64: Buffer.from('MZ v2') }, toolPath: 'C:\\ncdev.exe' }).lines.join('\n'), /no plugin for arm64/);
  const rm = setupNotepadPP({ path: dir, remove: true, runCommand: '' });
  assert.match(rm.lines.join('\n'), /Removed the Nucleus plugin/);
  assert.ok(!fs.existsSync(path.join(dir, 'plugins', 'NcDev')) && !fs.existsSync(ini));
});

test('cli: ncdev --version, and `nucleus` still answers', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js');
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  assert.match(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }), new RegExp(`^ncdev ${v.replace(/\./g, '\\.')}`));
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /`nucleus` is the old name[\s\S]*Usage: ncdev <command>/);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.bin.ncdev, pkg.bin.nucleus, 'both names run the same tool');
});
