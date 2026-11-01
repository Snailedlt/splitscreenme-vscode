// Filesystem helpers shared by the CLI and the VS Code commands:
// building .nc packages, extracting Hub packages, installing the agent kit.
import fs from 'node:fs';
import path from 'node:path';
import { handlerPackageEntries, writeZip, ZipEntry } from './zip';

function listFiles(dir: string, base = dir): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(abs, base));
    else if (e.isFile()) out.push({ rel: path.relative(base, abs).split(path.sep).join('/'), abs });
  }
  return out;
}

/**
 * Build a Nucleus handler package from `<dir>/<Name>.js` and its asset
 * folder `<dir>/<Name>/` (Nucleus' `Game.Folder`), if present.
 */
export function buildPackage(handlerPath: string): { zip: Buffer; assetCount: number } {
  const base = path.basename(handlerPath, '.js');
  const assetDir = path.join(path.dirname(handlerPath), base);
  const files = fs.existsSync(assetDir) && fs.statSync(assetDir).isDirectory() ? listFiles(assetDir) : [];
  const entries = handlerPackageEntries(
    fs.readFileSync(handlerPath),
    base,
    files.map((f) => ({ rel: f.rel, data: fs.readFileSync(f.abs) })),
  );
  return { zip: writeZip(entries), assetCount: files.length };
}

/** Write zip entries under `dir`, refusing paths that escape it. Returns written files. */
export function extractEntries(entries: ZipEntry[], dir: string): string[] {
  const written: string[] = [];
  const root = path.resolve(dir);
  for (const e of entries) {
    if (e.name.endsWith('/') || !e.data) continue;
    const parts = e.name.split('/').filter((p) => p && p !== '.' && p !== '..');
    if (!parts.length) continue;
    const target = path.resolve(root, ...parts);
    if (!target.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
    written.push(target);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Agent kit

export const SKILL_NAME = 'nucleus-handler';
const MARK_START = '<!-- nucleus-handler:start -->';
const MARK_END = '<!-- nucleus-handler:end -->';

/** Locate the skill folder relative to a running bundle (CLI or extension). */
export function findSkillDir(from: string): string | undefined {
  const candidates = [
    path.resolve(from, '..'), // <skill>/scripts/nucleus.js
    path.resolve(from, '..', 'plugin', 'skills', SKILL_NAME), // <repo>/dist/cli.js or extension
    path.resolve(from, 'plugin', 'skills', SKILL_NAME),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'SKILL.md')));
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

export interface InstallResult {
  created: string[];
  updated: string[];
}

/**
 * Install the agent kit into a handler workspace:
 * - `.claude/skills/nucleus-handler/` (skill, references, bundled CLI)
 * - `AGENTS.md` section (read by Codex, Copilot, Cursor, ... and Claude Code via CLAUDE.md)
 * - `CLAUDE.md` importing AGENTS.md
 * Idempotent: re-running refreshes the skill and the marked AGENTS.md section only.
 */
export function installAgentKit(skillDir: string, target: string): InstallResult {
  const res: InstallResult = { created: [], updated: [] };
  const note = (p: string, existed: boolean) => (existed ? res.updated : res.created).push(path.relative(target, p) || p);

  const skillDest = path.join(target, '.claude', 'skills', SKILL_NAME);
  const skillExisted = fs.existsSync(skillDest);
  if (skillExisted) fs.rmSync(skillDest, { recursive: true, force: true });
  copyDir(skillDir, skillDest);
  note(skillDest, skillExisted);

  const section = fs.readFileSync(path.join(skillDir, 'templates', 'AGENTS.section.md'), 'utf8').trim();
  const block = `${MARK_START}\n${section}\n${MARK_END}`;
  const agents = path.join(target, 'AGENTS.md');
  if (fs.existsSync(agents)) {
    const cur = fs.readFileSync(agents, 'utf8');
    const s = cur.indexOf(MARK_START);
    const e = cur.indexOf(MARK_END);
    const next = s >= 0 && e > s ? cur.slice(0, s) + block + cur.slice(e + MARK_END.length) : `${cur.trimEnd()}\n\n${block}\n`;
    if (next !== cur) {
      fs.writeFileSync(agents, next);
      note(agents, true);
    }
  } else {
    fs.writeFileSync(agents, `# Agent instructions\n\n${block}\n`);
    note(agents, false);
  }

  const claude = path.join(target, 'CLAUDE.md');
  if (fs.existsSync(claude)) {
    const cur = fs.readFileSync(claude, 'utf8');
    if (!/^@AGENTS\.md\s*$/m.test(cur)) {
      fs.writeFileSync(claude, `@AGENTS.md\n\n${cur}`);
      note(claude, true);
    }
  } else {
    fs.writeFileSync(claude, '@AGENTS.md\n');
    note(claude, false);
  }
  return res;
}
