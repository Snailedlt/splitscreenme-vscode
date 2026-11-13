// The docs as pages, for an editor's docs view (VS Code's Nucleus Docs panel) and anyone else who wants them: the
// main page (what's in it), a group (Context, Game…: one line per name), one name, or a search. Plain Markdown with
// links made by the caller, so each tool decides where a link goes. Same views and addresses as the workbench's Docs
// tab (`#docs-Context.ModifySaveFile`, `#docs-Context`, `#docs-mutex`).

import { api, memberMarkdown } from './api';
import { allEntries, Entry, lookup, search } from './lookup';
import { WORKBENCH_URL } from './sharelink';

let pageNames: Set<string> | undefined;
/**
 * A name's own docs page on the site (docs/Context.ModifySaveFile/, built by the workbench's docs-pages.mjs from these
 * same pages): lighter than the workbench and easy to share, with the votes and the report link. A name without a
 * page (a search, an enum value) goes to the workbench's Docs (#docs-…) instead. `ref` says which tool sent the visit.
 */
export function docsPageUrl(path: string, ref: string): string {
  pageNames ??= new Set([...allEntries(true).map((e) => e.path), ...DOCS_GROUPS.map((g) => g.key), ...Object.keys(api.enums).map((n) => `Nucleus.${n}`)]);
  if (path && (!/^[A-Za-z_$][\w$.]*$/.test(path) || !pageNames.has(path))) return `${WORKBENCH_URL}?ref=${encodeURIComponent(ref)}#docs-${encodeURIComponent(path)}`;
  return `${WORKBENCH_URL}docs/${path ? `${path}/` : ''}?ref=${encodeURIComponent(ref)}`;
}

export interface DocsGroup { key: string; title: string; doc: string; match: (path: string) => boolean }
export const DOCS_GROUPS: DocsGroup[] = [
  { key: 'Game', title: 'Game', doc: "The handler's options: the game, its executable, players, mutexes, files and callbacks.", match: (p) => /^Game\.[^.]+$/.test(p) },
  { key: 'Game.Hook', title: 'Game.Hook', doc: 'Focus and input hooks injected into each instance.', match: (p) => p.startsWith('Game.Hook.') },
  { key: 'Game.ProtoInput', title: 'Game.ProtoInput', doc: 'Proto Input settings for the whole session.', match: (p) => p.startsWith('Game.ProtoInput.') },
  { key: 'Context', title: 'Context', doc: "One player's instance, inside Game.Play: launch arguments, folders and files to edit.", match: (p) => p.startsWith('Context.') },
  { key: 'Player', title: 'Player', doc: 'The player Game.Play runs for (also PlayerList[i]): screen, controller, nickname.', match: (p) => p.startsWith('Player.') },
  { key: 'ProtoInput', title: 'ProtoInput', doc: 'Proto Input calls at runtime, inside Game.Play and other callbacks.', match: (p) => p.startsWith('ProtoInput.') },
  { key: 'Hub', title: 'Hub (written by the Hub)', doc: "Lines hub.splitscreen.me writes into a handler when it is uploaded. You don't add or change them.", match: (p) => p.startsWith('Hub.') },
  { key: 'System', title: '.NET (System.*)', doc: 'Files, folders, paths and the environment, through .NET.', match: (p) => p.startsWith('System.') },
];

export interface DocsCrumb { label: string; view?: string }
export interface DocsPage { view: string; crumbs: DocsCrumb[]; markdown: string; /** The name this page is about, for "Open in the workbench". */ path?: string }

/** The view a `#docs-…` value stands for: `''` → home, a group key → that group, anything else → a name or search. */
export function docsView(value: string): string {
  if (!value) return 'home';
  return DOCS_GROUPS.some((g) => g.key === value) ? `group:${value}` : `q:${value}`;
}
/** The `#docs-…` value of a view (the inverse of docsView). */
export const docsValue = (view: string) => (view === 'home' ? '' : view.replace(/^(group|q):/, ''));

const firstLine = (s?: string) => {
  const t = (s ?? '').split('\n')[0].replace(/[`*\\]/g, '');
  return t.length <= 140 ? t : t.slice(0, 140).replace(/\s+\S*$/, '') + '…';
};
const groupOf = (path: string) => DOCS_GROUPS.find((g) => g.match(path));

/** One page. `link(value)` makes a link to another page (a `#docs-…` value). */
export function docsPage(view: string, link: (value: string) => string): DocsPage {
  const entries = allEntries(true);
  const line = (e: Entry) => `- [\`${e.path}\`](${link(e.path)})${e.member.kind === 'method' ? '' : ` · ${e.member.ts ?? ''}`}${firstLine(e.member.doc) ? ` — ${firstLine(e.member.doc)}` : ''}`;
  if (view === 'home') {
    const groups = DOCS_GROUPS.map((g) => `- [${g.title}](${link(g.key)}) · ${entries.filter((e) => g.match(e.path)).length} — ${g.doc}`).join('\n');
    const enums = Object.keys(api.enums).sort().map((n) => `[\`Nucleus.${n}\`](${link(`Nucleus.${n}`)})`).join(' · ');
    return { view, crumbs: [], markdown: `Every option, Context member, enum and .NET call a handler can use, with what Nucleus does with it.\n\n## Browse\n\n${groups}\n\n## Nucleus values (enums)\n\n${enums}` };
  }
  if (view.startsWith('group:')) {
    const g = DOCS_GROUPS.find((x) => x.key === view.slice(6));
    if (!g) return docsPage('home', link);
    const list = entries.filter((e) => g.match(e.path)).sort((a, b) => a.path.localeCompare(b.path));
    return { view, crumbs: [{ label: g.title }], markdown: `${g.doc}\n\n${list.map(line).join('\n')}` };
  }
  const q = view.slice(2).trim();
  const exact = lookup(q);
  if (exact.kind === 'entries' && exact.entries.length === 1) {
    const e = exact.entries[0];
    const g = groupOf(e.path);
    const name = g && e.path.startsWith(g.key + '.') ? e.path.slice(g.key.length + 1) : e.path;
    return { view, path: e.path, crumbs: [...(g ? [{ label: g.title, view: `group:${g.key}` }] : []), { label: name }], markdown: `## ${e.path}\n\n${memberMarkdown(e.owner, e.name, e.member)}` };
  }
  if (exact.kind === 'enum') {
    const users = entries.filter((e) => e.member.ts?.includes(exact.name) || e.member.ref === exact.name);
    return { view, path: `Nucleus.${exact.name}`, crumbs: [{ label: 'Nucleus values' }, { label: `Nucleus.${exact.name}` }], markdown: `## enum Nucleus.${exact.name}\n\n${exact.doc ?? ''}\n\n${Object.entries(exact.values).map(([k, v]) => `- \`${k}\` = ${v}`).join('\n')}${users.length ? `\n\n## Options that take it\n\n${users.map(line).join('\n')}` : ''}` };
  }
  if (exact.kind === 'class') return { view, path: `Nucleus.${exact.name}`, crumbs: [{ label: `new Nucleus.${exact.name}` }], markdown: `## new Nucleus.${exact.name}(${exact.params.join(', ')})\n\n${exact.doc}` };
  if (api.globals[q]) {
    const g = api.globals[q];
    const grp = DOCS_GROUPS.find((x) => x.key === q);
    return { view, path: q, crumbs: [{ label: q }], markdown: `## ${q}: ${g.type}\n\n${g.doc}${grp ? `\n\n[All of ${q}](${link(grp.key)})` : ''}` };
  }
  const found = (exact.kind === 'entries' ? exact.entries : []).concat(search(q, 30).filter((e) => !(exact.kind === 'entries' && exact.entries.includes(e)))).slice(0, 30);
  const dym = exact.kind === 'none' && exact.didYouMean ? `"${q}" isn't part of the handler API. Did you mean [\`${exact.didYouMean}\`](${link(exact.didYouMean)})?\n\n` : '';
  return { view, crumbs: [{ label: `Results for "${q}"` }], markdown: dym + (found.length ? found.map(line).join('\n') : `Nothing matches "${q}".`) };
}

