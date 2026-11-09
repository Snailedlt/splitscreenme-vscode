import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiPathOf, hoverAt, linkApiNames, signatureHelpAt, workbenchDocsUrl } from '../core/features';
import { docsPage, docsView, docsValue } from '../core/docspage';
import { fallbackMarkdown, renderDocsPanel, docsCommandLink } from '../docspanel';

const link = (p: string) => `L(${p})`;

test('docs links: API names in Markdown become links; code blocks, existing links and parameters stay', () => {
  assert.equal(apiPathOf('ModifySaveFile'), 'Context.ModifySaveFile');
  assert.equal(apiPathOf('Context.ModifySaveFile()'), 'Context.ModifySaveFile');
  assert.equal(apiPathOf('Nucleus.DPIHandling'), 'Nucleus.DPIHandling');
  assert.equal(apiPathOf('path'), undefined, 'a parameter name');
  assert.equal(apiPathOf('true'), undefined);
  const md = 'Use `Context.Width` or `KillMutex`, not `path`.\n\n```js\nContext.Width\n```\n\n[`Game.Play`](x)';
  const out = linkApiNames(md, link);
  assert.match(out, /\[`Context\.Width`\]\(L\(Context\.Width\)\)/);
  assert.match(out, /\[`KillMutex`\]\(L\(KillMutex\)\)/, "in more than one place: a search for it");
  assert.match(out, /not `path`/);
  assert.match(out, /```js\nContext\.Width\n```/, 'code blocks untouched');
  assert.match(out, /\[`Game\.Play`\]\(x\)/, 'an existing link untouched');
  assert.equal(workbenchDocsUrl('Context.ModifySaveFile', 'neovim'), 'https://snailedlt.github.io/nucleuscoop-handler-testbench/?ref=neovim#docs-Context.ModifySaveFile');
});

test('docs links: hover ends with "Open in Docs" for the name; signature docs link names; nothing without docsLink', () => {
  const text = 'Game.Play = function () {\n  Context.ModifySaveFile(a, b, Nucleus.SaveType.INI, []);\n};';
  const at = text.indexOf('ModifySaveFile') + 3;
  assert.match(hoverAt(text, at, { docsLink: link })!.markdown, /\[Open in Docs\]\(L\(Context\.ModifySaveFile\)\)$/);
  assert.doesNotMatch(hoverAt(text, at)!.markdown, /Open in Docs/);
  const own = 'function go() {}\ngo();';
  assert.doesNotMatch(hoverAt(own, own.lastIndexOf('go') + 1, { docsLink: link })?.markdown ?? '', /Open in Docs/, 'own functions have no API docs');
  const sig = signatureHelpAt(text, text.indexOf('(a') + 1, { docsLink: link })!;
  assert.ok(sig.signatures.length);
});

test('docs pages: home, group, name, enum, search; views and #docs- values round-trip', () => {
  const home = docsPage('home', link);
  assert.match(home.markdown, /\[Context\]\(L\(Context\)\)/);
  assert.deepEqual(home.crumbs, []);
  const group = docsPage(docsView('Context'), link);
  assert.equal(group.view, 'group:Context');
  assert.match(group.markdown, /- \[`Context\.ModifySaveFile`\]\(L\(Context\.ModifySaveFile\)\)/);
  const one = docsPage(docsView('Context.ModifySaveFile'), link);
  assert.equal(one.path, 'Context.ModifySaveFile');
  assert.deepEqual(one.crumbs, [{ label: 'Context', view: 'group:Context' }, { label: 'ModifySaveFile' }]);
  const en = docsPage(docsView('Nucleus.DPIHandling'), link);
  assert.match(en.markdown, /enum Nucleus\.DPIHandling/);
  assert.match(docsPage(docsView('mutex'), link).markdown, /KillMutex/);
  assert.match(docsPage(docsView('KilMutex'), link).markdown, /Did you mean/);
  for (const v of ['', 'Context', 'Context.Width', 'window title']) assert.equal(docsValue(docsView(v)), v);
});

test('Nucleus Docs panel: path, back, search and workbench links; no scripts', () => {
  const page = docsPage(docsView('Context.ModifySaveFile'), docsCommandLink);
  const html = renderDocsPanel(page, fallbackMarkdown(page.markdown), true);
  assert.ok(!/<script/i.test(html));
  assert.match(html, /command:splitscreenme\.docsBack/);
  assert.match(html, /command:splitscreenme\.docsSearch/);
  assert.match(html, /href="command:splitscreenme\.openDocs\?%5B%22Context%22%5D">Context<\/a>/, 'the group crumb');
  assert.match(html, /<strong aria-current="page">ModifySaveFile<\/strong>/);
  assert.match(html, /\?ref=vscode#docs-Context\.ModifySaveFile/);
  assert.match(fallbackMarkdown('## T\n\n- [`A`](u)\n\n```js\nx < 1\n```'), /<h2>T<\/h2><ul><li><a href="u"><code>A<\/code><\/a><\/li><\/ul><pre><code>x &lt; 1<\/code><\/pre>/);
});
