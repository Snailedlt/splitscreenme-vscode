// Grades the handlers an eval run produced with the real tools, which `claude plugin eval` can't
// call (it has no code graders): lint errors/warnings and the Try it outcome per case and arm.
//
//   claude plugin eval ./plugin --scaffold --allow-tools Write Edit --keep-temp ... > eval.log 2>&1
//   node scripts/eval-grade.mjs eval.log [--cleanup]
//
// Each handler.js is copied out of the run's kept folder first: those folders hold agent-written
// files, so nothing runs inside them. --cleanup deletes the kept folders afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [log, ...rest] = process.argv.slice(2);
if (!log) {
  console.error('usage: node scripts/eval-grade.mjs <eval log> [--cleanup]');
  process.exit(2);
}
const cli = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'cli.js');
const json = (args) => {
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
  } catch (e) {
    return JSON.parse(e.stdout);
  }
};

const runs = [];
let kept = null;
for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
  const k = /kept temp: (\S+)/.exec(line);
  if (k) kept = k[1];
  const r = /^\s*(\S+) run (\d+)\/\d+ \[(with|without)\]: score ([\d.]+)/.exec(line);
  if (r && kept) {
    runs.push({ case: r[1], run: Number(r[2]), arm: r[3], score: Number(r[4]), dir: kept });
    kept = null;
  }
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-grade-'));
const rows = runs.map((r) => {
  const src = path.join(r.dir, 'home', 'cwd', 'handler.js');
  if (!fs.existsSync(src)) return { ...r, file: false };
  const copy = path.join(scratch, `${r.case}-${r.arm}-${r.run}.js`);
  fs.copyFileSync(src, copy);
  const lint = json(['lint', '--json', copy]);
  const s = json(['simulate', copy, '--json', '--players', '2']);
  const tryIt = !s.loaded ? 'fails to load' : s.sessionEnded ? `player ${s.sessionEnded.player + 1} fails` : 'OK';
  return { ...r, file: true, errors: lint.errors, warnings: lint.warnings, tryIt };
});
fs.rmSync(scratch, { recursive: true, force: true });

console.log('| Case | Arm | Run | Eval score | Lint errors | Warnings | Try it |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows.sort((a, b) => a.case.localeCompare(b.case) || a.arm.localeCompare(b.arm) || a.run - b.run)) {
  console.log(`| ${r.case} | ${r.arm} | ${r.run} | ${r.score.toFixed(2)} | ${r.file ? r.errors : '-'} | ${r.file ? r.warnings : '-'} | ${r.file ? r.tryIt : 'no handler.js'} |`);
}
const loads = (arm) => {
  const xs = rows.filter((r) => r.arm === arm && r.file);
  return `${xs.filter((r) => r.errors === 0 && r.tryIt === 'OK').length}/${xs.length}`;
};
console.log(`\nHandlers with 0 lint errors that Try it runs: with the plugin ${loads('with')}, without ${loads('without')}.`);
if (rest.includes('--cleanup')) {
  for (const r of runs) {
    try {
      execFileSync('chmod', ['-R', 'u+rwX', r.dir]);
      fs.rmSync(r.dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}
