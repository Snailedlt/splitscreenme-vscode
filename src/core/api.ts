// Typed access to the generated Nucleus handler API model (data/nucleus-api.json).
import raw from '../../data/nucleus-api.json';
import { JS_FUNCTIONS, JS_GLOBAL_OBJECTS, JS_OBJECTS, isJsBuiltin, mdnUrl } from './jsbuiltins';
import { DOTNET_OBJECTS } from './dotnet';
import { prettyCode, prettySignature } from './pretty';

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
  /** What to pass, in plain words (JavaScript's from TypeScript's docs; Nucleus' from data/claude-docs.json). */
  doc?: string;
  /** The doc was written by Claude (AI) from the source. */
  docBy?: 'claude';
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
  /** One of the handler's own functions (its return type worked out from its code), not a Nucleus member. */
  own?: boolean;
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

/** The model as objects without a prototype: a name typed in a handler (`toString`, `constructor`, `__proto__`) is
 *  never mistaken for a member, an enum or a docs page. */
function bare(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(bare);
  if (!v || typeof v !== 'object') return v;
  const o = Object.create(null);
  for (const [k, x] of Object.entries(v)) o[k] = bare(x);
  return o;
}
export const api = bare(raw) as ApiModel;
// .NET `System.*`, written by hand (core/dotnet.ts): the generator only reads the Nucleus sources.
Object.assign(api.objects, DOTNET_OBJECTS);
if (api.globals.System) api.globals.System = { ...api.globals.System, type: 'System', doc: DOTNET_OBJECTS.System.doc };

export const DOCS_URL = 'https://www.splitscreen.me/docs/handler-api';

/** What a resolved expression refers to. */
export type Resolved =
  | { kind: 'object'; type: string; of?: string } // an ApiObject (Game, Context, GameHook, ...); `of`: an Array's element type
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

/** An API object by name; also JavaScript's own (String, Array, Math, JSON, Number: core/jsbuiltins.ts). */
export function objectOf(type: string): ApiObject | undefined {
  return api.objects[type] ?? JS_OBJECTS[type];
}
/** The object a value of TypeScript type `ts` is (`string` -> String, `number` -> Number, `string[]` -> an Array of
 *  strings, an API object by name), for the members of an expression's result. */
export function valueTypeOf(ts: string | undefined): Resolved | undefined {
  if (!ts) return undefined;
  const t = ts.replace(/\s*\|\s*(null|undefined)\b/g, '').trim();
  if (t === 'string') return { kind: 'object', type: 'String' };
  if (t === 'number') return { kind: 'object', type: 'Number' };
  const arr = /^(.+)\[\]$/.exec(t) ?? /^Array<(.+)>$/.exec(t);
  if (arr) return { kind: 'object', type: 'Array', of: arr[1] };
  if (/^RegExp(Match|Exec)Array$/.test(t)) return { kind: 'object', type: 'Array', of: 'string' };
  if (api.objects[t]) return { kind: 'object', type: t };
  return undefined;
}
/** What a field or property's value is, when it's a string, number or list (for `.` after it). */
function valueObject(m: Member): Resolved | undefined {
  if (m.kind === 'method' || m.kind === 'object') return undefined;
  const v = valueTypeOf(m.ts ?? m.type);
  return v && v.kind === 'object' && (v.type === 'String' || v.type === 'Number' || v.type === 'Array') ? v : undefined;
}
/** What calling `base` gives back: its return type (the first overload's). */
export function resolveCall(base: Resolved): Resolved | undefined {
  if (base.kind !== 'member' || base.member.kind !== 'method') return undefined;
  return valueTypeOf(base.member.overloads?.[0]?.returns);
}

/** A field or property that holds a string: its value has JavaScript's string methods. */
export const isStringMember = (m: Member) => m.kind !== 'method' && m.kind !== 'object' && (m.type === 'string' || m.ts === 'string');

export function resolveGlobal(name: string): Resolved | undefined {
  // JavaScript's Math and JSON, and its global functions (parseInt…): for hover, completion and parameter hints.
  if (JS_GLOBAL_OBJECTS.includes(name) && !api.globals[name]) return { kind: 'object', type: name };
  if (JS_FUNCTIONS[name] && !api.globals[name]) return { kind: 'member', owner: '', name, member: JS_FUNCTIONS[name] };
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
      const obj = objectOf(base.type)!;
      const key = jintMemberName(obj.members, name);
      if (!key && obj.open && !looksLikeTypo(name, Object.keys(obj.members))) return { resolved: { kind: 'opaque' } };
      if (!key) return { unknown: { owner: base.type, ownerLabel: base.type, candidates: Object.keys(obj.members) } };
      return { resolved: { kind: 'member', owner: base.type, name: key, member: obj.members[key] } };
    }
    case 'member': {
      const ref = base.member.ref;
      if (base.member.kind === 'object' && ref && api.objects[ref]) return resolveMember({ kind: 'object', type: ref }, name);
      if (isStringMember(base.member)) return resolveMember({ kind: 'object', type: 'String' }, name);
      const v = valueObject(base.member);
      if (v) return resolveMember(v, name);
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
  if (base.kind === 'object' && base.type === 'Array' && base.of) return valueTypeOf(base.of) ?? { kind: 'opaque' };
  if (base.kind === 'object' && base.type === 'String') return { kind: 'object', type: 'String' };
  if (base.kind === 'member') {
    const v = valueObject(base.member);
    if (v) return resolveIndex(v);
  }
  return { kind: 'opaque' };
}

/** Members to offer for completion after `base.`. */
export function membersOf(base: Resolved): { name: string; member?: Member; enumValue?: number; detail?: string }[] {
  switch (base.kind) {
    case 'object':
      return Object.entries(objectOf(base.type)!.members)
        .filter(([, m]) => !m.internal)
        .map(([name, member]) => ({ name, member }));
    case 'member':
      if (base.member.kind === 'object' && base.member.ref && api.objects[base.member.ref]) {
        return membersOf({ kind: 'object', type: base.member.ref });
      }
      if (isStringMember(base.member)) return membersOf({ kind: 'object', type: 'String' });
      {
        const v = valueObject(base.member);
        if (v) return membersOf(v);
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
  const full = label ? `${label}.${name}` : name;
  if (m.kind === 'method') {
    return (m.overloads ?? []).map(
      (o) => `${full}(${o.params.map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')}): ${o.returns}`,
    );
  }
  const t = m.kind === 'object' ? m.ref ?? m.ts : m.ts;
  return [`${m.readonly ? '(read-only) ' : ''}${full}: ${t}`];
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
  // Each overload laid out as prettier would (one parameter per line when it's long), the example too.
  parts.push('```ts\n' + memberSignature(owner, name, m).map((x) => prettySignature(x)).join('\n') + '\n```');
  if (m.deprecated) parts.push(`**${m.deprecated}**`);
  if (m.doc) parts.push(m.doc);
  if (claudeNote(m)) parts.push(`_✎ ${claudeNote(m)}_${m.docCheckedBy ? '' : ` [Is it wrong? Tell us](${docReviewUrl(`${ownerLabel(owner)}.${name}`)})`}`);
  // What to pass for each parameter (every name once, from whichever overload has it).
  const params = new Map<string, Param>();
  for (const o of m.overloads ?? []) for (const p of o.params) if (p.doc && !params.has(p.name)) params.set(p.name, p);
  if (params.size) parts.push([...params.values()].map((p) => `- \`${p.name}\`: ${p.doc}`).join('\n') + ([...params.values()].some((p) => p.docBy === 'claude') ? '\n\n_✎ Parameters: AI-written from the Nucleus source._' : ''));
  const meta: string[] = [];
  if (m.default !== undefined) meta.push(`Default: \`${m.default}\``);
  if (m.category) meta.push(`Category: ${m.category}`);
  if (m.required) meta.push('**Required**');
  if (meta.length) parts.push(meta.join(' · '));
  if (m.example) parts.push('```js\n' + prettyCode(m.example) + '\n```');
  parts.push(isJsBuiltin(owner) ? `[MDN: ${owner ? `${owner}.` : ''}${name}](${mdnUrl(owner, name)})` : `[Handler API docs](${DOCS_URL})`);
  return parts.join('\n\n');
}
