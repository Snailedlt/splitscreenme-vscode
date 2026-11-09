import { workbenchLinkFor } from './workbenchlink';
import { WORKBENCH_URL } from './core/sharelink';
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { FEATURES, renderHandler, toHandlerFileName, Feature } from './core/templates';
import { writeZip, handlerPackageEntries } from './core/zip';
import { handlerPageUrl, HubHandler } from './core/hub';
import { hubHandlers, hubPackage } from './hubcache';
import { lint, looksLikeHandler } from './core/lint';
import { findSkillDir, installAgentKit } from './core/pkg';
import { gameFolderName } from './core/pkgcheck';
import { installHandler as installFiles, InstallError } from './install';
import { AFTER_START, debugLogOn, debugLogPath, nucleusStatus, setDebugLog, stopNucleus, testInNucleus } from './nucleusrun';

export interface CommandHost {
  lintFiles(entries: { uri: vscode.Uri; text: string }[]): void;
}

export function registerCommands(context: vscode.ExtensionContext, host: CommandHost) {
  const reg = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args) => {
        try {
          await fn(...args);
        } catch (e: any) {
          vscode.window.showErrorMessage(`SplitScreen.Me: ${e?.message ?? e}`);
        }
      }),
    );

  reg('splitscreenme.newHandler', newHandler);
  reg('splitscreenme.packageHandler', (uri?: vscode.Uri) => packageHandler(uri));
  reg('splitscreenme.installHandler', (uri?: vscode.Uri) => installHandler(uri));
  reg('splitscreenme.testInNucleus', (uri?: vscode.Uri) => testHandlerInNucleus(context, uri));
  reg('splitscreenme.openNucleusLog', openNucleusLog);
  reg('splitscreenme.browseHub', () => browseHub(context));
  reg('splitscreenme.setupTypes', () => setupTypes(context));
  reg('splitscreenme.openDocs', openDocs);
  reg('splitscreenme.openInWorkbench', openInWorkbench);
  reg('splitscreenme.lintWorkspace', () => lintWorkspace(host));
  reg('splitscreenme.setupAgents', () => setupAgents(context));
}

// ---------------------------------------------------------------------------

async function newHandler() {
  const gameName = await vscode.window.showInputBox({
    title: 'New Nucleus handler (1/4)',
    prompt: 'Game name, as shown in Nucleus',
    placeHolder: 'e.g. Borderlands 2',
    validateInput: (v) => (v.trim() ? undefined : 'Required'),
  });
  if (!gameName) return;
  const executableName = await vscode.window.showInputBox({
    title: 'New Nucleus handler (2/4)',
    prompt: 'Game executable file name (used to find the game)',
    placeHolder: 'e.g. Borderlands2.exe',
    validateInput: (v) => (/^[^\\/:*?"<>|]+\.exe$/i.test(v.trim()) ? undefined : 'Enter a file name ending in .exe'),
  });
  if (!executableName) return;
  const steamId = await vscode.window.showInputBox({
    title: 'New Nucleus handler (3/4)',
    prompt: 'Steam app ID (optional, find it on steamdb.info)',
    validateInput: (v) => (!v || /^\d+$/.test(v.trim()) ? undefined : 'Digits only'),
  });
  if (steamId === undefined) return;
  const picked = await vscode.window.showQuickPick(
    FEATURES.map((f) => ({ label: f.label, detail: f.detail, id: f.id })),
    { title: 'New Nucleus handler (4/4): optional features', canPickMany: true },
  );
  if (!picked) return;

  const content = renderHandler({
    gameName: gameName.trim(),
    executableName: executableName.trim(),
    steamId: steamId.trim() || undefined,
    features: picked.map((p) => p.id as Feature),
  });

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const fileName = `${toHandlerFileName(gameName)}.js`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, fileName) : undefined,
    filters: { 'Nucleus handler': ['js'] },
    title: 'Save handler',
  });
  if (!target) {
    const doc = await vscode.workspace.openTextDocument({ language: 'javascript', content });
    await vscode.window.showTextDocument(doc);
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
  await vscode.window.showTextDocument(target);
}

// ---------------------------------------------------------------------------

async function resolveHandlerFile(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri?.fsPath.endsWith('.js')) return uri;
  const active = vscode.window.activeTextEditor?.document;
  if (active && active.languageId === 'javascript' && !active.isUntitled) {
    if (active.isDirty) await active.save();
    return active.uri;
  }
  const picked = await vscode.window.showOpenDialog({ filters: { 'Nucleus handler': ['js'] }, title: 'Select a handler' });
  return picked?.[0];
}

async function listFiles(dir: string, base = dir): Promise<{ rel: string; abs: string }[]> {
  const out: { rel: string; abs: string }[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(abs, base)));
    else if (e.isFile()) out.push({ rel: path.relative(base, abs).split(path.sep).join('/'), abs });
  }
  return out;
}

async function isDir(p: string) {
  return fs.stat(p).then((s) => s.isDirectory(), () => false);
}

/** Refuse to ship a handler Nucleus won't load, unless the user insists. */
async function confirmNoErrors(text: string, action: string): Promise<boolean> {
  const errors = lint(text).filter((d) => d.severity === 'error');
  if (!errors.length) return true;
  const choice = await vscode.window.showWarningMessage(
    `This handler has ${errors.length} error(s), e.g. "${errors[0].message}". ${action} anyway?`,
    { modal: true },
    `${action} anyway`,
  );
  return choice === `${action} anyway`;
}

async function packageHandler(uri?: vscode.Uri) {
  const file = await resolveHandlerFile(uri);
  if (!file) return;
  const js = await fs.readFile(file.fsPath);
  if (!(await confirmNoErrors(js.toString('utf8'), 'Package'))) return;

  const base = path.basename(file.fsPath, '.js');
  const assetDir = path.join(path.dirname(file.fsPath), base);
  const files = (await isDir(assetDir)) ? await listFiles(assetDir) : [];
  const entries = handlerPackageEntries(
    js,
    base,
    await Promise.all(files.map(async (f) => ({ rel: f.rel, data: await fs.readFile(f.abs) }))),
  );

  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(path.dirname(file.fsPath), `${base}.nc`)),
    filters: { 'Nucleus handler package': ['nc', 'zip'] },
    title: 'Save handler package',
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, writeZip(entries));
  const msg = files.length
    ? `Packaged handler.js and ${files.length} file(s) from "${base}/" into ${path.basename(target.fsPath)}.`
    : `Packaged ${path.basename(target.fsPath)} (no "${base}/" asset folder found next to the handler).`;
  const choice = await vscode.window.showInformationMessage(msg, 'Upload on the Hub');
  if (choice) vscode.env.openExternal(vscode.Uri.parse('https://hub.splitscreen.me/'));
}

// ---------------------------------------------------------------------------

async function nucleusFolder(): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration('splitscreenme');
  const configured = cfg.get<string>('nucleusPath');
  if (configured && (await isDir(path.join(configured, 'handlers')))) return configured;
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    title: 'Select your Nucleus Co-op folder (the one containing NucleusCoop.exe and "handlers")',
  });
  const dir = picked?.[0]?.fsPath;
  if (!dir) return undefined;
  if (!(await isDir(path.join(dir, 'handlers')))) {
    vscode.window.showErrorMessage(`"${dir}" has no "handlers" folder. Select the Nucleus Co-op installation folder.`);
    return undefined;
  }
  await cfg.update('nucleusPath', dir, vscode.ConfigurationTarget.Global);
  return dir;
}

/** Install the handler and start Nucleus Co-op on its game: the real test, one click away (src/nucleusrun.ts). */
async function testHandlerInNucleus(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const file = await resolveHandlerFile(uri);
  if (!file) return;
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === file.toString());
  if (doc?.isDirty) await doc.save(); // what's tested is what's on screen
  const text = await fs.readFile(file.fsPath, 'utf8');
  if (!(await confirmNoErrors(text, 'Test'))) return;
  const nucleus = await nucleusFolder();
  if (!nucleus) return;
  const status = nucleusStatus(nucleus);
  if (!status.canStart) {
    vscode.window.showWarningMessage(`Nucleus: ${status.why}`);
    return;
  }
  if (status.running) {
    const ok = await vscode.window.showWarningMessage('Nucleus Co-op is open. It reads handlers when it starts: close it and start it again with this handler?', { modal: true }, 'Restart Nucleus Co-op');
    if (ok !== 'Restart Nucleus Co-op') return;
    await stopNucleus();
  }
  // The debug log is what tells you why something went wrong: offer it once, remember the answer.
  if (status.debugLog === false && !context.globalState.get('nucleus.debugLogAsked')) {
    const on = await vscode.window.showInformationMessage("Turn on Nucleus' debug log? debug-log.txt then says what Nucleus did, step by step: the first thing to read when a test goes wrong.", 'Turn it on', 'Not now');
    await context.globalState.update('nucleus.debugLogAsked', true);
    if (on === 'Turn it on') setDebugLog(nucleus, true);
  }
  testInNucleus(file.fsPath, nucleus);
  const pick = await vscode.window.showInformationMessage(AFTER_START, ...(debugLogOn(nucleus) ? ['Open the Debug Log'] : []));
  if (pick) await openNucleusLog();
}

async function openNucleusLog() {
  const nucleus = await nucleusFolder();
  if (!nucleus) return;
  const log = debugLogPath(nucleus);
  if (!(await fs.stat(log).then(() => true, () => false))) {
    vscode.window.showInformationMessage(`Nucleus: there's no debug-log.txt in ${nucleus} yet. Turn on the debug log in Nucleus' settings (or answer yes when testing), then run a test.`);
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(log), { preview: true });
}

async function installHandler(uri?: vscode.Uri) {
  const file = await resolveHandlerFile(uri);
  if (!file) return;
  const text = await fs.readFile(file.fsPath, 'utf8');
  if (!(await confirmNoErrors(text, 'Install'))) return;
  const nucleus = await nucleusFolder();
  if (!nucleus) return;

  const base = path.basename(file.fsPath, '.js');
  const handlers = path.join(nucleus, 'handlers');
  let overwrite = false;
  if (await fs.stat(path.join(handlers, `${base}.js`)).then(() => true, () => false)) {
    const ok = await vscode.window.showWarningMessage(`${base}.js already exists in ${handlers}. Overwrite it?`, { modal: true }, 'Overwrite');
    if (ok !== 'Overwrite') return;
    overwrite = true;
  }
  let copied = 0;
  try {
    copied = installFiles(file.fsPath, nucleus, { overwrite }).assets;
  } catch (e) {
    if (e instanceof InstallError && e.code === 'same-file') vscode.window.showInformationMessage(e.message);
    else vscode.window.showErrorMessage(`Couldn't install: ${(e as Error).message}`);
    return;
  }
  vscode.window.showInformationMessage(
    `Installed ${base}.js${copied ? ` and ${copied} asset file(s)` : ''} to ${handlers}. Restart Nucleus Co-op (or re-add the game) to pick up changes.`,
  );
}

// ---------------------------------------------------------------------------


async function browseHub(context: vscode.ExtensionContext) {
  const list = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Loading handlers from hub.splitscreen.me…' }, async () => {
    return hubHandlers(); // cached for an hour, shared with the CLI and the MCP server
  });
  type Item = vscode.QuickPickItem & { h: HubHandler };
  const items: Item[] = list.map((h) => ({
    label: `${h.verified ? '$(verified) ' : ''}${h.title}`,
    description: `${h.gameName} · by ${h.ownerName}`,
    detail: [
      `${(h.downloadCount ?? 0).toLocaleString()} downloads`,
      h.stars ? `${h.stars} stars` : '',
      h.maxPlayers ? `up to ${h.maxPlayers} players` : '',
      h.playableMultiMouseKeyboard ? 'multiple keyboards & mice' : '',
      `v${h.currentVersion}`,
    ]
      .filter(Boolean)
      .join(' · '),
    h,
  }));
  const pick = await vscode.window.showQuickPick(items, { title: 'Nucleus Co-op handlers on hub.splitscreen.me', matchOnDescription: true, placeHolder: 'Search by game or handler name' });
  if (!pick) return;
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(code) Open handler source', id: 'source', detail: 'Download the package and open its handler.js (great for learning how others solved a problem).' },
      { label: '$(link-external) Open on hub.splitscreen.me', id: 'web' },
    ],
    { title: pick.h.title },
  );
  if (!action) return;
  if (action.id === 'web') {
    vscode.env.openExternal(vscode.Uri.parse(handlerPageUrl(pick.h._id)));
    return;
  }
  const entries = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Downloading ${pick.h.title}…` }, () => hubPackage(pick.h));
  const js = entries.find((e) => e.name === 'handler.js') ?? entries.find((e) => e.name.endsWith('.js') && !e.name.includes('/'));
  if (!js?.data) {
    vscode.window.showWarningMessage('The package has no handler.js.');
    return;
  }
  // Laid out the way a Hub install puts it (AGENTS.md): <GameName>.js, and the contents of every top-level folder merged
  // into <GameName>/ (Game.Folder). Other files at the package root are dropped by the install, so they're left out here.
  const handlerText = Buffer.from(js.data).toString('utf8');
  // Never "." or ".." (the workspace itself or its parent would be overwritten below): a safe single folder name.
  const game = toHandlerFileName(gameFolderName(handlerText));
  const dir = vscode.Uri.joinPath(context.globalStorageUri, 'hub', `${pick.h._id}-v${pick.h.currentVersion}`);
  const handlerUri = vscode.Uri.joinPath(dir, `${game}.js`);
  await vscode.workspace.fs.writeFile(handlerUri, js.data);
  let others = 0;
  let dropped = 0;
  for (const e of entries) {
    if (e === js || e.name.endsWith('/') || !e.data) continue;
    const parts = e.name.split('/').filter((p) => p && p !== '..' && p !== '.');
    if (parts.length < 2) {
      dropped++;
      continue;
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, game, ...parts.slice(1)), e.data);
    others++;
  }
  await vscode.window.showTextDocument(handlerUri, { preview: false });
  if (!others) return;
  const choice = await vscode.window.showInformationMessage(
    `${pick.h.title} comes with ${others} other file${others === 1 ? '' : 's'} in "${game}/"${dropped ? ` (${dropped} more at the package root, which a Hub install drops)` : ''}.`,
    'Open as Folder',
    'Copy into Workspace',
  );
  if (choice === 'Open as Folder') await vscode.commands.executeCommand('vscode.openFolder', dir, { forceNewWindow: true });
  else if (choice === 'Copy into Workspace') {
    const ws = vscode.workspace.workspaceFolders?.length === 1 ? vscode.workspace.workspaceFolders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: `Copy ${game}.js and ${game}/ into…` });
    if (!ws) {
      vscode.window.showWarningMessage('Open a folder first (File › Open Folder…), then copy the handler into it.');
      return;
    }
    const target = vscode.Uri.joinPath(ws.uri, `${game}.js`);
    try {
      await vscode.workspace.fs.stat(target);
      const ok = await vscode.window.showWarningMessage(`${game}.js is already in ${ws.name}. Replace it and its folder?`, { modal: true }, 'Replace');
      if (ok !== 'Replace') return;
    } catch {
      /* not there yet */
    }
    await vscode.workspace.fs.copy(handlerUri, target, { overwrite: true });
    await vscode.workspace.fs.copy(vscode.Uri.joinPath(dir, game), vscode.Uri.joinPath(ws.uri, game), { overwrite: true });
    await vscode.window.showTextDocument(target, { preview: false });
  }
}

// ---------------------------------------------------------------------------

async function setupTypes(context: vscode.ExtensionContext) {
  const folder =
    vscode.workspace.workspaceFolders?.length === 1
      ? vscode.workspace.workspaceFolders[0]
      : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Install handler type definitions into…' });
  if (!folder) {
    vscode.window.showWarningMessage('Open a folder containing your handlers first.');
    return;
  }
  const dts = await fs.readFile(context.asAbsolutePath(path.join('types', 'nucleus.d.ts')));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder.uri, '.vscode', 'nucleus.d.ts'), dts);

  const jsconfigUri = vscode.Uri.joinPath(folder.uri, 'jsconfig.json');
  const desired = {
    compilerOptions: { target: 'ES5', lib: ['ES5'], checkJs: false, noImplicitAny: false },
    include: ['**/*.js', '.vscode/nucleus.d.ts'],
  };
  // undefined: no jsconfig.json yet; null: exists but unparsable (e.g. has comments).
  let existing: any;
  let raw: string | undefined;
  try {
    raw = Buffer.from(await vscode.workspace.fs.readFile(jsconfigUri)).toString('utf8');
  } catch (e) {
    if (!(e instanceof vscode.FileSystemError && e.code === 'FileNotFound')) throw e;
  }
  if (raw !== undefined) {
    try {
      existing = JSON.parse(raw);
    } catch {
      existing = null;
      vscode.window.showWarningMessage('jsconfig.json could not be parsed; add ".vscode/nucleus.d.ts" to its "include" list yourself.');
    }
  }
  if (existing === undefined) {
    await vscode.workspace.fs.writeFile(jsconfigUri, Buffer.from(JSON.stringify(desired, null, 2) + '\n'));
  } else if (existing) {
    existing.include = Array.from(new Set([...(existing.include ?? ['**/*.js']), '.vscode/nucleus.d.ts']));
    await vscode.workspace.fs.writeFile(jsconfigUri, Buffer.from(JSON.stringify(existing, null, 2) + '\n'));
  }
  // The TypeScript service now provides completion/hover; avoid duplicate entries.
  await vscode.workspace.getConfiguration('splitscreenme', folder.uri).update('completion.enable', false, vscode.ConfigurationTarget.WorkspaceFolder);
  vscode.window.showInformationMessage(
    'Installed Nucleus type definitions (.vscode/nucleus.d.ts + jsconfig.json). Add "// @ts-check" to the top of a handler for type checking.',
  );
}

// ---------------------------------------------------------------------------

/** The open handler in the browser workbench (its visual editor, Lines, Test all…), through a share link. */
async function openInWorkbench() {
  const doc = vscode.window.activeTextEditor?.document;
  const text = doc && /\.js$/i.test(doc.fileName) ? doc.getText() : undefined;
  const { url, withHandler } = workbenchLinkFor(text, 'vscode');
  await vscode.env.openExternal(vscode.Uri.parse(url, true));
  if (text !== undefined && !withHandler) vscode.window.showInformationMessage('This handler is too large to pass in a link: in the workbench, use Open file… to open it.');
}

async function openDocs() {
  const links = [
    { label: 'Handler API reference', url: 'https://www.splitscreen.me/docs/handler-api' },
    { label: 'Creating handlers (guide)', url: 'https://www.splitscreen.me/docs/create-handlers' },
    { label: 'Proto Input', url: 'https://www.splitscreen.me/docs/protoinput' },
    { label: 'FAQ', url: 'https://www.splitscreen.me/docs/faq' },
    { label: 'Nucleus Co-op docs (legacy)', url: 'https://nucleus-coop.github.io/docs/' },
    { label: 'Browser workbench (Nucleus: Open in the Browser Workbench opens this handler there)', url: `${WORKBENCH_URL}?ref=vscode` },
    { label: 'Handler hub', url: 'https://hub.splitscreen.me/' },
    { label: 'Nucleus Co-op source code', url: 'https://github.com/SplitScreen-Me/splitscreenme-nucleus' },
    { label: 'PCGamingWiki (check input & multiplayer support)', url: 'https://www.pcgamingwiki.com/wiki/Home' },
    { label: 'r/nucleuscoop', url: 'https://www.reddit.com/r/nucleuscoop/' },
  ];
  const pick = await vscode.window.showQuickPick(links.map((l) => ({ label: l.label, detail: l.url, url: l.url })), { title: 'SplitScreen.Me documentation' });
  if (pick) vscode.env.openExternal(vscode.Uri.parse(pick.url));
}

async function lintWorkspace(host: CommandHost) {
  const uris = await vscode.workspace.findFiles('**/*.js', '**/{node_modules,.git,dist,out}/**');
  const entries: { uri: vscode.Uri; text: string }[] = [];
  for (const uri of uris) {
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8').replace(/^﻿/, '');
    if (looksLikeHandler(text) || /[\\/]handlers[\\/][^\\/]+\.js$/i.test(uri.fsPath)) entries.push({ uri, text });
  }
  host.lintFiles(entries);
  vscode.window.showInformationMessage(`Linted ${entries.length} handler(s). See the Problems panel.`);
  vscode.commands.executeCommand('workbench.actions.view.problems');
}

// ---------------------------------------------------------------------------

async function setupAgents(context: vscode.ExtensionContext) {
  const folder =
    vscode.workspace.workspaceFolders?.length === 1
      ? vscode.workspace.workspaceFolders[0]
      : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Install AI agent support into…' });
  if (!folder || folder.uri.scheme !== 'file') {
    vscode.window.showWarningMessage('Open the folder containing your handlers first.');
    return;
  }
  const skillDir = findSkillDir(context.extensionPath);
  if (!skillDir) throw new Error('The agent skill files are missing from this extension install.');
  const r = installAgentKit(skillDir, folder.uri.fsPath);
  const changed = [...r.created, ...r.updated];
  const choice = await vscode.window.showInformationMessage(
    `AI agent support installed (${changed.join(', ')}). Agents such as Claude Code, Copilot, Codex and Cursor will read AGENTS.md and can run the bundled linter.`,
    'Open AGENTS.md',
  );
  if (choice) await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, 'AGENTS.md'));
}
