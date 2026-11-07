// Window messages, from ProtoInput's own list (ProtoInputHooks/MessageList.cpp in splitscreenme-protoInput):
// what Game.ProtoInput.BlockedMessages can block. ProtoInput looks a message up by its own table (see
// core/wm.ts), so the linter and the hovers follow the list as ProtoInput has it, not Windows' headers.
//   node scripts/generate-wm.mjs [--protoinput ../splitscreenme-protoInput]   (npm run generate runs it)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--protoinput');
const candidates = [arg > 0 ? process.argv[arg + 1] : null, process.env.PROTOINPUT_REPO, '../splitscreenme-protoInput', '../protoinput-src'].filter(Boolean);
const repo = candidates.map((p) => path.resolve(p)).find((p) => fs.existsSync(path.join(p, 'src', 'ProtoInput', 'ProtoInputHooks', 'MessageList.cpp')));
if (!repo) {
  console.error(`ProtoInput's source not found (tried ${candidates.join(', ')}): clone https://github.com/SplitScreen-Me/splitscreenme-protoInput next to this repo.`);
  process.exit(1);
}
const src = fs.readFileSync(path.join(repo, 'src', 'ProtoInput', 'ProtoInputHooks', 'MessageList.cpp'), 'utf8');
// Only the entries that are compiled in: lines like {8	,	"WM_KILLFOCUS" }, (commented-out ones are skipped).
const entries = [...src.matchAll(/^\{(\d+)\s*,\s*"([^"]+)"\s*\}/gm)].map((m) => [Number(m[1]), m[2]]);
let commit = '';
try { commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a clone */ }
const out = { source: { repo: 'SplitScreen-Me/splitscreenme-protoInput', file: 'src/ProtoInput/ProtoInputHooks/MessageList.cpp', commit }, entries };
fs.writeFileSync(path.join(root, 'data', 'window-messages.json'), JSON.stringify(out) + '\n');
console.log(`data/window-messages.json: ${entries.length} messages (ProtoInput @ ${commit.slice(0, 7) || 'unknown'})`);
