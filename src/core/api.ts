// Typed access to the generated Nucleus handler API model (data/nucleus-api.json).
import raw from '../../data/nucleus-api.json';
import { DOTNET_OBJECTS } from './dotnet';

export type SimpleType =
  | 'string'
  | 'boolean'
  | 'number'
  | 'string[]'
  | 'number[]'
  | 'boolean[]'
  | 'function'
  | 'array'
  | 'void'
  | 'any'
  | `enum:${string}`;

export interface Param {
  name: string;
  type: string;
  csType?: string;
  rest?: boolean;
  optional?: boolean;
}
export interface Overload {
  returns: string;
  params: Param[];
}
export interface Member {
  kind: 'field' | 'property' | 'method' | 'object';
  csType?: string;
  type?: SimpleType;
  ts?: string;
  ref?: string;
  default?: string;
  readonly?: boolean;
  internal?: boolean;
  required?: boolean;
  doc: string;
  /** Set when the doc was written by Claude (data/claude-docs.json) rather than taken from the official docs. */
  docBy?: 'claude';
  /** What a Claude-written doc is based on (source files and functions). */
  docBasis?: string;
  /** A person who checked a Claude-written doc against Nucleus (data/claude-docs.json "checkedBy"), and when. */
  docCheckedBy?: string;
  docCheckedOn?: string;
  example?: string;
  category?: string;
  deprecated?: string;
  /** Legacy input option the Proto Input guide says to set to false. */
  protoInputLegacy?: boolean;
  overloads?: Overload[];
}
export interface ApiObject {
  doc: string;
  members: Record<string, Member>;
  /** Not every member is listed (.NET `System.*`): an unlisted one is allowed unless it looks like a typo. */
  open?: boolean;
}
export interface NucleusClass {
  doc: string;
  /** Parameters of the (first) constructor. */
  params: string[];
  /** All constructors, when there is more than one (or none: a static class). */
  constructors?: string[][];
  /** Static members, as an object in `objects` (Nucleus.Globals). */
  statics?: string;
  /** What `new` returns, as an object in `objects` (Nucleus.IniFile). */
  instance?: string;
}
export const constructorsOf = (c: NucleusClass): string[][] => c.constructors ?? [c.params];

export interface GlobalInfo {
  type: string;
  doc: string;
  topLevel: boolean;
  /** Known (no lint warnings) but not offered in completion, e.g. Hub: written by the Hub on upload. */
  hidden?: boolean;
}
export interface EnumInfo {
  doc?: string;
  values: Record<string, number>;
}
export interface ApiModel {
  source: { nucleus: string | null; www: string | null };
  jint: string | null;
  globals: Record<string, GlobalInfo>;
  objects: Record<string, ApiObject>;
  enums: Record<string, EnumInfo>;
  nucleusClasses: Record<string, NucleusClass>;
}

export const api = raw as unknown as ApiModel;
// .NET `System.*`, written by hand (core/dotnet.ts): the generator only reads the Nucleus sources.
Object.assign(api.objects, DOTNET_OBJECTS);
if (api.globals.System) api.globals.System = { ...api.globals.System, type: 'System', doc: DOTNET_OBJECTS.System.doc };

export const DOCS_URL = 'https://www.splitscreen.me/docs/handler-api';

/** What a resolved expression refers to. */
export type Resolved =
  | { kind: 'object'; type: string } // an ApiObject (Game, Context, GameHook, ...)
  | { kind: 'list'; of: string } // PlayerList
  | { kind: 'nucleus' } // the Nucleus namespace
  | { kind: 'enum'; name: string } // Nucleus.Folder
  | { kind: 'enumValue'; enumName: string; value: string }
  | { kind: 'nucleusClass'; name: string }
  | { kind: 'member'; owner: string; name: string; member: Member }
  | { kind: 'opaque' }; // something we don't model (System.*, Handler, Record values, ...)

/** Type name of an API object, from a TS type string like "GameHook" or "PlayerInfo[]". */
export function objectTypeOf(ts: string | undefined): string | undefined {
  if (!ts) return undefined;
  return api.objects[ts] ? ts : undefined;
}

export function resolveGlobal(name: string): Resolved | undefined {
  const g = api.globals[name];
  if (!g) return undefined;
  if (name === 'Nucleus') return { kind: 'nucleus' };
  if (name === 'PlayerList') return { kind: 'list', of: 'PlayerInfo' };
  if (api.objects[g.type]) return { kind: 'object', type: g.type };
  return { kind: 'opaque' };
}

export interface StepResult {
  resolved?: Resolved;
  /** Set when `name` is not a member of a modelled object. */
  unknown?: { owner: string; ownerLabel: string; candidates: string[] };
}

/**
 * Jint 2.x (ObjectWrapper.EqualsIgnoreCasing) matches .NET member names with only the
 * FIRST character case-insensitive: `Context.width` finds `Width`, but
 * `Game.IgnoreWindowBordercheck` does not find `IgnoreWindowBorderCheck`.
 */
export function jintMemberName(members: Record<string, unknown>, name: string): string | undefined {
  if (name in members) return name;
  if (!name) return undefined;
  const alt = (name[0] === name[0].toUpperCase() ? name[0].toLowerCase() : name[0].toUpperCase()) + name.slice(1);
  return alt in members ? alt : undefined;
}

/** Resolve `.name` on top of `base`. */
export function resolveMember(base: Resolved, name: string): StepResult {
  switch (base.kind) {
    case 'object': {
      const obj = api.objects[base.type];
      const key = jintMemberName(obj.members, name);
      if (!key && obj.open && !looksLikeTypo(name, Object.keys(obj.members))) return { resolved: { kind: 'opaque' } };
      if (!key) return { unknown: { owner: base.type, ownerLabel: base.type, candidates: Object.keys(obj.members) } };
      return { resolved: { kind: 'member', owner: base.type, name: key, member: obj.members[key] } };
    }
    case 'member': {
      const ref = base.member.ref;
      if (base.member.kind === 'object' && ref && api.objects[ref]) return resolveMember({ kind: 'object', type: ref }, name);
      return { resolved: { kind: 'opaque' } };
    }
    case 'list':
      if (name === 'Count') return { resolved: { kind: 'opaque' } };
      return { resolved: { kind: 'opaque' } };
    case 'nucleus': {
      if (api.enums[name]) return { resolved: { kind: 'enum', name } };
      if (api.nucleusClasses[name]) return { resolved: { kind: 'nucleusClass', name } };
      // Sub-namespaces (e.g. Nucleus.Coop) and other types are reachable but not modelled.
      if (/^[A-Z]/.test(name) && !looksLikeTypo(name, [...Object.keys(api.enums), ...Object.keys(api.nucleusClasses)])) {
        return { resolved: { kind: 'opaque' } };
      }
      return { unknown: { owner: 'Nucleus', ownerLabel: 'Nucleus', candidates: [...Object.keys(api.enums), ...Object.keys(api.nucleusClasses)] } };
    }
    case 'enum': {
      const e = api.enums[base.name];
      if (!(name in e.values)) return { unknown: { owner: `Nucleus.${base.name}`, ownerLabel: `Nucleus.${base.name}`, candidates: Object.keys(e.values) } };
      return { resolved: { kind: 'enumValue', enumName: base.name, value: name } };
    }
    case 'nucleusClass': {
      const statics = api.nucleusClasses[base.name].statics;
      if (statics) {
        const r = resolveMember({ kind: 'object', type: statics }, name);
        return r.unknown ? { unknown: { ...r.unknown, ownerLabel: `Nucleus.${base.name}` } } : r;
      }
      return { resolved: { kind: 'opaque' } };
    }
    default:
      return { resolved: { kind: 'opaque' } };
  }
}

/** Element type when indexing (`PlayerList[i]`). */
export function resolveIndex(base: Resolved): Resolved {
  if (base.kind === 'list') return { kind: 'object', type: base.of };
  return { kind: 'opaque' };
}

/** Members to offer for completion after `base.`. */
export function membersOf(base: Resolved): { name: string; member?: Member; enumValue?: number; detail?: string }[] {
  switch (base.kind) {
    case 'object':
      return Object.entries(api.objects[base.type].members)
        .filter(([, m]) => !m.internal)
        .map(([name, member]) => ({ name, member }));
    case 'member':
      if (base.member.kind === 'object' && base.member.ref && api.objects[base.member.ref]) {
        return membersOf({ kind: 'object', type: base.member.ref });
      }
      return [];
    case 'list':
      return [{ name: 'Count', detail: 'number' }];
    case 'nucleus':
      return [
        ...Object.keys(api.enums).map((name) => ({ name, detail: 'enum' })),
        ...Object.keys(api.nucleusClasses).map((name) => ({ name, detail: 'class' })),
      ];
    case 'enum':
      return Object.entries(api.enums[base.name].values).map(([name, v]) => ({ name, enumValue: v, detail: `= ${v}` }));
    case 'nucleusClass': {
      const statics = api.nucleusClasses[base.name].statics;
      return statics ? membersOf({ kind: 'object', type: statics }) : [];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Best "did you mean" candidate, or undefined if nothing is close. */
export function suggest(name: string, candidates: string[]): string | undefined {
  const lower = name.toLowerCase();
  const exactCi = candidates.find((c) => c.toLowerCase() === lower);
  if (exactCi) return exactCi;
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  const limit = Math.max(2, Math.floor(name.length / 4));
  return bestScore <= limit ? best : undefined;
}

export function looksLikeTypo(name: string, candidates: string[]): boolean {
  return suggest(name, candidates) !== undefined;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function memberSignature(owner: string, name: string, m: Member): string[] {
  const label = ownerLabel(owner);
  if (m.kind === 'method') {
    return (m.overloads ?? []).map(
      (o) => `${label}.${name}(${o.params.map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')}): ${o.returns}`,
    );
  }
  const t = m.kind === 'object' ? m.ref ?? m.ts : m.ts;
  return [`${m.readonly ? '(read-only) ' : ''}${label}.${name}: ${t}`];
}

/** "GameHook" -> "Game.Hook" etc., for messages. */
export function ownerLabel(owner: string): string {
  switch (owner) {
    case 'GameHook':
      return 'Game.Hook';
    case 'GameProtoInput':
      return 'Game.ProtoInput';
    case 'PlayerInfo':
      return 'Player';
    case 'ProtoInputRuntime':
      return 'ProtoInput';
    case 'ProtoInputValues':
      return 'ProtoInput.Values';
    case 'HubMaintainer':
      return 'Hub.Maintainer';
    case 'HubHandler':
      return 'Hub.Handler';
    case 'NucleusGlobals':
      return 'Nucleus.Globals';
    default:
      return owner;
  }
}

/** The label shown with a doc Claude wrote (empty for human-written docs). */
export const claudeNote = (m: { docBy?: string; docBasis?: string; docCheckedBy?: string; docCheckedOn?: string }) =>
  m.docBy !== 'claude' ? ''
  : m.docCheckedBy ? `AI-written, based on ${m.docBasis}. Checked by ${m.docCheckedBy}${m.docCheckedOn ? ` on ${m.docCheckedOn}` : ''}.`
  : `AI-written, based on ${m.docBasis}. Not from the official docs.`;

/** The "Doc review" issue form for a Claude-written doc, with its name filled in (.github/ISSUE_TEMPLATE/doc-review.yml;
 *  the doc-review workflow adds the doc itself as a comment the reporter can't remove). */
export const docReviewUrl = (path: string) =>
  `https://github.com/Snailedlt/splitscreenme-vscode/issues/new?template=doc-review.yml&title=${encodeURIComponent(`Doc review: ${path}`)}&member=${encodeURIComponent(path)}`;

export function memberMarkdown(owner: string, name: string, m: Member): string {
  const parts: string[] = [];
  parts.push('```ts\n' + memberSignature(owner, name, m).join('\n') + '\n```');
  if (m.deprecated) parts.push(`**${m.deprecated}**`);
  if (m.doc) parts.push(m.doc);
  if (claudeNote(m)) parts.push(`_✎ ${claudeNote(m)}_${m.docCheckedBy ? '' : ` [Is it wrong? Tell us](${docReviewUrl(`${ownerLabel(owner)}.${name}`)})`}`);
  const meta: string[] = [];
  if (m.default !== undefined) meta.push(`Default: \`${m.default}\``);
  if (m.category) meta.push(`Category: ${m.category}`);
  if (m.required) meta.push('**Required**');
  if (meta.length) parts.push(meta.join(' · '));
  if (m.example) parts.push('```js\n' + m.example + '\n```');
  parts.push(`[Handler API docs](${DOCS_URL})`);
  return parts.join('\n\n');
}
