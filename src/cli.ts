// nucleus-lint: lint Nucleus Co-op handlers from the command line (e.g. in CI).
import fs from 'node:fs';
import path from 'node:path';
import { lint, lineOf, lineStart, RULES, RuleId, Severity, LintOptions, looksLikeHandler } from './core/lint';

const HELP = `Usage: nucleus-lint [options] <file|dir>...

Lints Nucleus Co-op handler scripts (.js). Directories are searched recursively.

Options:
  --format <pretty|json>   Output format (default: pretty)
  --rule <id>=<severity>   Override a rule: error, warning, info, hint or off
  --all                    Lint every .js file, not only ones that look like handlers
  --quiet                  Only report errors
  --verbose                Also report hints (e.g. deprecated options)
  --list-rules             Print the available rules
  -h, --help               Show this help

Exit code is 1 when any error is reported.`;

function main(argv: string[]): number {
  const files: string[] = [];
  const options: LintOptions = { rules: {} };
  let format = 'pretty';
  let all = false;
  let quiet = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      return 0;
    } else if (a === '--list-rules') {
      for (const [id, r] of Object.entries(RULES)) console.log(`${id.padEnd(22)} ${r.severity.padEnd(8)} ${r.description}`);
      return 0;
    } else if (a === '--format') format = argv[++i];
    else if (a === '--all') all = true;
    else if (a === '--quiet') quiet = true;
    else if (a === '--verbose') verbose = true;
    else if (a === '--rule') {
      const [id, sev] = (argv[++i] ?? '').split('=');
      if (!(id in RULES) || !['error', 'warning', 'info', 'hint', 'off'].includes(sev)) {
        console.error(`Invalid --rule ${id}=${sev}`);
        return 2;
      }
      options.rules![id as RuleId] = sev as Severity | 'off';
    } else files.push(a);
  }
  if (!files.length) {
    console.error(HELP);
    return 2;
  }

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
  const json: unknown[] = [];
  for (const file of targets) {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    if (!all && !files.includes(file) && !looksLikeHandler(text)) continue;
    const diags = lint(text, options).filter((d) => (quiet ? d.severity === 'error' : verbose || d.severity !== 'hint'));
    for (const d of diags) {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    }
    if (format === 'json') {
      json.push({
        file,
        diagnostics: diags.map((d) => ({ ...d, line: lineOf(text, d.start) + 1, column: d.start - lineStart(text, d.start) + 1 })),
      });
      continue;
    }
    if (!diags.length) continue;
    console.log(file);
    for (const d of diags) {
      const line = lineOf(text, d.start) + 1;
      const col = d.start - lineStart(text, d.start) + 1;
      console.log(`  ${`${line}:${col}`.padEnd(9)} ${d.severity.padEnd(8)} ${d.message}  [${d.rule}]`);
    }
    console.log();
  }
  if (format === 'json') console.log(JSON.stringify(json, null, 2));
  else console.log(`${targets.length} file(s): ${errors} error(s), ${warnings} warning(s)`);
  return errors ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
