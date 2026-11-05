// "Try it" panel: shows what Nucleus would set up for each player of the handler being edited
// (window, launch arguments, file changes), updated as you type. The simulation runs isolated
// from VS Code and Node (src/sandbox.ts). The webview has scripts disabled; its controls are
// command links.
import * as vscode from 'vscode';
import { SimOptions, SimResult, sessionSummary, groupIgnored, EVERY_KEYBOARD } from './core/sim';
import { pluginsFor, simulateIsolated } from './sandbox';
import { MATRIX_RESOLUTIONS, MatrixResult, planMatrix, runMatrix } from './core/matrix';

export interface TryItState {
  players: number;
  keyboardPlayer: number; // -1: nobody, EVERY_KEYBOARD: each player their own
  width: number;
  height: number;
}
const STATE_KEY = 'splitscreenme.tryIt';
const DEFAULT_STATE: TryItState = { players: 2, keyboardPlayer: 0, width: 1920, height: 1080 };
const RESOLUTIONS = MATRIX_RESOLUTIONS;
const TEST_ALL = 'splitscreenme.tryItTestAll';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cmd = (id: string, arg?: unknown) => `command:${id}${arg === undefined ? '' : `?${encodeURIComponent(JSON.stringify([arg]))}`}`;
const SET = 'splitscreenme.tryItSet';

/** The panel's HTML (no scripts). Exported for tests. */
export function renderTryIt(r: SimResult, state: TryItState, title: string, matrix?: MatrixResult): string {
  const choice = (label: string, current: boolean, arg: Partial<TryItState>) =>
    current ? `<strong class="choice on">${esc(label)}</strong>` : `<a class="choice" href="${cmd(SET, arg)}">${esc(label)}</a>`;
  const controls = `<div class="controls">
    <span>Players ${[1, 2, 3, 4].map((n) => choice(String(n), state.players === n, { players: n, keyboardPlayer: state.keyboardPlayer >= n ? 0 : state.keyboardPlayer })).join('')}</span>
    <span>Keyboard &amp; mouse ${[...Array(state.players).keys()].map((i) => choice(`P${i + 1}`, state.keyboardPlayer === i, { keyboardPlayer: i })).join('')}${choice('each player their own', state.keyboardPlayer === EVERY_KEYBOARD, { keyboardPlayer: EVERY_KEYBOARD })}${choice('nobody', state.keyboardPlayer === -1, { keyboardPlayer: -1 })}</span>
    <span>Monitor ${RESOLUTIONS.map(([w, h]) => choice(`${w}×${h}`, state.width === w && state.height === h, { width: w, height: h })).join('')}</span>
    <a class="choice" href="${cmd(TEST_ALL)}" title="Every player count, input setup and monitor size">Test all combinations</a></div>`;

  const out: string[] = [];
  if (matrix) out.push(renderMatrix(matrix));
  if (!r.loaded) {
    out.push(`<div class="banner error"><strong>${esc(sessionSummary(r))}</strong> <a href="${cmd('workbench.actions.view.problems')}">Fix the problems</a> first.<div class="mono small">${esc(r.loadError ?? '')}</div></div>`);
  } else {
    out.push(`<div class="banner ${r.sessionEnded ? 'error' : 'ok'}"><strong>${esc(sessionSummary(r))}</strong></div>`);
  }
  if (r.inputNote) out.push(`<p class="muted">${esc(r.inputNote)}</p>`);
  const ignored = groupIgnored(r.ignored);
  if (ignored.length) out.push(`<h3>Settings Nucleus skips (${ignored.length})</h3><ul class="mono warn">${ignored.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`);
  for (const p of r.players) {
    out.push(`<section><h3>Player ${p.index + 1} <span class="tag">${p.index === state.keyboardPlayer || state.keyboardPlayer === EVERY_KEYBOARD ? 'keyboard &amp; mouse' : 'controller'}</span></h3>
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
.matrix { margin: 8px 0 12px; padding: 8px 10px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); border-radius: 4px; }
.matrix table { margin-top: 6px; } .matrix td { padding: 2px 8px 2px 0; }
.cell { text-decoration: none; padding: 1px 7px; border-radius: 10px; display: inline-block; }
.cell.ok { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #3a3) 18%, transparent); }
.cell.fail { background: color-mix(in srgb, var(--vscode-errorForeground) 18%, transparent); }
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

/** The "Test all combinations" table: pick a cell to show that run. */
function renderMatrix(m: MatrixResult): string {
  const { plan } = m;
  const n = plan.jobs.length;
  const rows = Array.from({ length: plan.max }, (_, i) => i + 1).map((p) => `<tr><th>${p} player${p === 1 ? '' : 's'}</th>${plan.modes
    .map((mode) => {
      if (!mode.offered) return `<td class="muted" title="The handler doesn't set Game.SupportsMultipleKeyboardsAndMice = true">not offered</td>`;
      const fails = m.cells.get(`${p}|${mode.kb}`) ?? [];
      const [w, h] = fails.length ? [fails[0].width, fails[0].height] : [1920, 1080];
      const label = fails.length ? `${fails.length} of ${RESOLUTIONS.length} screens fail` : 'all screens';
      return `<td><a class="cell ${fails.length ? 'fail' : 'ok'}" href="${cmd(SET, { players: p, keyboardPlayer: mode.kb, width: w, height: h })}" title="${esc(fails.map((f) => `${f.width}×${f.height}: ${f.why}`).join('\n') || 'Show this run')}">${label}</a></td>`;
    })
    .join('')}</tr>`);
  const fails = [...m.cells.entries()].flatMap(([k, list]) => list.map((f) => ({ k, ...f })));
  return `<div class="matrix"><strong>${m.failed ? `${m.failed} of ${n} combinations fail` : `All ${n} combinations work`}</strong> <span class="muted">up to ${plan.max} player${plan.max === 1 ? '' : 's'} · ${RESOLUTIONS.map(([w, h]) => `${w}×${h}`).join(', ')}</span>
    <table><tr><th></th>${plan.modes.map((x) => `<th>${esc(x.label)}</th>`).join('')}</tr>${rows.join('')}</table>
    ${fails.length ? `<ul class="small">${fails.slice(0, 8).map((f) => { const [p, kb] = f.k.split('|'); return `<li>${p} player${p === '1' ? '' : 's'}, ${esc(plan.modes.find((x) => String(x.kb) === kb)!.label.toLowerCase())}, ${f.width}×${f.height}: ${esc(f.why)}</li>`; }).join('')}${fails.length > 8 ? `<li>…and ${fails.length - 8} more</li>` : ''}</ul>` : ''}
    <p class="muted small">Pick a cell to show that run below. Editing the handler clears this table.</p></div>`;
}

/** Registers the Try it command and its panel. */
export function registerTryIt(context: vscode.ExtensionContext, isHandler: (doc: vscode.TextDocument) => boolean) {
  let panel: vscode.WebviewPanel | undefined;
  let doc: vscode.TextDocument | undefined;
  let timer: NodeJS.Timeout | undefined;
  let state: TryItState = { ...DEFAULT_STATE, ...context.workspaceState?.get<Partial<TryItState>>(STATE_KEY, {}) };
  let matrix: MatrixResult | undefined; // the last "Test all combinations", until the handler changes
  // Shows the Try it button in the editor title bar only for handlers.
  const markHandler = (e: vscode.TextEditor | undefined) => void vscode.commands.executeCommand('setContext', 'splitscreenme.isHandler', !!e && isHandler(e.document));
  markHandler(vscode.window.activeTextEditor);

  const render = () => {
    if (!panel || !doc) return;
    const opts: SimOptions = { players: state.players, width: state.width, height: state.height, keyboardPlayer: state.keyboardPlayer, plugins: doc.isUntitled ? undefined : pluginsFor(doc.fileName) };
    const title = doc.isUntitled ? 'Untitled' : doc.fileName.split(/[\\/]/).pop()!;
    panel.title = `Try it: ${title}`;
    panel.webview.html = renderTryIt(simulateIsolated(doc.getText(), opts), state, title, matrix);
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
          enableCommandUris: [SET, TEST_ALL, 'workbench.actions.view.problems'],
          localResourceRoots: [],
        });
        panel.onDidDispose(() => (panel = undefined), null, context.subscriptions);
      }
      render();
    }),
    vscode.commands.registerCommand(SET, (change: Partial<TryItState>) => {
      const next = { ...state, ...change };
      if (!(next.players >= 1 && next.players <= 16) || (next.keyboardPlayer < -1 && next.keyboardPlayer !== EVERY_KEYBOARD) || next.keyboardPlayer >= next.players) return;
      state = next;
      void context.workspaceState?.update(STATE_KEY, state);
      render();
    }),
    vscode.commands.registerCommand(TEST_ALL, () => {
      if (!doc) return;
      const code = doc.getText();
      const plugins = doc.isUntitled ? undefined : pluginsFor(doc.fileName);
      const plan = planMatrix(simulateIsolated(code, { players: 1, width: 1920, height: 1080, keyboardPlayer: -1, plugins }));
      if (!plan) return void vscode.window.showWarningMessage("Nucleus can't load this handler yet: fix the problems first.");
      matrix = runMatrix(plan, (o) => simulateIsolated(code, o), { plugins });
      render();
    }),
    vscode.workspace.onDidChangeTextDocument((e) => e.document === doc && ((matrix = undefined), schedule())),
    vscode.window.onDidChangeActiveTextEditor((e) => {
      markHandler(e);
      // Follow the handler being edited.
      if (panel && e && e.document !== doc && isHandler(e.document)) {
        doc = e.document;
        matrix = undefined;
        schedule(0);
      }
    }),
  );
}
