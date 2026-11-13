// What's new: after the extension updates, one note with the highlights of this version's
// CHANGELOG.md section and a button to read it all. Not on a first install; off with
// splitscreenme.showWhatsNew. "Nucleus: What's New" opens the changelog any time.
import * as vscode from 'vscode';
import fs from 'node:fs';

const KEY = 'splitscreenme.lastVersion';

/** The bold summaries of a version's CHANGELOG.md section ("## 0.6.0 · 2026-11-13"; older ones say "(beta)"). */
export function highlights(changelog: string, version: string): string[] {
  const parts = changelog.split(/^## /m);
  const section = parts.find((p) => p.startsWith(version + ' ') || p.startsWith(version + '\n'));
  if (!section) return [];
  return section
    .split(/^### 🙏.*$/m)[0] // what changed, not the thanks
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => (l.match(/^- \*\*(.+?)\*\*/)?.[1] ?? l.slice(2)).replace(/\.$/, ''));
}

export function registerWhatsNew(context: vscode.ExtensionContext) {
  // vsce stores it as changelog.md; from a checkout it is CHANGELOG.md (names are case-sensitive on Linux and macOS).
  const changelog = () => {
    const names = ['changelog.md', 'CHANGELOG.md'].map((n) => vscode.Uri.joinPath(context.extensionUri, n));
    return names.find((u) => fs.existsSync(u.fsPath)) ?? names[1];
  };
  const open = () => vscode.commands.executeCommand('markdown.showPreview', changelog());
  context.subscriptions.push(vscode.commands.registerCommand('splitscreenme.whatsNew', open));
  if (!context.extensionUri) return;

  const version: string | undefined = context.extension?.packageJSON?.version;
  const previous = context.globalState?.get<string>(KEY);
  if (!version || previous === version) return;
  void context.globalState?.update(KEY, version);
  if (!previous || !vscode.workspace.getConfiguration('splitscreenme').get<boolean>('showWhatsNew', true)) return;
  let list: string[] = [];
  try {
    list = highlights(fs.readFileSync(changelog().fsPath, 'utf8'), version);
  } catch {}
  const text = `Nucleus handler tools updated to ${version}${list.length ? `: ${list.slice(0, 3).join(' · ')}${list.length > 3 ? ` (+${list.length - 3} more)` : ''}` : '.'}`;
  void vscode.window.showInformationMessage(text, "What's new", "Don't show again").then((choice) => {
    if (choice === "What's new") open();
    else if (choice === "Don't show again") void vscode.workspace.getConfiguration('splitscreenme').update('showWhatsNew', false, vscode.ConfigurationTarget.Global);
  });
}
