// "Try it" panel: shows what Nucleus would set up for each player of the handler being edited
// (window, launch arguments, file changes), updated as you type. The simulation runs isolated
// from VS Code and Node (src/sandbox.ts). The webview has scripts disabled; its controls are
// command links.
import * as vscode from 'vscode';
import { SimOptions, SimResult, sessionSummary } from './core/sim';
import { pluginsFor, simulateIsolated } from './sandbox';

export interface TryItState {
  players: number;
  keyboardPlayer: number; // -1: nobody
  width: number;
  height: number;
}
const STATE_KEY = 'splitscreenme.tryIt';
const DEFAULT_STATE: TryItState = { players: 2, keyboardPlayer: 0, width: 1920, height: 1080 };
const RESOLUTIONS: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cmd = (id: string, arg?: unknown) => `command:${id}${arg === undefined ? '' : `?${encodeURIComponent(JSON.stringify([arg]))}`}`;
const SET = 'splitscreenme.tryItSet';

/** The panel's HTML (no scripts). Exported for tests. */
export function renderTryIt(r: SimResult, state: TryItState, title: string): string {
  const choice = (label: string, current: boolean, arg: Partial<TryItState>) =>
    current ? `<strong class="choice on">${esc(label)}</strong>` : `<a class="choice" href="${cmd(SET, arg)}">${esc(label)}</a>`;
  const controls = `<div class="controls">
    <span>Players ${[1, 2, 3, 4].map((n) => choice(String(n), state.players === n, { players: n, keyboardPlayer: state.keyboardPlayer >= n ? 0 : state.keyboardPlayer })).join('')}</span>
    <span>Keyboard &amp; mouse ${[...Array(state.players).keys()].map((i) => choice(`P${i + 1}`, state.keyboardPlayer === i, { keyboardPlayer: i })).join('')}${choice('nobody', state.keyboardPlayer === -1, { keyboardPlayer: -1 })}</span>
    <span>Monitor ${RESOLUTIONS.map(([w, h]) => choice(`${w}×${h}`, state.width === w && state.height === h, { width: w, height: h })).join('')}</span></div>`;

  const out: string[] = [];
  if (!r.loaded) {
    out.push(`<div class="banner error"><strong>Nucleus can't load this handler, so nothing would start.</strong> <a href="${cmd('workbench.actions.view.problems')}">Fix the problems</a> first.<div class="mono small">${esc(r.loadError ?? '')}</div></div>`);
  } else {
    out.push(`<div class="banner ${r.sessionEnded ? 'error' : 'ok'}"><strong>${esc(sessionSummary(r))}</strong></div>`);
  }
  const ignored = [...new Set(r.ignored)];
  if (ignored.length) out.push(`<h3>Settings Nucleus skips (${ignored.length})</h3><ul class="mono warn">${ignored.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`);
  for (const p of r.players) {
    out.push(`<section><h3>Player ${p.index + 1} <span class="tag">${p.index === state.keyboardPlayer ? 'keyboard &amp; mouse' : 'controller'}</span></h3>
      ${p.error ? `<div class="banner error">Setting up this player fails here, and Nucleus ends the session.<div class="mono small">${esc(p.error)}</div></div>` : ''}
      ${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}
      <table><tr><th>Window</th><td>${esc(p.window)}</td></tr>
      <tr><th>Starts the game with</th><td class="mono">${p.startArguments ? esc(p.startArguments) : '<span class="muted">(nothing extra)</span>'}</td></tr>
      <tr><th>Changes before the game starts</th><td>${p.effects.length ? `<ul>${p.effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '<span class="muted">(none)</span>'}</td></tr></table>
      ${p.calls.length ? `<details><summary>${p.calls.length} recorded call${p.calls.length === 1 ? '' : 's'}</summary><ul class="mono">${p.calls.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}</section>`);
  }
  for (const c of r.callbacks) {
    out.push(`<section><h3>${esc(c.name)}</h3>${c.error ? `<div class="banner error">${esc(c.note ?? '')}<div class="mono small">${esc(c.error)}</div></div>` : ''}<details><summary>${c.calls.length} recorded call${c.calls.length === 1 ? '' : 's'}</summary><ul class="mono">${c.calls.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details></section>`);
  }
  if (r.options.length) {
    out.push(`<details><summary>${r.options.length} option${r.options.length === 1 ? '' : 's'} set (different from Nucleus' defaults)</summary><table>${r.options.map((o) => `<tr><td class="mono">${esc(o.path)}</td><td class="mono">${esc(o.value.length > 120 ? o.value.slice(0, 117) + '…' : o.value)}</td></tr>`).join('')}</table></details>`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px 16px 24px; line-height: 1.45; }
h2 { font-size: 1.15em; margin: 4px 0 2px; } h3 { font-size: 1em; margin: 16px 0 6px; }
.lede, .muted { color: var(--vscode-descriptionForeground); } .lede { margin: 0 0 10px; max-width: 70ch; }
.controls { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 8px 0 12px; }
.choice { display: inline-block; margin-left: 4px; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--vscode-panel-border, transparent); text-decoration: none; }
.choice.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; font-weight: 600; }
.banner { padding: 8px 10px; border-radius: 4px; margin: 8px 0; border-left: 3px solid; }
.banner.ok { border-color: var(--vscode-testing-iconPassed, #3a3); background: color-mix(in srgb, var(--vscode-testing-iconPassed, #3a3) 10%, transparent); }
.banner.error { border-color: var(--vscode-errorForeground); background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent); }
.mono, code { font-family: var(--vscode-editor-font-family); font-size: 0.95em; } .small { font-size: 0.9em; margin-top: 4px; overflow-wrap: anywhere; }
section { border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); margin-top: 12px; }
.tag { font-weight: 400; font-size: .85em; color: var(--vscode-descriptionForeground); margin-left: 6px; }
table { border-collapse: collapse; } th { text-align: left; font-weight: 400; color: var(--vscode-descriptionForeground); padding: 2px 14px 2px 0; vertical-align: top; white-space: nowrap; } td { padding: 2px 0; vertical-align: top; overflow-wrap: anywhere; }
ul { margin: 0; padding-left: 18px; } ul.mono { list-style: none; padding-left: 0; } .warn li { color: var(--vscode-editorWarning-foreground); }
details { margin: 6px 0; } summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
</style></head><body>
<h2>Try it: ${esc(title)}</h2>
<p class="lede">What Nucleus would set up for each player: where its window goes, how the game is started and which settings files it changes. Simulated, following the rules of Nucleus' Jint engine: nothing on your computer is touched, and the handler can't access it. Windows, focus and input still need a real test in Nucleus.</p>
${controls}${out.join('\n')}
</body></html>`;
}

/** Registers the Try it command and its panel. */
export function registerTryIt(context: vscode.ExtensionContext, isHandler: (doc: vscode.TextDocument) => boolean) {
  let panel: vscode.WebviewPanel | undefined;
  let doc: vscode.TextDocument | undefined;
  let timer: NodeJS.Timeout | undefined;
  let state: TryItState = { ...DEFAULT_STATE, ...context.workspaceState?.get<Partial<TryItState>>(STATE_KEY, {}) };
  // Shows the Try it button in the editor title bar only for handlers.
  const markHandler = (e: vscode.TextEditor | undefined) => void vscode.commands.executeCommand('setContext', 'splitscreenme.isHandler', !!e && isHandler(e.document));
  markHandler(vscode.window.activeTextEditor);

  const render = () => {
    if (!panel || !doc) return;
    const opts: SimOptions = { players: state.players, width: state.width, height: state.height, keyboardPlayer: state.keyboardPlayer, plugins: doc.isUntitled ? undefined : pluginsFor(doc.fileName) };
    const title = doc.isUntitled ? 'Untitled' : doc.fileName.split(/[\\/]/).pop()!;
    panel.title = `Try it: ${title}`;
    panel.webview.html = renderTryIt(simulateIsolated(doc.getText(), opts), state, title);
  };
  const schedule = (delay = 400) => {
    clearTimeout(timer);
    timer = setTimeout(render, delay);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('splitscreenme.tryIt', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isHandler(editor.document)) {
        vscode.window.showInformationMessage('Open a Nucleus handler to try it.');
        return;
      }
      doc = editor.document;
      if (panel) panel.reveal(vscode.ViewColumn.Beside, true);
      else {
        panel = vscode.window.createWebviewPanel('splitscreenme.tryIt', 'Try it', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
          enableScripts: false,
          enableCommandUris: [SET, 'workbench.actions.view.problems'],
          localResourceRoots: [],
        });
        panel.onDidDispose(() => (panel = undefined), null, context.subscriptions);
      }
      render();
    }),
    vscode.commands.registerCommand(SET, (change: Partial<TryItState>) => {
      const next = { ...state, ...change };
      if (!(next.players >= 1 && next.players <= 16) || next.keyboardPlayer < -1 || next.keyboardPlayer >= next.players) return;
      state = next;
      void context.workspaceState?.update(STATE_KEY, state);
      render();
    }),
    vscode.workspace.onDidChangeTextDocument((e) => e.document === doc && schedule()),
    vscode.window.onDidChangeActiveTextEditor((e) => {
      markHandler(e);
      // Follow the handler being edited.
      if (panel && e && e.document !== doc && isHandler(e.document)) {
        doc = e.document;
        schedule(0);
      }
    }),
  );
}
