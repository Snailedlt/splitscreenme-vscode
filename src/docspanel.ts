// "Nucleus Docs" panel: the handler API's docs beside the editor, offline, opened by clicking an API name in a hover,
// hint or suggestion (command:splitscreenme.showDocs). The same pages as the workbench's Docs tab (core/docspage.ts):
// the main page, a group (one line per name), one name, a search. A quiet path on top (Docs / Context / name) and a
// back arrow; Search opens VS Code's quick pick. Scripts are off: every control is a command link.
import * as vscode from 'vscode';
import { docsPage, docsValue, docsView, DocsPage } from './core/docspage';
import { linkApiNames, workbenchDocsUrl } from './core/features';
import { allEntries } from './core/lookup';
import { api } from './core/api';

export const OPEN_DOCS = 'splitscreenme.showDocs'; // not openDocs: that is "Open Documentation…" (external links)
const BACK = 'splitscreenme.docsBack';
const SEARCH = 'splitscreenme.docsSearch';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const docsCommandLink = (value: string) => `command:${OPEN_DOCS}?${encodeURIComponent(JSON.stringify([value]))}`;

/** JavaScript / TypeScript signatures as coloured HTML (VS Code's token colours, by theme; see the panel's CSS):
 *  keywords, strings, numbers, comments, types after `:`, members after `.` (calls as functions). Exported for tests. */
export function highlightCode(src: string): string {
  const KW = /^(var|let|const|function|return|if|else|for|while|do|in|of|new|typeof|instanceof|this|true|false|null|undefined|enum|break|continue|switch|case|default|try|catch|finally|throw|delete|void)$/;
  const TYPES = /^(string|number|boolean|void|any|object|never|unknown)$/;
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([\s\S])/g;
  let out = '';
  let prev = ''; // the last non-space character before this token
  let m: RegExpExecArray | null;
  const span = (cls: string, t: string) => `<span class="tk-${cls}">${esc(t)}</span>`;
  while ((m = re.exec(src))) {
    const [t, comment, str, num, word] = m;
    if (comment) out += span('comment', t);
    else if (str) out += span('string', t);
    else if (num) out += span('number', t);
    else if (word) {
      const next = src.slice(re.lastIndex).match(/^\s*(\S)/)?.[1];
      if (KW.test(word)) out += span('keyword', word);
      else if (TYPES.test(word) || (prev === ':' && /^[A-Z]/.test(word)) || (prev === '.' && /^Nucleus\.$/.test(src.slice(Math.max(0, m.index - 8), m.index)))) out += span('type', word);
      else if (next === '(') out += span('function', word);
      else if (prev === '.') out += span('property', word);
      else if (prev === ':' || prev === '|' || prev === '<') out += span('type', word);
      else out += span('variable', word);
    } else out += esc(t);
    if (/\S/.test(t)) prev = t.trim().slice(-1);
  }
  return out;
}

const unesc = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!);
/** Inline code that is clearly code (a member path, a call, a literal): coloured; a plain word (`handlers`) stays
 *  plain. The workbench's rule (codehl.ts looksLikeCode). */
function looksLikeCode(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 400) return false;
  if (/^[\w$]+$/.test(t)) return /^(true|false|null|undefined|var|function|new|\d[\d.]*)$/.test(t);
  if (/[\\/]/.test(t) && !/[("=]/.test(t)) return false;
  return /[.()=;"'[\]{}+<>!-]/.test(t);
}
/** Markdown → HTML, enough for these pages (they're ours): code blocks (coloured), headings, lists, inline code, bold,
 *  italics, links. Exported for tests. */
export function fallbackMarkdown(md: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => `<a href="${href}">${text}</a>`)
      .replace(/`([^`]+)`/g, (_m, c: string) => `<code>${looksLikeCode(unesc(c)) ? highlightCode(unesc(c)) : c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,)])/g, '$1<em>$2</em>');
  return md.split(/(```\w*\n[\s\S]*?```)/).map((part, i) => {
    if (i % 2) return `<pre><code>${highlightCode(part.replace(/^```\w*\n/, '').replace(/```$/, '').trimEnd())}</code></pre>`;
    return part.split(/\n{2,}/).filter((p) => p.trim()).map((p) => {
      const lines = p.trim().split('\n');
      if (/^#{1,3} /.test(lines[0])) return `<h2>${inline(lines[0].replace(/^#+ /, ''))}</h2>`;
      if (lines.every((l) => /^- /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }).join('');
}

/** The panel's HTML for a page (no scripts). Exported for tests. */
export function renderDocsPanel(page: DocsPage, body: string, canGoBack: boolean): string {
  const crumb = (label: string, value?: string) => (value === undefined ? `<strong aria-current="page">${esc(label)}</strong>` : `<a href="${docsCommandLink(value)}">${esc(label)}</a>`);
  const parts = [page.crumbs.length ? crumb('Docs', '') : crumb('Docs')].concat(page.crumbs.map((c, i) => crumb(c.label, i < page.crumbs.length - 1 && c.view ? docsValue(c.view) : undefined)));
  const web = page.path ? workbenchDocsUrl(page.path, 'vscode') : workbenchDocsUrl('', 'vscode').replace(/#docs-$/, '#docs');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 16px 24px; line-height: 1.5; max-width: 860px; }
nav { position: sticky; top: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding: 8px 0; margin-bottom: 6px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); color: var(--vscode-descriptionForeground); font-size: .92em; }
nav a { color: var(--vscode-descriptionForeground); text-decoration: none; } nav a:hover { color: var(--vscode-textLink-foreground); text-decoration: underline; }
nav strong { color: var(--vscode-foreground); } nav .sep { opacity: .6; }
nav .back { display: inline-grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); border-radius: 4px; color: var(--vscode-foreground); }
nav .end { margin-left: auto; display: flex; gap: 12px; }
nav .end a { color: var(--vscode-textLink-foreground); }
h2 { font-size: 1.15em; margin: 14px 0 6px; }
a { color: var(--vscode-textLink-foreground); }
code { font-family: var(--vscode-editor-font-family); font-size: .95em; background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15)); padding: 0 3px; border-radius: 3px; }
pre { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15)); padding: 8px 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
/* Code colours: VS Code's default token colours for each kind of theme (the webview's body says which). */
.tk-keyword { color: #0000ff; } .tk-string { color: #a31515; } .tk-number { color: #098658; } .tk-comment { color: #008000; }
.tk-type { color: #267f99; } .tk-function { color: #795e26; } .tk-property { color: #001080; } .tk-variable { color: #001080; }
body.vscode-dark .tk-keyword { color: #569cd6; } body.vscode-dark .tk-string { color: #ce9178; } body.vscode-dark .tk-number { color: #b5cea8; }
body.vscode-dark .tk-comment { color: #6a9955; } body.vscode-dark .tk-type { color: #4ec9b0; } body.vscode-dark .tk-function { color: #dcdcaa; }
body.vscode-dark .tk-property, body.vscode-dark .tk-variable { color: #9cdcfe; }
body.vscode-high-contrast .tk-keyword { color: #569cd6; } body.vscode-high-contrast .tk-string { color: #ce9178; } body.vscode-high-contrast .tk-number { color: #b5cea8; }
body.vscode-high-contrast .tk-comment { color: #7ca668; } body.vscode-high-contrast .tk-type { color: #4ec9b0; } body.vscode-high-contrast .tk-function { color: #dcdcaa; }
body.vscode-high-contrast .tk-property, body.vscode-high-contrast .tk-variable { color: #9cdcfe; }
body.vscode-high-contrast-light .tk-keyword { color: #0f4a85; } body.vscode-high-contrast-light .tk-string { color: #0f4a85; }
body.vscode-high-contrast-light .tk-comment { color: #515151; } body.vscode-high-contrast-light .tk-type { color: #185e73; } body.vscode-high-contrast-light .tk-function { color: #5e2cbc; }
ul { padding-left: 20px; } li { margin: 3px 0; }
</style></head><body>
<nav aria-label="Where you are in the docs">${canGoBack ? `<a class="back" href="command:${BACK}" title="Back" aria-label="Back">←</a>` : ''}${parts.join('<span class="sep" aria-hidden="true">/</span>')}<span class="end"><a href="command:${SEARCH}" title="Search the docs (names and words)">Search…</a><a href="${esc(web)}" title="The same page in the browser workbench">Open in the workbench</a></span></nav>
<main>${body}</main>
</body></html>`;
}

export function registerDocsPanel(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined;
  let view = 'home';
  const history: string[] = [];

  const show = async (next: string, push: boolean) => {
    if (push && panel && next !== view) history.push(view);
    if (history.length > 50) history.shift();
    view = next;
    const page = docsPage(view, docsCommandLink);
    // Names inside the docs open their own page too.
    const body = fallbackMarkdown(linkApiNames(page.markdown, docsCommandLink));
    if (!panel) {
      panel = vscode.window.createWebviewPanel('splitscreenme.docs', 'Nucleus Docs', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
        enableScripts: false,
        enableCommandUris: [OPEN_DOCS, BACK, SEARCH],
        localResourceRoots: [],
      });
      panel.onDidDispose(() => {
        panel = undefined;
        history.length = 0;
      }, null, context.subscriptions);
    } else panel.reveal(undefined, true);
    panel.title = page.path ? `Docs: ${page.path.split('.').pop()}` : 'Nucleus Docs';
    panel.webview.html = renderDocsPanel(page, body, history.length > 0);
  };

  context.subscriptions.push(
    // From a hover link (a name), Search, or the command palette (the main page).
    vscode.commands.registerCommand(OPEN_DOCS, (value?: string) => show(docsView(typeof value === 'string' ? value : ''), true)),
    vscode.commands.registerCommand(BACK, () => {
      const v = history.pop();
      if (v !== undefined) void show(v, false);
    }),
    vscode.commands.registerCommand(SEARCH, async () => {
      // Every name, with its first line of docs; or press Enter on words to search the docs.
      const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { value?: string }>();
      qp.placeholder = 'A name (Context.ModifySaveFile, KillMutex…) or words to search for (window title, mutex)';
      qp.matchOnDescription = true;
      qp.items = [
        ...allEntries(true).map((e) => ({ label: e.path, description: (e.member.doc ?? '').split('\n')[0].slice(0, 100), value: e.path })),
        ...Object.keys(api.enums).map((n) => ({ label: `Nucleus.${n}`, description: 'Nucleus values (enum)', value: `Nucleus.${n}` })),
      ];
      qp.onDidAccept(() => {
        const pick = qp.selectedItems[0];
        const value = pick?.value ?? qp.value.trim();
        qp.hide();
        if (value) void show(docsView(value), true);
      });
      qp.onDidHide(() => qp.dispose());
      qp.show();
    }),
  );
}
