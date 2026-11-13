// Smoke test for a standalone ncdev build (#18): node scripts/smoke-standalone.mjs dist-sea/ncdev-linux-x64
// --version, a template made and linted, the Language Server's initialize/shutdown, `setup notepad++` installing the
// built-in plugin into a portable Notepad++ folder, and `init-agent` from the built-in skill. The Release workflow
// runs it before publishing.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bin = path.resolve(process.argv[2] ?? 'dist-sea/ncdev-linux-x64');
const run = (...args) => execFileSync(bin, args, { encoding: 'utf8', env: { ...process.env, HOME: home } });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ncdev-smoke-'));
const ok = (what) => console.log(`ok   ${what}`);
const fail = (what) => {
  console.error(`FAIL ${what}`);
  process.exit(1);
};

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
if (!run('--version').startsWith(`ncdev ${version}`)) fail('--version');
ok(`--version (${version})`);

const handler = path.join(home, 'Test.js');
run('new', '--name', 'Test Game', '--exe', 'TestGame.exe', '--out', handler);
const lint = run('lint', handler);
if (!/0 error/.test(lint)) fail(`lint of a new template:\n${lint}`);
ok('new + lint');

await new Promise((resolve) => {
  const p = spawn(bin, ['lsp'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const send = (m) => {
    const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...m }));
    p.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
    p.stdin.write(b);
  };
  let buf = '';
  const timer = setTimeout(() => fail('lsp: no answer'), 30000);
  p.stdout.on('data', (d) => {
    buf += d;
    if (/"id":1,"result":\{"capabilities"/.test(buf) && !buf.includes('"id":2')) send({ id: 2, method: 'shutdown' });
    if (/"id":2,"result":null/.test(buf)) {
      send({ method: 'exit' });
    }
  });
  p.on('exit', () => {
    clearTimeout(timer);
    if (!/"id":2/.test(buf)) fail('lsp: initialize/shutdown');
    ok('lsp initialize + shutdown');
    resolve();
  });
  send({ id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
});

const npp = path.join(home, 'Notepad++');
fs.mkdirSync(path.join(npp, 'autoCompletion'), { recursive: true });
fs.writeFileSync(path.join(npp, 'autoCompletion', 'javascript.xml'), '<?xml version="1.0" encoding="UTF-8" ?>\n<NotepadPlus>\n\t<AutoComplete language="JavaScript">\n\t\t<Environment ignoreCase="no" />\n\t</AutoComplete>\n</NotepadPlus>\n');
fs.writeFileSync(path.join(npp, 'doLocalConf.xml'), '');
run('setup', 'notepad++', '--path', npp);
const dll = path.join(npp, 'plugins', 'NcDev', 'NcDev.dll');
if (!fs.existsSync(dll) || fs.readFileSync(dll).subarray(0, 2).toString() !== 'MZ') fail('setup notepad++: the plugin DLL');
if (!fs.existsSync(path.join(home, '.local', 'bin', 'ncdev'))) fail('setup notepad++: ncdev copied to its place');
ok('setup notepad++ (plugin installed, ncdev in place)');

const agent = path.join(home, 'agent');
fs.mkdirSync(agent);
run('init-agent', agent);
if (!fs.existsSync(path.join(agent, '.claude', 'skills', 'nucleus-handler', 'SKILL.md'))) fail('init-agent from the built-in skill');
ok('init-agent');
fs.rmSync(home, { recursive: true, force: true });
console.log('\nThe standalone build works.');
