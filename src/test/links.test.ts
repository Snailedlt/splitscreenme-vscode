// Links live for ever (AGENTS.md): the README/PORTING/TESTING anchors the tools print or put in docs, the lint rules
// link, every `#docs-…` link the tools make to the workbench, and the relative links between the repo's Markdown files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RULES_URL, apiPathOf, linkApiNames, workbenchDocsUrl } from '../core/features';
import { DOCS_GROUPS, docsPage, docsView } from '../core/docspage';
import { allEntries } from '../core/lookup';
import { api, memberMarkdown } from '../core/api';

const root = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');

/** The anchors GitHub gives a Markdown file: one per heading (outside code), plus `<a id>`/`<a name>`. */
export function anchorsOf(md: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      // GitHub slugs the heading's text: links and images by their text, inline HTML dropped; lowercase; everything
      // but letters, digits, spaces, - and _ removed; spaces become -; a repeat gets -1, -2.
      const text = h[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '');
      const base = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.add(n ? `${base}-${n}` : base);
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g)) out.add(m[1]);
  }
  return out;
}

const walk = (dir: string, ok: (f: string) => boolean): string[] =>
  !fs.existsSync(path.join(root, dir)) ? [] : fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    return d.isDirectory() ? (d.name === 'node_modules' ? [] : walk(rel, ok)) : ok(rel) ? [rel] : [];
  });
const rootMd = fs.readdirSync(root).filter((f) => f.endsWith('.md'));
const markdown = [...rootMd, ...walk('docs', (f) => f.endsWith('.md')), ...walk('plugin', (f) => f.endsWith('.md'))];

test('slugs: as GitHub makes them', () => {
  const a = anchorsOf('# Lint rules\n## `ncdev lsp`: other editors\n## Zed (settings.json)\n## Try it\n## Try it\n```\n# not a heading\n```\n<a id="old-name"></a>\n## Emacs (Eglot, built in since Emacs 29)\n');
  assert.deepEqual([...a].sort(), ['emacs-eglot-built-in-since-emacs-29', 'lint-rules', 'ncdev-lsp-other-editors', 'old-name', 'try-it', 'try-it-1', 'zed-settingsjson']);
});

test('links: every README, PORTING and TESTING anchor the tools and docs use exists', () => {
  const anchors: Record<string, Set<string>> = {};
  const of = (file: string) => (anchors[file] ??= anchorsOf(read(file)));
  const sources = [...walk('src', (f) => /\.(ts|mjs|js|json|md|html)$/.test(f) && !f.startsWith('src/test/')), ...walk('scripts', (f) => /\.(mjs|js)$/.test(f)), 'package.json', ...markdown, ...walk('plugin/skills', (f) => !f.endsWith('.md'))];
  const missing: string[] = [];
  let checked = 0;
  for (const src of [...new Set(sources)]) {
    const text = read(src);
    const found: [string, string][] = [];
    for (const m of text.matchAll(/\b(README|PORTING|TESTING)\.md#([\w%-]+)/g)) found.push([`${m[1]}.md`, m[2]]);
    // The repository's own page is its README.
    for (const m of text.matchAll(/github\.com\/Snailedlt\/splitscreenme-vscode\/?#([\w%-]+)/g)) found.push(['README.md', m[1]]);
    for (const m of text.matchAll(/\$\{repo\}#([\w-]+)/g)) found.push(['README.md', m[1]]);
    for (const [file, anchor] of found) {
      checked++;
      if (!of(file).has(decodeURIComponent(anchor))) missing.push(`${src}: ${file}#${anchor}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(checked >= 5, `${checked} links checked`);
  // The lint rules link (every diagnostic's code links to it).
  assert.match(RULES_URL, /#lint-rules$/);
  assert.ok(of('README.md').has(RULES_URL.split('#')[1]));
});

test('links: relative links between the Markdown files point at files (and headings) that exist', () => {
  const missing: string[] = [];
  for (const file of markdown) {
    const text = read(file).replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = m[1];
      if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('//')) continue; // https:, mailto:, vscode:, command:
      const [target, anchor] = href.split('#');
      const to = target ? path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(target))) : file;
      if (!fs.existsSync(path.join(root, to))) {
        missing.push(`${file}: ${href} (no ${to})`);
        continue;
      }
      if (anchor && to.endsWith('.md') && !anchorsOf(read(to)).has(decodeURIComponent(anchor))) missing.push(`${file}: ${href} (no heading #${anchor} in ${to})`);
    }
  }
  assert.deepEqual(missing, []);
});

test('links: every #docs-… link the tools make opens a real page in the workbench', () => {
  const paths = new Set<string>([
    ...allEntries(true).map((e) => e.path),
    ...Object.keys(api.enums).map((n) => `Nucleus.${n}`),
    ...Object.keys(api.nucleusClasses).map((n) => `Nucleus.${n}`),
    ...Object.keys(api.globals).filter((g) => !api.globals[g].hidden),
    ...DOCS_GROUPS.map((g) => g.key),
  ]);
  // And every name the docs themselves link (linkApiNames, as in hovers and the Docs view).
  for (const e of allEntries(true)) linkApiNames(memberMarkdown(e.owner, e.name, e.member), (p) => (paths.add(p), p));
  for (const e of Object.values(api.enums)) if (e.doc) linkApiNames(e.doc, (p) => (paths.add(p), p));
  const broken: string[] = [];
  for (const p of paths) {
    // What the workbench reads back: the value after #docs-.
    const value = decodeURIComponent(workbenchDocsUrl(p, 'test').split('#docs-')[1]);
    assert.equal(value, p);
    const view = docsView(value);
    const page = docsPage(view, (v) => `#docs-${v}`);
    // A group; the name's own page (an enum value: its enum's); or, for a bare name more than one object has
    // (`PlayerID`: Context's and Player's), the list of those.
    const ok = view.startsWith('group:')
      ? !!DOCS_GROUPS.find((g) => `group:${g.key}` === view)
      : page.path
        ? page.path === p || p.startsWith(`${page.path}.`) || apiPathOf(p) === page.path
        : !p.includes('.') && page.markdown.split('\n').filter((l) => l.includes(`.${p}\``)).length >= 2;
    if (!ok || /^Nothing matches|isn't part of the handler API/.test(page.markdown)) broken.push(`#docs-${p} → ${page.path ?? page.crumbs.map((c) => c.label).join(' / ')}`);
  }
  assert.deepEqual(broken, []);
  for (const p of ['Game.Play', 'Context.ModifySaveFile', 'Context', 'Nucleus.SaveType']) assert.ok(paths.has(p), p);
});
