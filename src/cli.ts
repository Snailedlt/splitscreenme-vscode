// `ncdev` (Nucleus Co-op dev tools): command-line tools for Nucleus Co-op handlers, for people, CI and AI agents.
// Also a standalone .exe (#18, scripts/sea.mjs). `nucleus` is its old name and still works; `nucleus-lint <paths>`
// is kept as a shortcut for `ncdev lint <paths>`.
import { installHandler } from './install';
import { AFTER_START, debugLogOn, debugLogPath, nucleusStatus, setDebugLog, stopNucleus, testInNucleus } from './nucleusrun';
import { lintPluginsFor } from './plugins';
import { checkPackage } from './core/pkgcheck';
import { packageFilesFor } from './pkgfiles';
import { publishedFor } from './published';
import fs from 'node:fs';
import path from 'node:path';
import { lint, lineOf, lineStart, RULES, RuleId, Severity, LintOptions, looksLikeHandler } from './core/lint';
import { fixAll } from './core/fix';
import { formatHandler } from './core/format';
import { lookup, search, formatEntry, formatObject, markdownReference } from './core/lookup';
import { handlerPageUrl, HubHandler } from './core/hub';
import { hubHandlers, hubPackage } from './hubcache';
import { renderHandler, toHandlerFileName, validateHandlerInfo, FEATURES, Feature } from './core/templates';
import { buildPackage, extractEntries, findSkillDir, installAgentKit } from './core/pkg';
import { pluginsFor, simulateIsolated } from './sandbox';
import { parseBreakpoint, runDebug } from './debugrun';
import { ruleDocText } from './core/airules';
import { ruleUrl } from './core/ruledocs';
import { explainLine } from './core/features';
import { serveDap } from './dap';
import { setupNotepadPP } from './setup-npp';
import { runElevated, runMenu, startedFromExplorer } from './winhelp';
import { builtIn, installPath, installRelease, installSelf, isStandalone, latestRelease, newer, TOOL, VERSION } from './standalone';
import os from 'node:os';
import { EVERY_KEYBOARD } from './core/sim';
import { formatSimulation } from './simformat';
import { serve } from './mcp';
import { serve as serveLsp } from './lsp';

const HELP = `ncdev ${VERSION}: Nucleus Co-op dev tools (\`nucleus\` is the old name and still works)

Usage: ncdev <command> [options]

Commands:
  lint <file|dir>...          Check handlers for problems (default command)
  format <file|dir>... [--write | --check] [--quotes double|single|keep] [--semicolons add|keep]
                              Indentation, spacing, double quotes and semicolons (no line moves;
                              the program parses the same, or nothing changes). Prints the result
                              for one file; --write saves, --check lists the files that aren't
                              formatted and exits 1
  api <name>                  Show the type and docs of an API member, e.g. "Game.KillMutex",
                              "Context.ModifySaveFile", "KillMutex", "Nucleus.Folder"
  api --search <words>        Search API names and docs, e.g. "api --search mutex"
  api --markdown              Print the full API reference as Markdown
  simulate <handler.js> [--players N] [--resolution 1920x1080] [--keyboard 1|all|none]
                              "Try it": load the handler and run Game.Play for each player the
                              way Nucleus would (emulating its Jint engine), without Nucleus or
                              the game. Shows each player's window, launch arguments and file
                              changes. File, registry and process calls are recorded, never
                              performed, and the handler has no access to this computer.
  debug <handler.js> [--break <line>[ if <condition>]]... [--watch <expr>]... [--step]
        [--players N] [--resolution 1920x1080] [--keyboard 1|all|none]
                              Run the handler as simulate does and print where it stops: at each
                              breakpoint (e.g. --break "14 if Context.PlayerID == 1"), and where an
                              error ends a phase, with the variables, the call stack and the
                              --watch values. --step prints every line it runs instead
  hub search <words>          Search handlers on hub.splitscreen.me (--popular: the most downloaded)
  hub fetch <id> [--out dir]  Download a Hub handler package and extract it (default ./hub-handlers/<title>)
  new --name <game> --exe <file.exe> [--steam-id N] [--max-players N]
      [--features ${FEATURES.map((f) => f.id).join(',')}] [--out file.js] [--force]
                              Create a handler from a template (--list-features: the features)
  test <handler.js> --nucleus <folder> [--restart] [--debug-log on|off] [--force] [--status]
                              Test in Nucleus Co-op (Windows): install the handler, then start
                              Nucleus with its game selected. --restart closes a running Nucleus
                              first (it reads handlers when it starts); --debug-log sets Nucleus'
                              debug log; --status only says whether it's running and the log's on
  install <handler.js> --nucleus <folder> [--force]
                              Copy the handler (and its <Name>/ folder) into Nucleus Co-op's
                              handlers folder. --force replaces an installed one and installs
                              despite errors
  package <handler.js> [--out file.nc] [--force]
                              Build a Hub package (handler.js + the <Name>/ asset folder)
  init-agent [dir]            Install AI agent instructions and this tool into a handler folder
                              (AGENTS.md, CLAUDE.md, .claude/skills/nucleus-handler/)
  rules [<id>]                List lint rules; with an id, that check explained (why, fix, examples)
  explain <handler.js> --line N
                              What line N does, in plain words: its names' docs and its problems
  workbench [--out file.html] [--force]
                              Save the browser workbench as one offline HTML file (from the newest
                              release), to open locally or host yourself
  mcp                         Run as an MCP server (stdio) for AI agents: Claude Desktop, Cursor,
                              VS Code Copilot, ... Tools: lint, fix, simulate, API lookup/search,
                              templates, Hub search and verified Hub handlers
  lsp [--stdio]               Run as a Language Server (stdio) for other editors: Neovim, Helix,
                              Zed, Sublime Text, Emacs, JetBrains (LSP4IJ), Kate, ... (PORTING.md)
  setup notepad++ [--path <folder>] [--check] [--remove]
                              Set up Notepad++ for handlers: the Nucleus plugin (problems in the
                              code, docs on hover, suggestions, fixes, Try it) with the standalone
                              ncdev, else the names and call tips in its own list; and a Run menu
                              entry that checks the open handler. --remove undoes it. Asks Windows
                              for permission when Notepad++ is in Program Files. (Double-clicking
                              ncdev.exe shows a menu with this.)
  update [--check]            Update ncdev to the newest release (the standalone ncdev replaces
                              itself, checked against the release's SHA-256 sums). --check only
                              says whether there is one (exit code 10 if so)
  --version                   Show the version
  dap                         Run as a Debug Adapter (stdio) for editors with DAP support: nvim-dap,
                              Helix, Zed, JetBrains, Emacs (dape) (PORTING.md, "Debugging")

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
  --hub                       Compare Game.GUID with the version on the Hub (handlers with a Hub.Handler.Id; cached)

Exit code: 1 when lint finds errors, a simulated handler fails to load or run, or a command
fails; 2 on bad usage.

Questions? Ask other handler authors: https://discord.gg/XxGMkqCf4r (Discord) or
https://www.reddit.com/r/nucleuscoop/`;

class Usage extends Error {}

interface Args {
  positional: string[];
  flags: Map<string, string[]>;
}
const BOOL_FLAGS = new Set(['--elevated', '--version', '-v', '--from-notepad++', '--step', '--json', '--stdio', '--all', '--quiet', '--verbose', '--force', '--search', '--markdown', '--fix', '--fix-dry-run', '--hub', '--write', '--check', '--remove', '--list-features', '--popular', '--restart', '--status', '-h', '--help']);
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
  // Double-clicked in Explorer: a short menu that waits for a key (its window closes when ncdev exits). From a
  // terminal, no arguments still print the help and exit; only the no-arguments case takes the moment to tell.
  if (!argv.length && isStandalone() && startedFromExplorer()) {
    const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await runMenu(
        { ask: (q) => new Promise((res) => rl.question(q, res)), say: (t) => console.log(t) },
        { setup: () => cmdSetup(parseArgs(['notepad++']), false), update: () => cmdUpdate(parseArgs([]), false), help: () => console.log(HELP) },
        VERSION,
      );
    } finally {
      rl.close();
    }
  }
  const commands = ['lint', 'format', 'simulate', 'api', 'hub', 'new', 'install', 'test', 'package', 'init-agent', 'rules', 'mcp', 'lsp', 'dap', 'setup', 'workbench', 'debug', 'explain', 'update', 'version'];
  let cmd = argv[0] && commands.includes(argv[0]) ? argv.shift()! : undefined;
  if (!cmd && (argv[0] === '--version' || argv[0] === '-v')) cmd = 'version';
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
      if (args.positional[0]) {
        const t = ruleDocText(args.positional[0], 'ncdev');
        if (!t) throw new Usage(`rules: no check called "${args.positional[0]}" (ncdev rules lists them)`);
        print(json, { id: args.positional[0], ...(RULES as any)[args.positional[0]], docs: ruleUrl(args.positional[0], 'ncdev') }, () => t);
        return 0;
      }
      print(json, RULES, () => Object.entries(RULES).map(([id, r]) => `${id.padEnd(22)} ${r.severity.padEnd(8)} ${r.description}`).join('\n'));
      return 0;
    case 'format':
      return cmdFormat(args, json);
    case 'simulate':
      return cmdSimulate(args, json);
    case 'debug':
      return cmdDebug(args, json);
    case 'explain':
      return cmdExplain(args, json);
    case 'api':
      return cmdApi(args, json);
    case 'hub':
      return cmdHub(args, json);
    case 'new':
      return cmdNew(args, json);
    case 'install':
      return cmdInstall(args, json);
    case 'test':
      return cmdTest(args, json);
    case 'package':
      return cmdPackage(args, json);
    case 'init-agent':
      return cmdInitAgent(args, json);
    case 'mcp':
      return serve();
    case 'lsp':
      // Exit when the client says so, even with a Hub lookup or a lint timer still pending.
      return serveLsp().then((code) => process.exit(code));
    case 'setup':
      return cmdSetup(args, json);
    case 'version':
      return cmdVersion(json);
    case 'update':
      return cmdUpdate(args, json);
    case 'dap':
      // A Debug Adapter on stdio, for editors with DAP support (nvim-dap, Helix, Zed, JetBrains, Emacs dape).
      return serveDap().then((code) => process.exit(code));
    case 'workbench':
      return cmdWorkbench(args, json);
  }
  return 2;
}

// ---------------------------------------------------------------------------

async function cmdLint(args: Args, json: boolean): Promise<number> {
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
    const fileOptions = { ...options, plugins: lintPluginsFor(file), published: has(args, '--hub') ? await publishedFor(text) : undefined };
    if (fixMode) {
      const r = fixAll(text, fileOptions);
      fixed = r.applied;
      if (r.code !== text) {
        if (fixMode === 'write') fs.writeFileSync(file, (original.startsWith('﻿') ? '﻿' : '') + r.code);
        text = r.code;
      }
    }
    const diags = lint(text, fileOptions).filter((d) => (quiet ? d.severity === 'error' : verbose || d.severity !== 'hint'));
    for (const d of diags) {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    }
    const withPos = diags.map((d) => ({ ...d, line: lineOf(text, d.start) + 1, column: d.start - lineStart(text, d.start) + 1 }));
    // The handler's folder (<Name>/ next to <Name>.js), as it goes into the .nc: core/pkgcheck.ts.
    const pkgFiles = packageFilesFor(file, 0);
    const pkg = (pkgFiles ? checkPackage(text, pkgFiles) : []).filter((p) => (quiet ? p.severity === 'error' : true));
    for (const p of pkg) {
      if (p.severity === 'error') errors++;
      else if (p.severity === 'warning') warnings++;
    }
    const pkgOut = pkg.map((p) => ({ file: p.file ?? null, line: p.line ?? (p.start !== undefined ? lineOf(text, p.start) + 1 : null), severity: p.severity, message: `${p.title}. ${p.why}`, rule: 'package' }));
    fixedCount += fixed.length;
    if (json) {
      out.push({ file, ...(fixMode ? { fixed } : {}), diagnostics: withPos, ...(pkgOut.length ? { package: pkgOut } : {}) });
      continue;
    }
    if (!diags.length && !fixed.length && !pkgOut.length) continue;
    console.log(file);
    for (const f of fixed) console.log(`  ${`${f.line}`.padEnd(9)} ${(fixMode === 'dry' ? 'would fix' : 'fixed').padEnd(8)} ${f.title}  [${f.rule}]`);
    for (const d of withPos) {
      console.log(`  ${`${d.line}:${d.column}`.padEnd(9)} ${d.severity.padEnd(8)} ${d.message}  [${d.rule}]`);
      for (const f of d.fixes ?? []) console.log(`  ${''.padEnd(9)} ${''.padEnd(8)} fix: ${f.title}`);
    }
    for (const p of pkgOut) console.log(`  ${(p.file ? `${p.file}${p.line ? `:${p.line}` : ''}` : `${p.line ?? ''}`).padEnd(9)} ${p.severity.padEnd(8)} ${p.message}  [package]`);
    console.log();
  }
  if (json) console.log(JSON.stringify({ files: out, errors, warnings, ...(fixMode ? { fixed: fixedCount } : {}) }, null, 2));
  else console.log(`${linted} handler(s): ${fixMode ? `${fixedCount} problem(s) ${fixMode === 'dry' ? 'would be fixed' : 'fixed'}, ` : ''}${errors} error(s)${fixMode ? ' left' : ''}, ${warnings} warning(s)${fixMode ? ' left' : ''}`);
  return errors ? 1 : 0;
}

function cmdFormat(args: Args, json: boolean): number {
  const files: string[] = [];
  const collect = (p: string, explicit: boolean) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) collect(path.join(p, f), false);
    else if (explicit || (p.endsWith('.js') && looksLikeHandler(fs.readFileSync(p, 'utf8')))) files.push(p);
  };
  if (!args.positional.length) throw new Usage('format: give at least one file or directory');
  for (const p of args.positional) collect(p, true);
  const write = has(args, '--write');
  const checkOnly = has(args, '--check');
  const results: { file: string; ok: boolean; changed?: boolean; reason?: string }[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const quotes = flag(args, '--quotes');
    const semicolons = flag(args, '--semicolons');
    if (quotes && !['double', 'single', 'keep'].includes(quotes)) throw new Usage('--quotes: double, single or keep');
    if (semicolons && !['add', 'keep'].includes(semicolons)) throw new Usage('--semicolons: add or keep');
    const r = formatHandler(text, { quotes: quotes as 'double' | 'single' | 'keep' | undefined, semicolons: semicolons as 'add' | 'keep' | undefined });
    if (!r.ok) {
      results.push({ file, ok: false, reason: r.reason });
      continue;
    }
    results.push({ file, ok: true, changed: r.changed });
    if (write && r.changed) fs.writeFileSync(file, r.code);
    else if (!write && !checkOnly && !json && files.length === 1) process.stdout.write(r.code);
  }
  const bad = results.filter((r) => !r.ok);
  const unformatted = results.filter((r) => r.ok && r.changed);
  if (json) console.log(JSON.stringify(results, null, 2));
  else if (write || checkOnly || files.length > 1) {
    for (const r of bad) console.log(`${r.file}: not formatted: ${r.reason}`);
    for (const r of unformatted) console.log(`${r.file}${write ? ': formatted' : checkOnly ? ': not formatted' : ''}`);
    console.log(`${files.length} file(s): ${unformatted.length} ${write ? 'formatted' : 'to format'}${bad.length ? `, ${bad.length} skipped` : ''}`);
  } else if (bad.length) console.error(bad[0].reason);
  return bad.length || (checkOnly && unformatted.length) ? 1 : 0;
}

function simArgs(args: Args, cmd: string) {
  const file = args.positional[0];
  if (!file || args.positional.length > 1) throw new Usage(`${cmd}: give one handler file`);
  const players = Number(flag(args, '--players') ?? 2);
  if (!Number.isInteger(players) || players < 1 || players > 16) throw new Usage('--players must be 1 to 16');
  const res = (flag(args, '--resolution') ?? '1920x1080').match(/^(\d+)x(\d+)$/);
  if (!res) throw new Usage('--resolution must look like 1920x1080');
  const kbArg = flag(args, '--keyboard') ?? '1';
  // all: every player has their own keyboard and mouse (Nucleus' multiple keyboards and mice mode)
  const keyboardPlayer = kbArg === 'none' ? -1 : kbArg === 'all' ? EVERY_KEYBOARD : Number(kbArg) - 1;
  if (kbArg !== 'none' && kbArg !== 'all' && (!Number.isInteger(keyboardPlayer) || keyboardPlayer < 0 || keyboardPlayer >= players)) throw new Usage(`--keyboard must be a player number (1-${players}), "all" (each player their own) or "none"`);
  const src = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return { file, src, keyboardPlayer, opts: { players, width: Number(res[1]), height: Number(res[2]), keyboardPlayer, plugins: pluginsFor(file) } };
}

function cmdSimulate(args: Args, json: boolean): number {
  const { file, src, keyboardPlayer, opts } = simArgs(args, 'simulate');
  const r = simulateIsolated(src, opts);
  const failed = !r.loaded || r.players.some((p) => p.error) || r.callbacks.some((c) => c.error);
  print(json, { file, ...r }, () => formatSimulation(r, keyboardPlayer));
  return failed ? 1 : 0;
}

function cmdExplain(args: Args, json: boolean): number {
  const file = args.positional[0];
  const n = Number(flag(args, '--line'));
  if (!file || args.positional.length > 1 || !Number.isInteger(n) || n < 1) throw new Usage('explain: give one handler file and --line N');
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  if (n > lines.length) throw new Usage(`explain: ${file} has ${lines.length} lines`);
  const offset = lines.slice(0, n - 1).reduce((o, l) => o + l.length + 1, 0) + (lines[n - 1].length - lines[n - 1].trimStart().length);
  const e = explainLine(text, offset);
  print(json, { file, line: n, text: e?.text ?? '', markdown: e?.markdown ?? '' }, () => e?.markdown ?? `Line ${n} is empty.`);
  return 0;
}

function cmdDebug(args: Args, json: boolean): number {
  const { file, src, opts } = simArgs(args, 'debug');
  const breakpoints = (args.flags.get('--break') ?? []).map((b) => {
    const bp = parseBreakpoint(b);
    if (!bp) throw new Usage(`--break must be a line number, optionally with a condition: --break "14 if Context.PlayerID == 1" (got "${b}")`);
    return bp;
  });
  const r = runDebug(src, opts, { breakpoints, watches: args.flags.get('--watch') ?? [], step: has(args, '--step') });
  print(json, { file, ...r.data }, () => r.text);
  return r.failed ? 1 : 0;
}

function cmdApi(args: Args, json: boolean): number {
  if (has(args, '--markdown')) {
    console.log(markdownReference());
    return 0;
  }
  const q = args.positional.join(' ');
  if (!q) throw new Usage('api: give a name, e.g. "ncdev api Game.KillMutex", or --search <words>');
  const doSearch = (words: string) => {
    const hits = search(words, Number(flag(args, '--limit') ?? 20));
    print(json, hits.map((e) => ({ path: e.path, ...e.member })), () =>
      hits.length ? hits.map((e) => formatEntry(e, false) + (e.member.doc ? `\n  ${e.member.doc.split('\n')[0].slice(0, 160)}` : '')).join('\n') : `No API members match "${words}".`,
    );
    return hits.length ? 0 : 1;
  };
  if (has(args, '--search')) return doSearch(q);
  const r = lookup(q, { objects: true });
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
    case 'object':
      print(json, { path: r.path, doc: r.doc, members: r.members.map((e) => ({ path: e.path, ...e.member })), children: r.children }, () => formatObject(r));
      return 0;
    case 'none':
      if (!json) console.log(`"${q}" is not part of the Nucleus handler API.${r.didYouMean ? ` Did you mean ${r.didYouMean}?` : ''} Searching docs instead:\n`);
      doSearch(q);
      return 1;
  }
}

async function cmdHub(args: Args, json: boolean): Promise<number> {
  const [sub, ...rest] = args.positional;
  const feature = sub === 'fetch' ? 'hub-fetch' : sub === 'search' ? (has(args, '--popular') && !rest.length ? 'hub-popular' : 'hub-search') : 'hub-list';
  const list = await hubHandlers({ feature });
  if (sub === 'search') {
    const words = rest.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length && !has(args, '--popular')) throw new Usage('hub search: give some words, e.g. "hub search halo" (or --popular for the most downloaded)');
    // Rank by how many words match (title/game name count double), then popularity.
    const hits = list
      .map((h) => {
        const title = `${h.title} ${h.gameName}`.toLowerCase();
        const rest = `${h.ownerName} ${h.description ?? ''}`.toLowerCase();
        const score = words.length ? words.reduce((n, w) => n + (title.includes(w) ? 2 : rest.includes(w) ? 1 : 0), 0) : 1;
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
            '\n\nFetch one with: ncdev hub fetch <id>'
          : 'No handlers found.',
    );
    return hits.length ? 0 : 1;
  }
  if (sub === 'fetch') {
    const key = rest.join(' ');
    if (!key) throw new Usage('hub fetch: give a handler id (from "ncdev hub search")');
    const h: HubHandler | undefined = list.find((x) => x._id === key) ?? list.find((x) => x.title.toLowerCase() === key.toLowerCase());
    if (!h) throw new Error(`No handler with id or title "${key}"`);
    const out = flag(args, '--out') ?? path.join('hub-handlers', toHandlerFileName(h.title));
    const files = extractEntries(await hubPackage(h, { feature: 'hub-fetch' }), out);
    print(json, { id: h._id, title: h.title, dir: path.resolve(out), files }, () => `Extracted ${h.title} v${h.currentVersion} to ${path.resolve(out)}:\n` + files.map((f) => `  ${f}`).join('\n'));
    return 0;
  }
  throw new Usage('hub: use "hub search <words>" or "hub fetch <id>"');
}

function cmdNew(args: Args, json: boolean): number {
  if (has(args, '--list-features')) {
    print(json, FEATURES, () => FEATURES.map((f) => `${f.id.padEnd(16)}${f.label}: ${f.detail}`).join('\n'));
    return 0;
  }
  const name = flag(args, '--name');
  const exe = flag(args, '--exe');
  if (!name || !exe) throw new Usage('new: --name and --exe are required');
  const features = (flag(args, '--features') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const problems = validateHandlerInfo({ gameName: name, executableName: exe, steamId: flag(args, '--steam-id'), maxPlayers: flag(args, '--max-players'), features });
  if (problems.length) throw new Usage(`new: ${problems.map((p) => p.replace(/^gameName:/, '--name:').replace(/^executableName:/, '--exe:').replace(/^steamId:/, '--steam-id:').replace(/^maxPlayers:/, '--max-players:').replace(/^features:/, '--features:')).join('\n     ')}`);
  const out = flag(args, '--out') ?? `${toHandlerFileName(name)}.js`;
  if (fs.existsSync(out) && !has(args, '--force')) throw new Error(`${out} already exists (use --force to overwrite)`);
  const maxPlayers = flag(args, '--max-players');
  fs.writeFileSync(out, renderHandler({ gameName: name, executableName: exe, steamId: flag(args, '--steam-id'), maxPlayers: maxPlayers ? Number(maxPlayers) : undefined, features: features as Feature[] }));
  print(json, { file: path.resolve(out) }, () => `Created ${out}`);
  return 0;
}

function cmdInstall(args: Args, json: boolean): number {
  const file = args.positional[0];
  if (!file?.endsWith('.js')) throw new Usage('install: give the handler .js file');
  const nucleus = flag(args, '--nucleus');
  if (!nucleus) throw new Usage('install: --nucleus <folder> is required (the Nucleus Co-op folder, with NucleusCoop.exe and handlers)');
  const errors = lint(fs.readFileSync(file, 'utf8')).filter((d) => d.severity === 'error');
  if (errors.length && !has(args, '--force')) throw new Error(`${file} has ${errors.length} lint error(s), so Nucleus may not load it; fix them or pass --force. Run "ncdev lint ${file}".`);
  const { dest, assets } = installHandler(file, nucleus, { overwrite: has(args, '--force') });
  print(json, { file: dest, assetCount: assets }, () => `Installed ${path.basename(dest)}${assets ? ` and ${assets} asset file(s)` : ''} to ${path.dirname(dest)}. Restart Nucleus Co-op (or re-add the game) to pick it up.`);
  return 0;
}

async function cmdTest(args: Args, json: boolean): Promise<number> {
  const nucleus = flag(args, '--nucleus');
  if (!nucleus) throw new Usage('test: --nucleus <folder> is required (the Nucleus Co-op folder, with NucleusCoop.exe and handlers)');
  const status = nucleusStatus(nucleus);
  if (has(args, '--status')) {
    print(json, status, () => `${status.canStart ? (status.running ? 'Nucleus Co-op is running.' : 'Nucleus Co-op is not running.') : status.why}\nDebug log: ${status.debugLog === undefined ? 'no Settings.ini yet' : status.debugLog ? 'on' : 'off'}`);
    return 0;
  }
  const file = args.positional[0];
  if (!file?.endsWith('.js')) throw new Usage('test: give the handler .js file');
  if (!status.canStart) throw new Error(status.why);
  const errors = lint(fs.readFileSync(file, 'utf8')).filter((d) => d.severity === 'error');
  if (errors.length && !has(args, '--force')) throw new Error(`${file} has ${errors.length} lint error(s), so Nucleus may not load it; fix them or pass --force. Run "ncdev lint ${file}".`);
  if (status.running) {
    if (!has(args, '--restart')) {
      if (json) print(json, { started: false, running: true }, () => '');
      else console.error('Nucleus Co-op is running and only reads handlers when it starts: close it, or pass --restart.');
      return 3;
    }
    await stopNucleus();
  }
  const log = flag(args, '--debug-log');
  if (log === 'on' || log === 'off') setDebugLog(nucleus, log === 'on');
  const r = testInNucleus(file, nucleus);
  print(json, { started: true, file: r.dest, guid: r.guid, debugLog: debugLogOn(nucleus), log: debugLogPath(nucleus) }, () => `${AFTER_START}\nDebug log: ${debugLogOn(nucleus) ? debugLogPath(nucleus) : 'off (--debug-log on turns it on)'}`);
  return 0;
}

function cmdPackage(args: Args, json: boolean): number {
  const file = args.positional[0];
  if (!file?.endsWith('.js')) throw new Usage('package: give the handler .js file');
  const errors = lint(fs.readFileSync(file, 'utf8')).filter((d) => d.severity === 'error');
  if (errors.length && !has(args, '--force')) throw new Error(`${file} has ${errors.length} lint error(s); fix them or pass --force. Run "ncdev lint ${file}".`);
  const out = flag(args, '--out') ?? file.replace(/\.js$/, '.nc');
  const { zip, assetCount } = buildPackage(file);
  fs.writeFileSync(out, zip);
  print(json, { file: path.resolve(out), assetCount }, () => `Wrote ${out} (handler.js + ${assetCount} asset file(s)). Upload it at https://hub.splitscreen.me/`);
  return 0;
}

/** Saves the newest release's workbench.html: the whole browser workbench in one offline file. */
async function cmdWorkbench(args: Args, json: boolean): Promise<number> {
  const out = flag(args, '--out') ?? 'nucleus-workbench.html';
  if (fs.existsSync(out) && !has(args, '--force')) throw new Error(`${out} already exists (use --force to overwrite)`);
  // The newest release with the file, pre-releases included. If the API is unavailable (rate
  // limits), fall back to the newest full release's download link.
  let rel = { tag_name: 'the latest release', url: 'https://github.com/Snailedlt/splitscreenme-vscode/releases/latest/download/workbench.html' };
  const res = await fetch('https://api.github.com/repos/Snailedlt/splitscreenme-vscode/releases?per_page=20', { headers: { accept: 'application/vnd.github+json' } }).catch(() => undefined);
  if (res?.ok) {
    const releases = (await res.json()) as { tag_name: string; draft: boolean; assets: { name: string; browser_download_url: string }[] }[];
    const r = releases.find((x) => !x.draft && x.assets.some((a) => a.name === 'workbench.html'));
    if (!r) throw new Error('No release has a workbench.html yet. Use https://snailedlt.github.io/nucleuscoop-handler-testbench/ for now.');
    rel = { tag_name: r.tag_name, url: r.assets.find((a) => a.name === 'workbench.html')!.browser_download_url };
  }
  const page = await fetch(rel.url);
  if (page.status === 404) throw new Error('No release has a workbench.html yet. Use https://snailedlt.github.io/nucleuscoop-handler-testbench/ for now.');
  if (!page.ok) throw new Error(`Download failed (${page.status})`);
  const html = await page.text();
  if (!/^<!doctype html>/i.test(html.trimStart())) throw new Error('The download is not an HTML page.');
  fs.writeFileSync(out, html);
  print(json, { file: path.resolve(out), release: rel.tag_name, bytes: html.length }, () => `Saved the workbench from ${rel.tag_name} to ${path.resolve(out)}. Open it in a browser; it works offline.`);
  return 0;
}

/** The standalone ncdev carries the skill's files: unpacked into a temporary folder for `init-agent`. */
function builtInSkill(): string | undefined {
  const raw = builtIn('skill.json');
  if (!raw) return undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncdev-skill-'));
  for (const [rel, b64] of Object.entries(JSON.parse(raw.toString('utf8')) as Record<string, string>)) {
    const f = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  }
  return dir;
}

function cmdSetup(args: Args, json: boolean): number {
  const what = (args.positional[0] ?? '').toLowerCase().replace(/\s+/g, '');
  if (!['notepad++', 'notepadpp', 'npp'].includes(what)) {
    // A typo of it (nodepad++, notepad+) gets the right spelling; anything else, what setup can do.
    const near = what && /^no[a-z]*pad|^npp|pad\+/i.test(what);
    throw new Usage(near ? `setup: there is no "${what}". Did you mean: ncdev setup notepad++` : 'setup: only "notepad++" for now, e.g. ncdev setup notepad++');
  }
  const changing = !has(args, '--check') && !has(args, '--remove');
  // The standalone ncdev copies itself to one known place (%LOCALAPPDATA%\ncdev) and installs the plugin, which runs it.
  const standalone = isStandalone();
  const tool = standalone && changing ? installSelf() : standalone ? installPath() : undefined;
  const plugins = standalone ? { x64: builtIn('NcDev.dll'), x86: builtIn('NcDev-x86.dll') } : undefined;
  const runCommand = tool ? `cmd /k ""${tool}" lint "$(FULL_CURRENT_PATH)""` : `cmd /k ""${process.execPath}" "${path.resolve(process.argv[1])}" lint "$(FULL_CURRENT_PATH)""`;
  let r = setupNotepadPP({ path: flag(args, '--path'), remove: has(args, '--remove'), check: has(args, '--check'), runCommand, plugins, toolPath: tool });
  // Notepad++ in Program Files needs administrator rights: ask Windows for them (its permission prompt) and run this
  // same setup again in an elevated copy, rather than sending people to an administrator terminal. That copy writes
  // what it did to a file (its own window closes), and it never asks again.
  const resultFile = flag(args, '--result-file');
  if (r.denied && process.platform === 'win32' && !has(args, '--elevated')) {
    const self = isStandalone() ? [] : [path.resolve(process.argv[1])];
    // The same setup, from what was asked (the double-click menu has no command line to copy).
    const p = flag(args, '--path');
    const again = runElevated(process.execPath, [...self, 'setup', 'notepad++', ...(p ? ['--path', p] : []), ...(has(args, '--remove') ? ['--remove'] : [])]);
    if (again.ran) r = { ok: !!again.ok, lines: again.lines ?? [] };
    else r.lines.unshift("Windows didn't give ncdev permission to write to Notepad++'s folder (the prompt was declined, or couldn't be shown).");
  }
  if (tool && changing && r.ok && !has(args, '--elevated')) r.lines.unshift(`ncdev is in ${path.dirname(tool)} (ncdev update keeps it current).`);
  if (resultFile) fs.writeFileSync(resultFile, JSON.stringify(r));
  print(json, r, () => r.lines.join('\n'));
  return r.ok ? 0 : 1;
}

async function cmdVersion(json: boolean): Promise<number> {
  // Only what's already known (a check at most once a day happens in `update --check`), so this stays instant.
  const latest = await latestRelease(false, (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch).catch(() => undefined);
  const update = latest && newer(latest.version, VERSION) ? latest : undefined;
  print(json, { version: VERSION, standalone: isStandalone(), update: update?.tag }, () => `${TOOL} ${VERSION}${update ? `\n${update.tag} is out: run ${TOOL} update` : ''}`);
  return 0;
}

async function cmdUpdate(args: Args, json: boolean): Promise<number> {
  const check = has(args, '--check');
  const quiet = has(args, '--quiet');
  const latest = await latestRelease(!check);
  if (!latest) {
    if (!quiet) print(json, { error: latest === null ? 'none' : 'unreachable' }, () => (latest === null ? `No release has a standalone ${TOOL} yet; ${TOOL} ${VERSION} is what there is.` : 'Couldn\'t reach GitHub to check for a newer version. Try again later.'));
    return check || latest === null ? 0 : 1;
  }
  const isNewer = newer(latest.version, VERSION);
  if (check) {
    if (isNewer || !quiet) print(json, { version: VERSION, latest: latest.tag, update: isNewer }, () => (isNewer ? latest.tag : `${TOOL} ${VERSION} is the newest.`));
    return isNewer ? 10 : 0;
  }
  if (!isNewer) {
    print(json, { version: VERSION, latest: latest.tag, updated: false }, () => `${TOOL} ${VERSION} is the newest (${latest.tag}).`);
    return 0;
  }
  if (!isStandalone()) {
    print(json, { version: VERSION, latest: latest.tag, updated: false }, () =>
      [`${latest.tag} is out (${latest.url}).`, 'This copy runs on Node.js: update it the way you installed it (VS Code updates the extension; or download nucleus.js or ncdev from the release page).'].join('\n'),
    );
    return 0;
  }
  const target = process.execPath;
  await installRelease(latest, target);
  print(json, { version: VERSION, latest: latest.tag, updated: true, path: target }, () =>
    [`Updated ${TOOL} ${VERSION} → ${latest.tag} (${target}).`, has(args, '--from-notepad++') ? 'Notepad++ uses it for the next handler you open.' : '', `What's new: ${latest.url}`].filter(Boolean).join('\n'),
  );
  return 0;
}

function cmdInitAgent(args: Args, json: boolean): number {
  const target = path.resolve(args.positional[0] ?? '.');
  const skillDir = findSkillDir(__dirname) ?? builtInSkill();
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
    // A file that isn't there, or a folder where a file was expected: say so plainly, not with Node's error codes.
    const fileError = e?.code === 'ENOENT' ? `No such file or folder: ${e.path}` : e?.code === 'EISDIR' ? `${e.path} is a folder: give a file.` : undefined;
    console.error(e instanceof Usage ? `${e.message}\n\nRun "${TOOL} --help" for usage.` : `Error: ${fileError ?? e?.message ?? e}`);
    process.exitCode = e instanceof Usage ? 2 : 1;
  },
);
