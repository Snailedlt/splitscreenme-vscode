// Tests for the AI-agent kit: the skill docs must only mention real API members
// and lint-clean code, and the CLI/installer must behave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as acorn from 'acorn';
import { lookup, search, markdownReference } from '../core/lookup';
import { lint } from '../core/lint';
import { installAgentKit, findSkillDir } from '../core/pkg';

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'plugin', 'skills', 'nucleus-handler');
const CLI = path.join(SKILL, 'scripts', 'nucleus.js');
const docFiles = () => [path.join(SKILL, 'SKILL.md'), path.join(SKILL, 'templates', 'AGENTS.section.md'), ...['workflow', 'recipes', 'troubleshooting'].map((f) => path.join(SKILL, 'reference', `${f}.md`))];

test('every API path mentioned in the skill docs exists', () => {
  const missing: string[] = [];
  for (const file of docFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\b((?:Game(?:\.Hook|\.ProtoInput)?|Context|Nucleus\.(?:Folder|SaveType|SearchType|RegType|DPIHandling))\.[A-Z][A-Za-z0-9_]*)/g)) {
      // Deliberate examples of wrong/placeholder names.
      if (/^Game\.(Name|Option|Send|ForceFinishOnPlay|IgnoreWindowBordercheck)$/.test(m[1])) continue;
      if (lookup(m[1]).kind === 'none') missing.push(`${path.basename(file)}: ${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('every js code block in the skill docs is ES5 and lint-clean', () => {
  const HEADER = 'Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\n';
  for (const file of docFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/```js\n([\s\S]*?)```/g)) {
      const code = m[1];
      // Snippets that use Context without a Game.Play wrapper are meant for its body.
      const src = HEADER + (/\bGame\.Play\b/.test(code) || !/\b(Context|PlayerList)\b/.test(code) ? code : `Game.Play = function () {\n${code}\n};\n`);
      acorn.parse(src, { ecmaVersion: 5 });
      const diags = lint(src).filter((d) => d.severity === 'error' || d.severity === 'warning');
      assert.deepEqual(diags.map((d) => d.message), [], `${path.basename(file)}:\n${code}`);
    }
  }
});

test('lookup and search', () => {
  const r = lookup('Game.KillMutex');
  assert.equal(r.kind, 'entries');
  assert.equal(lookup('killmutex').kind, 'entries');
  assert.equal(lookup('player.ProtoInputInstanceHandle').kind, 'entries');
  assert.equal(lookup('Nucleus.Folder').kind, 'enum');
  assert.equal(lookup('Nucleus.IniSaveInfo').kind, 'class');
  const none = lookup('Game.IgnoreWindowBordercheck');
  assert.equal(none.kind, 'none');
  assert.equal(none.kind === 'none' && none.didYouMean, 'Game.IgnoreWindowBorderCheck');
  assert.ok(search('mutex').some((e) => e.path === 'Game.KillMutex'));
  assert.ok(search('window title').length > 0);
});

test('generated api.md and bundled CLI are up to date', () => {
  assert.equal(fs.readFileSync(path.join(SKILL, 'reference', 'api.md'), 'utf8').trimEnd(), markdownReference().trimEnd(), 'run npm run build');
  assert.ok(fs.existsSync(CLI), 'run npm run build');
});

test('bundled CLI: lint, api, new, package (offline)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-cli-'));
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });

  let r = run('new', '--name', 'Halo: Reach', '--exe', 'reach.exe', '--features', 'protoinput,goldberg');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'Halo Reach.js')));

  r = run('lint', 'Halo Reach.js', '--json');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).errors, 0);

  fs.writeFileSync(path.join(dir, 'bad.js'), 'Game.GUID = "x";\nGame.GameName = "x";\nGame.ExecutableName = "x.exe";\nGame.Play = () => {};\nGame.KillMutx = [];\n');
  r = run('lint', 'bad.js', '--json');
  assert.equal(r.status, 1);
  const rules = JSON.parse(r.stdout).files[0].diagnostics.map((d: any) => d.rule);
  assert.deepEqual(rules, ['es5-only', 'unknown-member']);
  // `nucleus-lint <path>` style (no subcommand) still lints
  assert.equal(run('bad.js').status, 1);

  r = run('api', 'Game.KillMutex', '--json');
  assert.equal(JSON.parse(r.stdout)[0].type, 'string[]');
  r = run('api', 'Game.KillMutx');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Did you mean Game\.KillMutex/);

  fs.mkdirSync(path.join(dir, 'Halo Reach'));
  fs.writeFileSync(path.join(dir, 'Halo Reach', 'readme.txt'), 'hi');
  r = run('package', 'Halo Reach.js', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).assetCount, 1);
  assert.equal(run('package', 'bad.js').status, 1, 'refuses to package a handler with errors');

  assert.equal(run('frobnicate', '--bogus').status, 2, 'unknown flag is a usage error');
  assert.equal(run('lint', 'missing.js').status, 1);
  assert.equal(run('new').status, 2);
  const q = run('new', '--name', 'Say "Hi"', '--exe', 'game.exe', '--out', 'quoted.js');
  assert.equal(q.status, 2, 'a game name the Hub install would break on');
  assert.match(q.stderr, /double quotes/);
});

test('installAgentKit is idempotent and preserves user content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-kit-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# My notes\n\nKeep me.\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Use tabs.\n');
  const skill = findSkillDir(path.dirname(CLI))!;
  assert.equal(skill, SKILL);

  installAgentKit(skill, dir);
  const agents1 = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents1, /Keep me\./);
  assert.match(agents1, /nucleus-handler:start[\s\S]*ES5 JavaScript only[\s\S]*nucleus-handler:end/);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n\nUse tabs.\n');
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'nucleus-handler', 'scripts', 'nucleus.js')));

  const second = installAgentKit(skill, dir);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), agents1, 'no duplicate section');
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n\nUse tabs.\n');
  assert.deepEqual(second.created, []);

  // the installed CLI works from the workspace
  const out = execFileSync(process.execPath, [path.join(dir, '.claude', 'skills', 'nucleus-handler', 'scripts', 'nucleus.js'), 'api', 'Context.Width'], { encoding: 'utf8' });
  assert.match(out, /Context\.Width: number/);
});

test('plugin manifests are consistent', () => {
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, './plugin');
  assert.equal(plugin.version, pkg.version);
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: nucleus-handler\ndescription: .+\n---\n/);
  assert.ok(skill.split('\n').length < 500);
});

test('bundled CLI: new --list-features, install into a Nucleus folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-install-'));
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  let r = run('new', '--list-features', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).some((f: { id: string }) => f.id === 'protoinput'));

  assert.equal(run('new', '--name', 'My Game', '--exe', 'game.exe').status, 0);
  fs.mkdirSync(path.join(dir, 'My Game', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'My Game', 'sub', 'a.ini'), 'x=1');
  const nucleus = path.join(dir, 'Nucleus');
  r = run('install', 'My Game.js', '--nucleus', nucleus);
  assert.notEqual(r.status, 0, 'no handlers folder');
  fs.mkdirSync(path.join(nucleus, 'handlers'), { recursive: true });
  r = run('install', 'My Game.js', '--nucleus', nucleus, '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).assetCount, 1);
  assert.ok(fs.existsSync(path.join(nucleus, 'handlers', 'My Game.js')));
  assert.ok(fs.existsSync(path.join(nucleus, 'handlers', 'My Game', 'sub', 'a.ini')));
  assert.notEqual(run('install', 'My Game.js', '--nucleus', nucleus).status, 0, 'refuses to replace without --force');
  assert.equal(run('install', 'My Game.js', '--nucleus', nucleus, '--force').status, 0);
  fs.writeFileSync(path.join(dir, 'Bad.js'), 'Game.ExecutableName = "a.exe";\nGame.GameName = "Bad";\nGame.Play = () => 1;\n');
  assert.notEqual(run('install', 'Bad.js', '--nucleus', nucleus).status, 0, 'refuses a handler with errors');
});
