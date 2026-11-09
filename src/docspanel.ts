// "Nucleus Docs" panel: the handler API's docs beside the editor, offline, opened by clicking an API name in a hover,
// hint or suggestion (command:splitscreenme.openDocs). The same pages as the workbench's Docs tab (core/docspage.ts):
// the main page, a group (one line per name), one name, a search. A quiet path on top (Docs / Context / name) and a
// back arrow; Search opens VS Code's quick pick. Scripts are off: every control is a command link.
import * as vscode from 'vscode';
import { docsPage, docsValue, docsView, DocsPage } from './core/docspage';
import { linkApiNames, workbenchDocsUrl } from './core/features';
import { allEntries } from './core/lookup';
import { api } from './core/api';

export const OPEN_DOCS = 'splitscreenme.openDocs';
const BACK = 'splitscreenme.docsBack';
const SEARCH = 'splitscreenme.docsSearch';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const docsCommandLink = (value: string) => `command:${OPEN_DOCS}?${encodeURIComponent(JSON.stringify([value]))}`;

/** Markdown → HTML: VS Code's own renderer (the built-in Markdown extension), else a small fallback. */
async function renderMarkdown(md: string): Promise<string> {
  try {
    const html = await vscode.commands.executeCommand<string>('markdown.api.render', md);
    if (typeof html === 'string') return html;
  } catch {
    /* the Markdown extension is off: the fallback */
  }
  return fallbackMarkdown(md);
}
/** Enough Markdown for these pages: code blocks, headings, lists, inline code, bold, italics, links. Exported for tests. */
export function fallbackMarkdown(md: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => `<a href="${href}">${text}</a>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,)])/g, '$1<em>$2</em>');
  return md.split(/(```\w*\n[\s\S]*?```)/).map((part, i) => {
    if (i % 2) return `<pre><code>${esc(part.replace(/^```\w*\n/, '').replace(/```$/, '').trimEnd())}</code></pre>`;
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
    const body = await renderMarkdown(linkApiNames(page.markdown, docsCommandLink));
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
