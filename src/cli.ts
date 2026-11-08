// `nucleus`: command-line tools for Nucleus Co-op handlers, for people, CI and AI agents.
// `nucleus-lint <paths>` is kept as a shortcut for `nucleus lint <paths>`.
import { lintPluginsFor } from './plugins';
import { checkPackage } from './core/pkgcheck';
import { packageFilesFor } from './pkgfiles';
import { publishedFor } from './published';
import fs from 'node:fs';
import path from 'node:path';
import { lint, lineOf, lineStart, RULES, RuleId, Severity, LintOptions, looksLikeHandler } from './core/lint';
import { fixAll } from './core/fix';
import { formatHandler } from './core/format';
import { lookup, search, formatEntry, markdownReference } from './core/lookup';
import { handlerPageUrl, HubHandler } from './core/hub';
import { hubHandlers, hubPackage } from './hubcache';
import { renderHandler, toHandlerFileName, FEATURES, Feature } from './core/templates';
import { buildPackage, extractEntries, findSkillDir, installAgentKit } from './core/pkg';
import { pluginsFor, simulateIsolated, traceIsolated } from './sandbox';
import { nextStop, describeStep, evaluateWatch, callsBefore } from './core/debug';
import { serveDap } from './dap';
import { setupNotepadPP } from './setup-npp';
import type { Stop, ValueView } from './core/debug';
import { EVERY_KEYBOARD } from './core/sim';
import { formatSimulation } from './simformat';
import { serve } from './mcp';
import { serve as serveLsp } from './lsp';

const HELP = `Usage: nucleus <command> [options]

Commands:
  lint <file|dir>...          Check handlers for problems (default command)
  format <file|dir>... [--write | --check]
                              Indentation and spacing only (no line moves, tokens unchanged).
                              Prints the result for one file; --write saves, --check lists the
                              files that aren't formatted and exits 1
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
  workbench [--out file.html] [--force]
                              Save the browser workbench as one offline HTML file (from the newest
                              release), to open locally or host yourself
  mcp                         Run as an MCP server (stdio) for AI agents: Claude Desktop, Cursor,
                              VS Code Copilot, ... Tools: lint, fix, simulate, API lookup/search,
                              templates, Hub search and verified Hub handlers
  lsp [--stdio]               Run as a Language Server (stdio) for other editors: Neovim, Helix,
                              Zed, Sublime Text, Emacs, JetBrains (LSP4IJ), Kate, ... (PORTING.md)
  setup notepad++ [--path <folder>] [--check] [--remove]
                              Add Nucleus names and call tips to Notepad++, and a Run menu entry
                              that checks the open handler (keeps a backup; --remove restores it)
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
fails; 2 on bad usage.`;

class Usage extends Error {}

interface Args {
  positional: string[];
  flags: Map<string, string[]>;
}
const BOOL_FLAGS = new Set(['--step', '--json', '--stdio', '--all', '--quiet', '--verbose', '--force', '--search', '--markdown', '--fix', '--fix-dry-run', '--hub', '--write', '--check', '--remove', '-h', '--help']);
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
  const commands = ['lint', 'format', 'simulate', 'api', 'hub', 'new', 'package', 'init-agent', 'rules', 'mcp', 'lsp', 'dap', 'setup', 'workbench', 'debug'];
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
    case 'format':
      return cmdFormat(args, json);
    case 'simulate':
      return cmdSimulate(args, json);
    case 'debug':
      return cmdDebug(args, json);
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
    case 'mcp':
      return serve();
    case 'lsp':
      // Exit when the client says so, even with a Hub lookup or a lint timer still pending.
      return serveLsp().then((code) => process.exit(code));
    case 'setup': {
      const what = (args.positional[0] ?? '').toLowerCase().replace(/\s+/g, '');
      if (!['notepad++', 'notepadpp', 'npp'].includes(what)) throw new Usage('setup: only "notepad++" for now, e.g. nucleus setup notepad++');
      // The Run menu entry runs this same CLI with the Node that runs it now.
      const runCommand = `cmd /k ""${process.execPath}" "${path.resolve(process.argv[1])}" lint "$(FULL_CURRENT_PATH)""`;
      const r = setupNotepadPP({ path: flag(args, '--path'), remove: has(args, '--remove'), check: has(args, '--check'), runCommand });
      print(json, r, () => r.lines.join('\n'));
      return r.ok ? 0 : 1;
    }
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
    const r = formatHandler(text);
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

function cmdDebug(args: Args, json: boolean): number {
  const { file, src, opts } = simArgs(args, 'debug');
  const breakpoints = (args.flags.get('--break') ?? []).map((b) => {
    const m = /^\s*(\d+)\s*(?:if\s+(.+))?$/s.exec(b);
    if (!m) throw new Usage(`--break must be a line number, optionally with a condition: --break "14 if Context.PlayerID == 1" (got "${b}")`);
    return { line: Number(m[1]), ...(m[2] ? { condition: m[2].trim() } : {}) };
  });
  const watches = args.flags.get('--watch') ?? [];
  const trace = traceIsolated(src, opts);
  const stops: Stop[] = [];
  const MAX_STOPS = 200;
  for (let s = nextStop(trace, -1, { mode: has(args, '--step') ? 'into' : 'continue', breakpoints, stopOnErrors: true }); s && stops.length < MAX_STOPS; ) {
    stops.push(s);
    s = nextStop(trace, s.index, { mode: has(args, '--step') ? 'into' : 'continue', breakpoints, stopOnErrors: true });
  }
  const show = (v: ValueView) => `${v.text}${v.type === '.NET' || v.type === 'function' || v.type === 'null' || v.type === 'undefined' || v.type === 'default' ? '' : ` (${v.type})`}`;
  const items = stops.map((s) => {
    const step = trace.steps[s.index];
    return { ...s, step, description: describeStep(step), watches: watches.map((w) => ({ expr: w, ...evaluateWatch(trace, s.index, w) })), did: callsBefore(trace, s.index).filter((c) => c.effect).map((c) => c.effect!) };
  });
  print(json, { file, stops: items, steps: trace.steps.length, truncated: trace.truncated, truncatedPhases: trace.truncatedPhases, error: trace.error, result: trace.result }, () => {
    const out: string[] = [];
    if (trace.error && !trace.steps.length) out.push(trace.error);
    for (const it of items) {
      out.push(`${it.description}${it.conditionError ? ` (the breakpoint's condition failed: ${it.conditionError})` : ''}`);
      const locals = Object.entries(it.step.locals);
      if (locals.length) out.push(`  Variables: ${locals.map(([k, v]) => `${k} = ${show(v)}`).join(', ')}`);
      if (it.step.stack.length > 1) out.push(`  Call stack: ${it.step.stack.map((f) => `${f.name} (line ${f.line})`).join(' < ')}`);
      for (const w of it.watches) out.push(`  ${w.expr} = ${w.error ? `(${w.error})` : show(w.value!)}`);
      if (it.did.length && !has(args, '--step')) out.push(`  So far: ${it.did.join('; ')}`);
    }
    if (!items.length && !trace.error) out.push(breakpoints.length ? `No breakpoint was hit (${trace.steps.length} statements ran).` : `No errors (${trace.steps.length} statements ran). Add --break <line> to stop somewhere.`);
    if (stops.length >= MAX_STOPS) out.push(`(only the first ${MAX_STOPS} stops are shown)`);
    if (trace.truncated) out.push(`Not every statement was recorded (limits: ${trace.maxSteps} in all, fewer per phase)${trace.truncatedPhases.length ? `: ${trace.truncatedPhases.join('; ')}` : ''}.`);
    if (trace.error && trace.steps.length) out.push(trace.error);
    return out.join('\n');
  });
  return trace.error || items.some((i) => i.reason === 'error') ? 1 : 0;
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
  const list = await hubHandlers();
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
    const files = extractEntries(await hubPackage(h), out);
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
