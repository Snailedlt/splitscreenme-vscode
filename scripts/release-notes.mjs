// Release notes from CHANGELOG.md, for the GitHub release and for a Discord post.
//   node scripts/release-notes.mjs [version] [--discord [--json]] [--tag vX.Y.Z-beta.N]
// --discord --json prints the Discord webhook payload (a rich embed) instead of the text.
// version defaults to package.json's. The section is "## <version>" (anything after the number,
// like "(beta)", is fine). Each bullet starts with a **short summary**, then the details: the
// GitHub notes show everything; the Discord post is a heading, up to three highlights and the link
// (the extension and the workbench show what's new themselves).
// Exits 1 when the version has no section: every release needs its notes written first.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const repo = 'https://github.com/Snailedlt/splitscreenme-vscode';

export function section(changelog, v) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${v.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start < 0) return undefined;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim().replace(/\n-{3,}$/, '').trim();
}

/** What the Discord post shows: each change's short summary (not the thanks), and the thanks' names. */
function highlights(body, tag) {
  // Short: the tools show what's new themselves now. A link, plus up to three highlights.
  const items = body
    .split(/^### 🙏.*$/m)[0] // what changed, not the thanks
    .split('\n')
    .filter((l) => /^- /.test(l))
    .map((l) => l.match(/^- \*\*(.+?)\*\*/)?.[1] ?? l.slice(2).split(/(?<=\.)\s/)[0])
    .map((s) => s.replace(/\.$/, ''));
  // A heading, up to three highlights, the link, and the thanks: one message, readable at a glance.
  const version = tag.replace(/^v/, '').replace(/-.*$/, '');
  const thanks = (body.split(/^### 🙏.*$/m)[1] ?? '').split('\n').map((l) => l.match(/^- \*\*(.+?)\*\*/)?.[1]?.replace(/^\[([^\]]+)\]\([^)]+\)$/, '$1')).filter(Boolean);
  return { items, version, thanks };
}

/** The Discord webhook payload: a rich embed. `now` for the timestamp. */
export function discordPayload(body, tag, now = new Date()) {
  const { items, version, thanks } = highlights(body, tag);
  // A rich embed, so the extension's posts look different from the workbench's
  // (nucleuscoop-handler-testbench tools/release-post.mjs): its own name, icon and colour.
  const url = `${repo}/releases/tag/${tag}`;
  const shown = items.slice(0, 5);
  const description = [
    ...shown.map((s) => `• ${s}`),
    ...(items.length > shown.length ? [`…and ${items.length - shown.length} more in the release notes`] : []),
    '',
    `[Release notes](${url}) · [Download the .vsix](${repo}/releases/download/${tag}/splitscreenme-vscode-${tag}.vsix) · [Install guide](https://snailedlt.github.io/nucleuscoop-handler-testbench/start/?ref=discord)`,
  ].join('\n');
  return {
    username: 'Nucleus Tools · VS Code extension',
    avatar_url: 'https://raw.githubusercontent.com/Snailedlt/splitscreenme-vscode/main/media/discord-avatar.png',
    embeds: [
      {
        author: { name: 'VS Code extension', url: repo, icon_url: 'https://raw.githubusercontent.com/Snailedlt/splitscreenme-vscode/main/media/icon.png' },
        title: `🧩 SplitScreen.Me for VS Code v${version}${/-beta/.test(tag) ? ' (beta)' : ''}`,
        url,
        description,
        color: 0x007acc, // VS Code blue
        ...(thanks.length ? { fields: [{ name: 'Thanks', value: `${thanks.join(', ')} 🙏` }] } : {}),
        footer: { text: 'Nucleus handler tools · VS Code extension' },
        timestamp: now.toISOString(),
      },
    ],
  };
}

/** The short Discord post: a heading, up to three highlights, the link, the thanks. */
export function discordText(body, tag) {
  const { items, version, thanks } = highlights(body, tag);
  const lines = [`**v${version}${/-beta/.test(tag) ? ' (beta)' : ''} is out** 🛠️`, ...items.slice(0, 3).map((s) => `• ${s}`)];
  lines.push('', `<${repo}/releases/tag/${tag}>`);
  if (thanks.length) lines.push(`Thanks ${thanks.join(', ')} 🙏`);
  return lines.join('\n');
}

/** The GitHub release notes: the section, then how to install. */
export function githubNotes(body, tag) {
  return `${body}

---

📦 **Install:** download \`splitscreenme-vscode-${tag}.vsix\` below, then in VS Code run **Extensions: Install from VSIX…** (Ctrl+Shift+P). New to the tools? Start with the [intro and install guide](https://snailedlt.github.io/nucleuscoop-handler-testbench/start/?ref=github-release) and [TESTING.md](${repo}/blob/main/TESTING.md).
🤖 **AI agents:** \`nucleus.js\` (below) is the command-line tool and MCP server: \`node nucleus.js mcp\`. See the [README](${repo}#ai-agents).
🌐 **Offline workbench:** \`workbench.html\` (below) is the whole browser workbench in one file; open it locally or host it yourself.
💬 **Feedback:** [tester feedback form](${repo}/issues/new?template=tester-feedback.yml).`;
}

function main() {
  const root = new URL('..', import.meta.url);
  const args = process.argv.slice(2);
  const flag = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const version = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--tag') ?? JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8')).version;
  // Release tags are vX.Y.Z-beta.N (scripts/release-version.mjs); without --tag the links would point at a tag that doesn't exist.
  if (!flag('--tag') && args.includes('--discord')) {
    console.error('--discord needs --tag vX.Y.Z-beta.N (the release workflow passes it; release-version.mjs prints the next one).');
    process.exit(1);
  }
  const tag = flag('--tag') ?? `v${version}`;
  const body = section(fs.readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version);
  if (!body) {
    console.error(`CHANGELOG.md has no "## ${version}" section. Write the release notes there first (rename "## Unreleased").`);
    process.exit(1);
  }
  if (!args.includes('--discord')) console.log(githubNotes(body, tag));
  else if (args.includes('--json')) console.log(JSON.stringify(discordPayload(body, tag)));
  else console.log(discordText(body, tag));
}

// Run as a script (not when a test imports it).
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main();
