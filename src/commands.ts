import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { FEATURES, renderHandler, toHandlerFileName, Feature } from './core/templates';
import { writeZip, handlerPackageEntries } from './core/zip';
import { fetchHandlers, downloadPackage, handlerPageUrl, HubHandler } from './core/hub';
import { lint, looksLikeHandler } from './core/lint';

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
  reg('splitscreenme.browseHub', () => browseHub(context));
  reg('splitscreenme.setupTypes', () => setupTypes(context));
  reg('splitscreenme.openDocs', openDocs);
  reg('splitscreenme.lintWorkspace', () => lintWorkspace(host));
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

async function installHandler(uri?: vscode.Uri) {
  const file = await resolveHandlerFile(uri);
  if (!file) return;
  const text = await fs.readFile(file.fsPath, 'utf8');
  if (!(await confirmNoErrors(text, 'Install'))) return;
  const nucleus = await nucleusFolder();
  if (!nucleus) return;

  const base = path.basename(file.fsPath, '.js');
  const handlers = path.join(nucleus, 'handlers');
  const destJs = path.join(handlers, `${base}.js`);
  if (path.resolve(destJs) === path.resolve(file.fsPath)) {
    vscode.window.showInformationMessage('This handler is already in the Nucleus handlers folder.');
    return;
  }
  const exists = await fs.stat(destJs).then(() => true, () => false);
  if (exists) {
    const ok = await vscode.window.showWarningMessage(`${base}.js already exists in ${handlers}. Overwrite it?`, { modal: true }, 'Overwrite');
    if (ok !== 'Overwrite') return;
  }
  await fs.copyFile(file.fsPath, destJs);
  const assetDir = path.join(path.dirname(file.fsPath), base);
  let copied = 0;
  if (await isDir(assetDir)) {
    for (const f of await listFiles(assetDir)) {
      const dest = path.join(handlers, base, ...f.rel.split('/'));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(f.abs, dest);
      copied++;
    }
  }
  vscode.window.showInformationMessage(
    `Installed ${base}.js${copied ? ` and ${copied} asset file(s)` : ''} to ${handlers}. Restart Nucleus Co-op (or re-add the game) to pick up changes.`,
  );
}

// ---------------------------------------------------------------------------

let hubCache: { at: number; list: HubHandler[] } | undefined;

async function browseHub(context: vscode.ExtensionContext) {
  const list = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Loading handlers from hub.splitscreen.me…' }, async () => {
    if (!hubCache || Date.now() - hubCache.at > 10 * 60_000) hubCache = { at: Date.now(), list: await fetchHandlers() };
    return hubCache.list;
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
  const entries = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Downloading ${pick.h.title}…` }, () => downloadPackage(pick.h));
  const dir = vscode.Uri.joinPath(context.globalStorageUri, 'hub', `${pick.h._id}-v${pick.h.currentVersion}`);
  for (const e of entries) {
    if (e.name.endsWith('/') || !e.data) continue;
    const safe = e.name.split('/').filter((p) => p && p !== '..' && p !== '.');
    if (!safe.length) continue;
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, ...safe), e.data);
  }
  const js = entries.find((e) => e.name === 'handler.js') ?? entries.find((e) => e.name.endsWith('.js') && !e.name.includes('/'));
  if (!js) {
    vscode.window.showWarningMessage('The package has no handler.js.');
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.joinPath(dir, js.name), { preview: false });
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

async function openDocs() {
  const links = [
    { label: 'Handler API reference', url: 'https://www.splitscreen.me/docs/handler-api' },
    { label: 'Creating handlers (guide)', url: 'https://www.splitscreen.me/docs/create-handlers' },
    { label: 'Proto Input', url: 'https://www.splitscreen.me/docs/protoinput' },
    { label: 'FAQ', url: 'https://www.splitscreen.me/docs/faq' },
    { label: 'Nucleus Co-op docs (legacy)', url: 'https://nucleus-coop.github.io/docs/' },
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
