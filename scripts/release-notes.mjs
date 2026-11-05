// Release notes from CHANGELOG.md, for the GitHub release and for a Discord post.
//   node scripts/release-notes.mjs [version] [--discord] [--tag vX.Y.Z-beta.N]
// version defaults to package.json's. The section is "## <version>" (anything after the number,
// like "(beta)", is fine). Each bullet starts with a **short summary**, then the details: the
// GitHub notes show everything; the Discord post is one line with the top summaries and a link
// (the extension and the workbench show what's new themselves).
// Exits 1 when the version has no section: every release needs its notes written first.
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const version = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--tag') ?? JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8')).version;
const tag = flag('--tag') ?? `v${version}`;

export function section(changelog, v) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${v.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start < 0) return undefined;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

const body = section(fs.readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version);
if (!body) {
  console.error(`CHANGELOG.md has no "## ${version}" section. Write the release notes there first (rename "## Unreleased").`);
  process.exit(1);
}
const repo = 'https://github.com/Snailedlt/splitscreenme-vscode';
if (args.includes('--discord')) {
  // Short: the tools show what's new themselves now. A link, plus up to three highlights.
  const items = body
    .split('\n')
    .filter((l) => /^- /.test(l))
    .map((l) => l.match(/^- \*\*(.+?)\*\*/)?.[1] ?? l.slice(2).split(/(?<=\.)\s/)[0])
    .map((s) => s.replace(/\.$/, ''));
  const top = items.slice(0, 3).join(' · ') + (items.length > 3 ? ` (+${items.length - 3} more)` : '');
  console.log(`**VS Code extension ${tag} is out** 🛠️ ${top}\nWhat's new is shown in the extension. <${repo}/releases/tag/${tag}>`);
} else {
  console.log(`${body}

---

📦 **Install:** download \`splitscreenme-vscode-${tag}.vsix\` below, then in VS Code run **Extensions: Install from VSIX…** (Ctrl+Shift+P). New to the tools? Start with the [intro and install guide](https://snailedlt.github.io/nucleuscoop-handler-testbench/start/) and [TESTING.md](${repo}/blob/main/TESTING.md).
🤖 **AI agents:** \`nucleus.js\` (below) is the command-line tool and MCP server: \`node nucleus.js mcp\`. See the [README](${repo}#ai-agents).
🌐 **Offline workbench:** \`workbench.html\` (below) is the whole browser workbench in one file; open it locally or host it yourself.
💬 **Feedback:** [tester feedback form](${repo}/issues/new?template=tester-feedback.yml).`);
}
