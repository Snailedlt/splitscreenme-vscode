// API lookup/search for agents and the CLI (`nucleus api ...`), and the
// Markdown API reference shipped with the agent skill.
import { api, claudeNote, Member, memberSignature, ownerLabel, suggest } from './api';

export interface Entry {
  /** Display path, e.g. "Game.Hook.ForceFocus". */
  path: string;
  owner: string;
  name: string;
  member: Member;
}

const ROOTS: [string, string][] = [
  ['Game', 'Game'],
  ['GameHook', 'Game.Hook'],
  ['GameProtoInput', 'Game.ProtoInput'],
  ['Context', 'Context'],
  ['PlayerInfo', 'Player'],
  ['ProtoInputRuntime', 'ProtoInput'],
  ['ProtoInputValues', 'ProtoInput.Values'],
  ['HubHandler', 'Hub.Handler'],
  ['HubMaintainer', 'Hub.Maintainer'],
  ['System.IO.File', 'System.IO.File'],
  ['System.IO.Directory', 'System.IO.Directory'],
  ['System.IO.Path', 'System.IO.Path'],
  ['System.Environment', 'System.Environment'],
  ['System.Threading.Thread', 'System.Threading.Thread'],
];

const caches: Record<string, Entry[]> = {};
/** Every API member handlers can use. With `withHub`, also the `Hub.*` lines hub.splitscreen.me writes on upload:
 *  for the reference and lookups (so they're explained), never for completion or the Lines list. */
export function allEntries(withHub = false): Entry[] {
  const key = String(withHub);
  if (caches[key]) return caches[key];
  const out: Entry[] = (caches[key] = []);
  for (const [owner, label] of ROOTS) {
    for (const [name, member] of Object.entries(api.objects[owner].members)) {
      if (member.internal && !(withHub && owner.startsWith('Hub'))) continue;
      out.push({ path: `${label}.${name}`, owner, name, member });
    }
  }
  return out;
}

/** Normalise "player.X" / "PlayerList[i].X" / "Nucleus.X" spellings. */
function normalise(q: string): string {
  return q
    .trim()
    .replace(/^PlayerList\[[^\]]*\]\./, 'Player.')
    .replace(/^player\./, 'Player.')
    .replace(/\(\)$/, '');
}

export type LookupResult =
  | { kind: 'entries'; entries: Entry[] }
  | { kind: 'enum'; name: string; values: Record<string, number>; doc?: string }
  | { kind: 'class'; name: string; params: string[]; doc: string }
  | { kind: 'none'; didYouMean?: string };

/** Exact lookup by path ("Game.KillMutex") or bare member name ("KillMutex"). */
export function lookup(query: string): LookupResult {
  const q = normalise(query);
  const entries = allEntries(true);
  // Paths follow Jint's rule: only the first letter of a member name may differ in case.
  const jintEq = (a: string, b: string) => a === b || (a.length === b.length && a[0].toLowerCase() === b[0].toLowerCase() && a.slice(1) === b.slice(1));
  const byPath = entries.filter((e) => {
    const [pa, pb] = [e.path.split('.'), q.split('.')];
    return pa.length === pb.length && pa.every((seg, i) => jintEq(seg, pb[i]));
  });
  if (byPath.length) return { kind: 'entries', entries: byPath };
  const en = q.replace(/^Nucleus\./, '');
  const [enumName, value] = en.split('.');
  if (api.enums[enumName]) {
    const e = api.enums[enumName];
    return value && e.values[value] !== undefined
      ? { kind: 'enum', name: enumName, values: { [value]: e.values[value] }, doc: e.doc }
      : { kind: 'enum', name: enumName, values: e.values, doc: e.doc };
  }
  if (api.nucleusClasses[en]) return { kind: 'class', name: en, ...api.nucleusClasses[en] };
  if (!q.includes('.')) {
    const byName = entries.filter((e) => e.name.toLowerCase() === q.toLowerCase());
    if (byName.length) return { kind: 'entries', entries: byName };
  }
  return { kind: 'none', didYouMean: suggest(q, entries.map((e) => e.path)) ?? suggest(q.split('.').pop() ?? q, entries.map((e) => e.name)) };
}

/** Ranked free-text search over names and docs. */
export function search(query: string, limit = 20): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = allEntries(true)
    .map((e) => {
      const name = e.path.toLowerCase();
      const doc = `${e.member.doc} ${e.member.category ?? ''}`.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (e.name.toLowerCase() === w) score += 20;
        else if (name.includes(w)) score += 8;
        if (doc.includes(w)) score += 3;
        else if (!name.includes(w)) return { e, score: -1 };
      }
      if (e.member.deprecated) score -= 4;
      // Context.X fields that mirror Game.X are rarely what you want to set.
      if (e.owner === 'Context' && api.objects.Game.members[e.name] && e.member.kind !== 'method') score -= 5;
      if (!e.member.doc) score -= 1;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    // Equal scores: the shorter name first ("mutex" finds KillMutex before KillLastInstanceMutex), then A–Z.
    .sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length || a.e.path.localeCompare(b.e.path));
  return scored.slice(0, limit).map((x) => x.e);
}

export function formatEntry(e: Entry, verbose = true): string {
  const m = e.member;
  const lines = memberSignature(e.owner, e.name, m);
  const meta: string[] = [];
  if (m.default !== undefined) meta.push(`default: ${m.default}`);
  if (m.category) meta.push(`category: ${m.category}`);
  if (m.required) meta.push('REQUIRED');
  if (m.readonly) meta.push('read-only');
  if (meta.length) lines.push(`  (${meta.join('; ')})`);
  if (m.deprecated) lines.push(`  ${m.deprecated}`);
  if (verbose && m.doc) lines.push(...m.doc.split('\n').map((l) => `  ${l}`));
  if (verbose && claudeNote(m)) lines.push(`  [${claudeNote(m)}]`);
  if (verbose && m.example) lines.push(`  Example: ${m.example}`);
  return lines.join('\n');
}

/** Full Markdown reference (one heading per member, so it greps well). */
export function markdownReference(): string {
  const out: string[] = [
    '# Nucleus Co-op handler API reference',
    '',
    `Generated from the Nucleus Co-op sources${api.source.nucleus ? ` (SplitScreen-Me/splitscreenme-nucleus@${api.source.nucleus})` : ''} and the splitscreen.me docs. Do not edit by hand.`,
    '',
    'Each entry: `### Path`, then the type, then notes. Types use TypeScript notation. A `string` parameter also accepts numbers and booleans (Jint converts them). A `.NET params T[]` parameter accepts either separate arguments or one JS array.',
    '',
    'Globals: `Game`, `Hub`, `Nucleus`, `System` (.NET), `importNamespace` are available everywhere. `Context`, `Player`, `PlayerList`, `Handler` and `ProtoInput` are ONLY available inside callbacks such as `Game.Play`.',
    '',
  ];
  for (const [owner, label] of ROOTS) {
    out.push(`## ${label}`, '', api.objects[owner].doc, '');
    const entries = allEntries(true).filter((e) => e.owner === owner).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const m = e.member;
      out.push(`### ${e.path}`);
      out.push('`' + memberSignature(owner, e.name, m).join('` / `').replace(`${ownerLabel(owner)}.`, '') + '`');
      const meta: string[] = [];
      if (m.required) meta.push('**required**');
      if (m.readonly) meta.push('read-only');
      if (m.default !== undefined) meta.push(`default \`${m.default}\``);
      if (m.category) meta.push(m.category);
      if (meta.length) out.push(meta.join(' · '));
      if (m.deprecated) out.push(`**${m.deprecated}**`);
      if (m.doc) out.push(m.doc);
      if (claudeNote(m)) out.push(`_✎ ${claudeNote(m)}_`);
      if (m.example) out.push('Example: `' + m.example + '`');
      out.push('');
    }
  }
  out.push('## Nucleus enums', '');
  for (const [name, e] of Object.entries(api.enums)) {
    out.push(`### Nucleus.${name}`, e.doc ?? '', Object.entries(e.values).map(([k, v]) => `\`${k}\` = ${v}`).join(', '), '');
  }
  out.push('## Nucleus classes', '');
  for (const [name, c] of Object.entries(api.nucleusClasses)) {
    out.push(`### Nucleus.${name}`, '`new Nucleus.' + name + '(' + c.params.join(', ') + ')`', c.doc, '');
  }
  return out.join('\n');
}
