// `nucleus`: command-line tools for Nucleus Co-op handlers, for people, CI and AI agents.
// `nucleus-lint <paths>` is kept as a shortcut for `nucleus lint <paths>`.
import fs from 'node:fs';
import path from 'node:path';
import { lint, lineOf, lineStart, RULES, RuleId, Severity, LintOptions, looksLikeHandler } from './core/lint';
import { fixAll } from './core/fix';
import { lookup, search, formatEntry, markdownReference } from './core/lookup';
import { fetchHandlers, downloadPackage, handlerPageUrl, HubHandler } from './core/hub';
import { renderHandler, toHandlerFileName, FEATURES, Feature } from './core/templates';
import { buildPackage, extractEntries, findSkillDir, installAgentKit } from './core/pkg';
import { SimResult, sessionSummary } from './core/sim';
import { pluginsFor, simulateIsolated } from './sandbox';

const HELP = `Usage: nucleus <command> [options]

Commands:
  lint <file|dir>...          Check handlers for problems (default command)
  api <name>                  Show the type and docs of an API member, e.g. "Game.KillMutex",
                              "Context.ModifySaveFile", "KillMutex", "Nucleus.Folder"
  api --search <words>        Search API names and docs, e.g. "api --search mutex"
  api --markdown              Print the full API reference as Markdown
  simulate <handler.js> [--players N] [--resolution 1920x1080] [--keyboard 1|none]
                              "Try it": load the handler and run Game.Play for each player the
                              way Nucleus would (emulating its Jint engine), without Nucleus or
                              the game. Shows each player's window, launch arguments and file
                              changes. File, registry and process calls are recorded, never
                              performed, and the handler has no access to this computer.
  hub search <words>          Search handlers on hub.splitscreen.me
  hub fetch <id> [--out dir]  Download a Hub handler package and extract it (default ./hub-handlers/<title>)
  new --name <game> --exe <file.exe> [--steam-id N] [--max-players N]
      [--features ${FEATURES.map((f) => f.id).join(',')}] [--out file.js] [--force]
                              Create a handler from a template
  package <handler.js> [--out file.nc] [--force]
                              Build a Hub package (handler.js + the <Name>/ asset folder)
  init-agent [dir]            Install AI agent instructions and this tool into a handler folder
                              (AGENTS.md, CLAUDE.md, .claude/skills/nucleus-handler/)
  rules                       List lint rules

Common options:
  --json                      Machine-readable output
  -h, --help                  Show this help

Lint options:
  --rule <id>=<severity>      Override a rule: error, warning, info, hint or off
  --all                       Lint every .js file, not only ones that look like handlers
  --quiet                     Only report errors
  --verbose                   Also report hints (e.g. deprecated options)
  --fix                       Apply every safe automatic fix and save the files (deterministic, no AI)
  --fix-dry-run               Show what --fix would change, without saving

Exit code: 1 when lint finds errors, a simulated handler fails to load or run, or a command
fails; 2 on bad usage.`;

class Usage extends Error {}

interface Args {
  positional: string[];
  flags: Map<string, string[]>;
}
const BOOL_FLAGS = new Set(['--json', '--all', '--quiet', '--verbose', '--force', '--search', '--markdown', '--fix', '--fix-dry-run', '-h', '--help']);
function parseArgs(argv: string[]): Args {
  const a: Args = { positional: [], flags: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('-')) {
      const [k, inline] = t.split(/=(.*)/s, 2);
      const v = BOOL_FLAGS.has(k) ? 'true' : inline ?? argv[++i];
      if (v === undefined) throw new Usage(`Missing value for ${k}`);
      a.flags.set(k, [...(a.flags.get(k) ?? []), v]);
    } else a.positional.push(t);
  }
  return a;
}
const flag = (a: Args, k: string) => a.flags.get(k)?.at(-1);
const has = (a: Args, k: string) => a.flags.has(k);
const print = (json: boolean, value: unknown, text: () => string) => console.log(json ? JSON.stringify(value, null, 2) : text());

async function main(argv: string[]): Promise<number> {
  const commands = ['lint', 'simulate', 'api', 'hub', 'new', 'package', 'init-agent', 'rules'];
  let cmd = argv[0] && commands.includes(argv[0]) ? argv.shift()! : undefined;
  if (path.basename(process.argv[1] ?? '').startsWith('nucleus-lint')) cmd ??= 'lint';
  if (argv.includes('--list-rules')) cmd = 'rules';
  const args = parseArgs(argv);
  if (!cmd) {
    if (has(args, '-h') || has(args, '--help') || !args.positional.length) {
      console.log(HELP);
      return args.positional.length || has(args, '-h') || has(args, '--help') ? 0 : 2;
    }
    cmd = 'lint';
  }
  const json = has(args, '--json');
  switch (cmd) {
    case 'lint':
      return cmdLint(args, json);
    case 'rules':
      print(json, RULES, () => Object.entries(RULES).map(([id, r]) => `${id.padEnd(22)} ${r.severity.padEnd(8)} ${r.description}`).join('\n'));
      return 0;
    case 'simulate':
      return cmdSimulate(args, json);
    case 'api':
      return cmdApi(args, json);
    case 'hub':
      return cmdHub(args, json);
    case 'new':
      return cmdNew(args, json);
    case 'package':
      return cmdPackage(args, json);
    case 'init-agent':
      return cmdInitAgent(args, json);
  }
  return 2;
}

// ---------------------------------------------------------------------------

function cmdLint(args: Args, json: boolean): number {
  const options: LintOptions = { rules: {} };
  for (const r of args.flags.get('--rule') ?? []) {
    const [id, sev] = r.split('=');
    if (!(id in RULES) || !['error', 'warning', 'info', 'hint', 'off'].includes(sev)) throw new Usage(`Invalid --rule ${r}`);
    options.rules![id as RuleId] = sev as Severity | 'off';
  }
  const files = args.positional;
  if (!files.length) throw new Usage('lint: give at least one file or directory');
  const all = has(args, '--all');
  const quiet = has(args, '--quiet');
  const verbose = has(args, '--verbose');
  const fixMode = has(args, '--fix-dry-run') ? 'dry' : has(args, '--fix') ? 'write' : null;
  let fixedCount = 0;

  const targets: string[] = [];
  const collect = (p: string, explicit: boolean) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) if (e !== 'node_modules' && !e.startsWith('.')) collect(path.join(p, e), false);
    } else if (explicit || p.endsWith('.js')) targets.push(p);
  };
  for (const f of files) collect(f, true);

  let errors = 0;
  let warnings = 0;
  let linted = 0;
  const out: unknown[] = [];
  for (const file of targets) {
    const original = fs.readFileSync(file, 'utf8');
    let text = original.replace(/^﻿/, '');
    if (!all && !files.includes(file) && !looksLikeHandler(text)) continue;
    linted++;
    let fixed: { rule: string; title: string; line: number }[] = [];
    if (fixMode) {
      const r = fixAll(text, options);
      fixed = r.applied;
      if (r.code !== text) {
        if (fixMode === 'write') fs.writeFileSync(file, (original.startsWith('﻿') ? '﻿' : '') + r.code);
        text = r.code;
      }
    }
    const diags = lint(text, options).filter((d) => (quiet ? d.severity === 'error' : verbose || d.severity !== 'hint'));
    for (const d of diags) {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    }
    const withPos = diags.map((d) => ({ ...d, line: lineOf(text, d.start) + 1, column: d.start - lineStart(text, d.start) + 1 }));
    fixedCount += fixed.length;
    if (json) {
      out.push({ file, ...(fixMode ? { fixed } : {}), diagnostics: withPos });
      continue;
    }
    if (!diags.length && !fixed.length) continue;
    console.log(file);
    for (const f of fixed) console.log(`  ${`${f.line}`.padEnd(9)} ${(fixMode === 'dry' ? 'would fix' : 'fixed').padEnd(8)} ${f.title}  [${f.rule}]`);
    for (const d of withPos) {
      console.log(`  ${`${d.line}:${d.column}`.padEnd(9)} ${d.severity.padEnd(8)} ${d.message}  [${d.rule}]`);
      for (const f of d.fixes ?? []) console.log(`  ${''.padEnd(9)} ${''.padEnd(8)} fix: ${f.title}`);
    }
    console.log();
  }
  if (json) console.log(JSON.stringify({ files: out, errors, warnings, ...(fixMode ? { fixed: fixedCount } : {}) }, null, 2));
  else console.log(`${linted} handler(s): ${fixMode ? `${fixedCount} problem(s) ${fixMode === 'dry' ? 'would be fixed' : 'fixed'}, ` : ''}${errors} error(s)${fixMode ? ' left' : ''}, ${warnings} warning(s)${fixMode ? ' left' : ''}`);
  return errors ? 1 : 0;
}

function cmdSimulate(args: Args, json: boolean): number {
  const file = args.positional[0];
  if (!file || args.positional.length > 1) throw new Usage('simulate: give one handler file');
  const players = Number(flag(args, '--players') ?? 2);
  if (!Number.isInteger(players) || players < 1 || players > 16) throw new Usage('--players must be 1 to 16');
  const res = (flag(args, '--resolution') ?? '1920x1080').match(/^(\d+)x(\d+)$/);
  if (!res) throw new Usage('--resolution must look like 1920x1080');
  const kbArg = flag(args, '--keyboard') ?? '1';
  const keyboardPlayer = kbArg === 'none' ? -1 : Number(kbArg) - 1;
  if (kbArg !== 'none' && (!Number.isInteger(keyboardPlayer) || keyboardPlayer < 0 || keyboardPlayer >= players)) throw new Usage(`--keyboard must be a player number (1-${players}) or "none"`);
  const src = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const r = simulateIsolated(src, { players, width: Number(res[1]), height: Number(res[2]), keyboardPlayer, plugins: pluginsFor(file) });
  const failed = !r.loaded || r.players.some((p) => p.error) || r.callbacks.some((c) => c.error);
  print(json, { file, ...r }, () => formatSimulation(r, keyboardPlayer));
  return failed ? 1 : 0;
}

export function formatSimulation(r: SimResult, keyboardPlayer: number): string {
  const out: string[] = [];
  out.push(sessionSummary(r));
  if (!r.loaded) out.push(`  ${r.loadError ?? ''}`);
  const ignored = [...new Set(r.ignored)];
  if (ignored.length) out.push('', `Settings Nucleus skips (${ignored.length}):`, ...ignored.map((s) => `  ${s}`));
  for (const p of r.players) {
    out.push('', `Player ${p.index + 1} (${p.index === keyboardPlayer ? 'keyboard & mouse' : 'controller'})`);
    if (p.error) out.push(`  FAILS: ${p.error}`);
    if (p.note) out.push(`  Note: ${p.note}`);
    out.push(`  Window:       ${p.window}`, `  Starts with:  ${p.startArguments || '(nothing extra)'}`);
    if (p.effects.length) out.push('  Changes before the game starts:', ...p.effects.map((e) => `    - ${e}`));
    if (p.calls.length) out.push('  Recorded calls:', ...p.calls.map((c) => `    ${c}`));
  }
  for (const c of r.callbacks) {
    out.push('', c.name);
    if (c.error) out.push(`  FAILS: ${c.error}${c.note ? ` ${c.note}` : ''}`);
    out.push(...c.calls.map((x) => `    ${x}`));
  }
  if (r.options.length) out.push('', `Options set (different from Nucleus' defaults):`, ...r.options.map((o) => `  ${o.path} = ${o.value}`));
  out.push('', 'Simulated: no files, registry or processes were touched. Windows, focus and input still need a real test in Nucleus.');
  return out.join('\n');
}

function cmdApi(args: Args, json: boolean): number {
  if (has(args, '--markdown')) {
    console.log(markdownReference());
    return 0;
  }
  const q = args.positional.join(' ');
  if (!q) throw new Usage('api: give a name, e.g. "nucleus api Game.KillMutex", or --search <words>');
  const doSearch = (words: string) => {
    const hits = search(words, Number(flag(args, '--limit') ?? 20));
    print(json, hits.map((e) => ({ path: e.path, ...e.member })), () =>
      hits.length ? hits.map((e) => formatEntry(e, false) + (e.member.doc ? `\n  ${e.member.doc.split('\n')[0].slice(0, 160)}` : '')).join('\n') : `No API members match "${words}".`,
    );
    return hits.length ? 0 : 1;
  };
  if (has(args, '--search')) return doSearch(q);
  const r = lookup(q);
  switch (r.kind) {
    case 'entries':
      print(json, r.entries.map((e) => ({ path: e.path, ...e.member })), () => r.entries.map((e) => formatEntry(e)).join('\n\n'));
      return 0;
    case 'enum':
      print(json, r, () => `enum Nucleus.${r.name}${r.doc ? ` - ${r.doc}` : ''}\n` + Object.entries(r.values).map(([k, v]) => `  Nucleus.${r.name}.${k} = ${v}`).join('\n'));
      return 0;
    case 'class':
      print(json, r, () => `new Nucleus.${r.name}(${r.params.join(', ')})\n  ${r.doc}`);
      return 0;
    case 'none':
      if (!json) console.log(`"${q}" is not part of the Nucleus handler API.${r.didYouMean ? ` Did you mean ${r.didYouMean}?` : ''} Searching docs instead:\n`);
      doSearch(q);
      return 1;
  }
}

async function cmdHub(args: Args, json: boolean): Promise<number> {
  const [sub, ...rest] = args.positional;
  const list = await fetchHandlers();
  if (sub === 'search') {
    const words = rest.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) throw new Usage('hub search: give some words, e.g. "hub search halo"');
    // Rank by how many words match (title/game name count double), then popularity.
    const hits = list
      .map((h) => {
        const title = `${h.title} ${h.gameName}`.toLowerCase();
        const rest = `${h.ownerName} ${h.description ?? ''}`.toLowerCase();
        const score = words.reduce((n, w) => n + (title.includes(w) ? 2 : rest.includes(w) ? 1 : 0), 0);
        return { h, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.h.downloadCount ?? 0) - (a.h.downloadCount ?? 0))
      .map((x) => x.h)
      .slice(0, Number(flag(args, '--limit') ?? 15));
    print(
      json,
      hits.map((h) => ({ id: h._id, title: h.title, gameName: h.gameName, owner: h.ownerName, downloads: h.downloadCount, verified: h.verified, version: h.currentVersion, maxPlayers: h.maxPlayers, multipleKeyboardsAndMice: h.playableMultiMouseKeyboard, url: handlerPageUrl(h._id) })),
      () =>
        hits.length
          ? hits.map((h) => `${h._id}  ${h.title}${h.verified ? ' (verified)' : ''} - by ${h.ownerName}, ${h.downloadCount ?? 0} downloads${h.playableMultiMouseKeyboard ? ', multi KB/M' : ''}`).join('\n') +
            '\n\nFetch one with: nucleus hub fetch <id>'
          : 'No handlers found.',
    );
    return hits.length ? 0 : 1;
  }
  if (sub === 'fetch') {
    const key = rest.join(' ');
    if (!key) throw new Usage('hub fetch: give a handler id (from "nucleus hub search")');
    const h: HubHandler | undefined = list.find((x) => x._id === key) ?? list.find((x) => x.title.toLowerCase() === key.toLowerCase());
    if (!h) throw new Error(`No handler with id or title "${key}"`);
    const out = flag(args, '--out') ?? path.join('hub-handlers', toHandlerFileName(h.title));
    const files = extractEntries(await downloadPackage(h), out);
    print(json, { id: h._id, title: h.title, dir: path.resolve(out), files }, () => `Extracted ${h.title} v${h.currentVersion} to ${path.resolve(out)}:\n` + files.map((f) => `  ${f}`).join('\n'));
    return 0;
  }
  throw new Usage('hub: use "hub search <words>" or "hub fetch <id>"');
}

function cmdNew(args: Args, json: boolean): number {
  const name = flag(args, '--name');
  const exe = flag(args, '--exe');
  if (!name || !exe) throw new Usage('new: --name and --exe are required');
  const features = (flag(args, '--features') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = features.filter((f) => !FEATURES.some((x) => x.id === f));
  if (bad.length) throw new Usage(`Unknown feature(s): ${bad.join(', ')}. Available: ${FEATURES.map((f) => f.id).join(', ')}`);
  const out = flag(args, '--out') ?? `${toHandlerFileName(name)}.js`;
  if (fs.existsSync(out) && !has(args, '--force')) throw new Error(`${out} already exists (use --force to overwrite)`);
  const maxPlayers = flag(args, '--max-players');
  fs.writeFileSync(out, renderHandler({ gameName: name, executableName: exe, steamId: flag(args, '--steam-id'), maxPlayers: maxPlayers ? Number(maxPlayers) : undefined, features: features as Feature[] }));
  print(json, { file: path.resolve(out) }, () => `Created ${out}`);
  return 0;
}

function cmdPackage(args: Args, json: boolean): number {
  const file = args.positional[0];
  if (!file?.endsWith('.js')) throw new Usage('package: give the handler .js file');
  const errors = lint(fs.readFileSync(file, 'utf8')).filter((d) => d.severity === 'error');
  if (errors.length && !has(args, '--force')) throw new Error(`${file} has ${errors.length} lint error(s); fix them or pass --force. Run "nucleus lint ${file}".`);
  const out = flag(args, '--out') ?? file.replace(/\.js$/, '.nc');
  const { zip, assetCount } = buildPackage(file);
  fs.writeFileSync(out, zip);
  print(json, { file: path.resolve(out), assetCount }, () => `Wrote ${out} (handler.js + ${assetCount} asset file(s)). Upload it at https://hub.splitscreen.me/`);
  return 0;
}

function cmdInitAgent(args: Args, json: boolean): number {
  const target = path.resolve(args.positional[0] ?? '.');
  const skillDir = findSkillDir(__dirname);
  if (!skillDir) throw new Error('Could not find the nucleus-handler skill files next to this tool.');
  if (path.resolve(skillDir).startsWith(path.join(target, '.claude', 'skills'))) throw new Error('Already installed here.');
  const r = installAgentKit(skillDir, target);
  print(json, r, () =>
    [
      `Agent kit installed in ${target}`,
      ...r.created.map((f) => `  created ${f}`),
      ...r.updated.map((f) => `  updated ${f}`),
      '',
      'Agents can now run: node .claude/skills/nucleus-handler/scripts/nucleus.js lint <handler.js>',
    ].join('\n'),
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error(e instanceof Usage ? `${e.message}\n\nRun "nucleus --help" for usage.` : `Error: ${e?.message ?? e}`);
    process.exitCode = e instanceof Usage ? 2 : 1;
  },
);
