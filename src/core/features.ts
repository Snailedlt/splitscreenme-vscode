// Editor features for Nucleus handlers, as plain data: hover, completion, signature help, code
// actions, formatting and inlay hints. Every editor adapter (src/extension.ts for VS Code,
// src/lsp.ts for the Language Server) only converts these to its own types, so a new editor gets the
// same behaviour. Positions are UTF-16 offsets into the text (what JavaScript strings index), which
// is also what LSP counts by default. No `vscode` import here, no Node APIs either.
import { blockedItemAt, blockedListAt, blockedLists, blockTarget, COMMON_MESSAGES, hex, messageMarkdown } from './wm';
import { api, claudeNote, DOCS_URL, isStringMember, Member, memberMarkdown, memberSignature, membersOf, ownerLabel, Resolved } from './api';
import { callContextAt, memberContextAt, resolveAt, valueContextAt } from './complete';
import { Diagnostic, lineOf, lineStart, looksLikeHandler, RuleId, RULES, Severity, TextEdit } from './lint';
import { fixAll } from './fix';
import { formatHandler } from './format';
import { parseLikeJint } from './jsparse';
import { addedOptions, codeStateAt, KEYWORDS, optionMarkdown, ownNameAt, ownReturnTypes, parseTolerant, visibleNames } from './ownsymbols';
import { innerCallFrame } from './complete';
import { SNIPPETS } from './snippets';
import { JS_FUNCTIONS, JS_GLOBAL_OBJECTS } from './jsbuiltins';

/** Editors with their own JavaScript support (VS Code) already suggest and explain the handler's own functions and
 *  variables: `own: false` leaves those out, so they don't show twice. */
export interface FeatureOptions {
  own?: boolean;
  /** Asked for (Ctrl+Space), not opened by a typed character: names are offered before any letter is typed. */
  explicit?: boolean;
}

/** `Context.Options["…` with the cursor in (or right after `[` before) the key. */
function optionKeyContextAt(text: string, offset: number): { quote: string; partial: string; start: number; end: number } | undefined {
  const before = text.slice(Math.max(0, offset - 200), offset);
  const m = /Context\s*\.\s*Options\s*\[\s*(["']?)([^"'\]\n]*)$/.exec(before);
  if (!m) return undefined;
  const rest = /^[^"'\]\n]*/.exec(text.slice(offset))![0];
  return { quote: m[1], partial: m[2], start: offset - m[2].length, end: offset + (m[1] ? rest.length : 0) };
}
/** `Context.Options["key"] == "…`: the key and the value typed so far. */
function optionValueContextAt(text: string, offset: number): { key: string; quote: string; partial: string } | undefined {
  const before = text.slice(Math.max(0, offset - 300), offset);
  const m = /Context\s*\.\s*Options\s*\[\s*["']([^"'\n]*)["']\s*\]\s*(?:===?|!==?)\s*(["'])([^"'\n]*)$/.exec(before);
  return m ? { key: m[1], quote: m[2], partial: m[3] } : undefined;
}
/** The key under the cursor in `Context.Options["key"]`. */
function optionKeyAt(text: string, offset: number): { key: string; start: number; end: number } | undefined {
  const c = optionKeyContextAt(text, offset);
  if (!c || !c.quote) return undefined;
  const key = text.slice(c.start, c.end);
  return { key, start: c.start, end: c.end };
}

/** Where the lint rules are documented (the README table). */
export const RULES_URL = 'https://github.com/SplitScreen-Me/splitscreenme-vscode#lint-rules';

export interface Span {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Hover

export interface HoverInfo {
  markdown: string;
  range: Span;
}

const notTopLevel = '\n\n_Only available inside callbacks such as `Game.Play`._';

/** The hover at `offset`: an API member's docs, an enum, a global, or a window message in BlockedMessages. */
export function hoverAt(text: string, offset: number, opts: FeatureOptions = {}): HoverInfo | undefined {
  // A number in Game.ProtoInput.BlockedMessages: the window message's name and what it does.
  const msg = blockedItemAt(text, offset);
  if (msg) return { markdown: messageMarkdown(msg.id), range: { start: msg.start, end: msg.end } };
  // The key in Context.Options["key"]: the option Game.AddOption added.
  const k = optionKeyAt(text, offset);
  if (k) {
    const o = addedOptions(text).find((x) => x.key === k.key);
    if (o) return { markdown: optionMarkdown(o, text), range: { start: k.start, end: k.end } };
  }
  const r = resolveAt(text, offset);
  if (!r) return opts.own === false ? undefined : ownHover(text, offset);
  const range = { start: r.start, end: r.end };
  const word = text.slice(r.start, r.end);
  const res = r.resolved;
  switch (res.kind) {
    case 'member': {
      if (res.member.own) break; // the handler's own function: below
      let md = memberMarkdown(res.owner, res.name, res.member);
      // Context.Options: the keys this handler adds.
      if (res.owner === 'Context' && res.name === 'Options') {
        const opts = addedOptions(text, offset);
        if (opts.length) md += '\n\n**This handler adds:**\n' + opts.map((o) => `- \`"${o.key}"\`${o.name ? `: ${o.name}` : ''}${o.values ? ` (${o.values.map((v) => `\`${v}\``).join(', ')})` : ''}`).join('\n');
      }
      return { markdown: md, range };
    }
    case 'enum': {
      const e = api.enums[res.name];
      return { markdown: '```ts\nenum Nucleus.' + res.name + '\n```\n\n' + (e.doc ?? '') + '\n\n' + Object.entries(e.values).map(([k, v]) => `- \`${k}\` = ${v}`).join('\n'), range };
    }
    case 'enumValue':
      return { markdown: '```ts\nNucleus.' + res.enumName + '.' + res.value + ' = ' + api.enums[res.enumName].values[res.value] + '\n```\n\n' + (api.enums[res.enumName].doc ?? ''), range };
    case 'nucleusClass': {
      const c = api.nucleusClasses[res.name];
      return { markdown: '```ts\nnew Nucleus.' + res.name + '(' + c.params.join(', ') + ')\n```\n\n' + c.doc, range };
    }
    case 'object':
    case 'list':
    case 'nucleus': {
      const g = api.globals[word];
      if (!g) break;
      return { markdown: '```ts\n' + `${word}: ${g.type}` + '\n```\n\n' + g.doc + (g.topLevel ? '' : notTopLevel) + `\n\n[Handler API docs](${DOCS_URL})`, range };
    }
  }
  return opts.own === false ? undefined : ownHover(text, offset);
}

/** The handler's own function or variable under the cursor: how it's declared and the comment above it. */
function ownHover(text: string, offset: number): HoverInfo | undefined {
  let s = offset;
  let e = offset;
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
  while (e < text.length && /[\w$]/.test(text[e])) e++;
  if (e === s || /\d/.test(text[s]) || codeStateAt(text, s) !== 'code') return undefined;
  let d = s;
  while (d > 0 && /[ \t]/.test(text[d - 1])) d--;
  if (text[d - 1] === '.') return undefined; // a property, not a variable
  const n = ownNameAt(text, offset, text.slice(s, e));
  if (!n) return undefined;
  const line = text.slice(0, n.start).split('\n').length;
  const returns = n.kind === 'function' ? ownReturnTypes(text).get(n.name) : undefined;
  const { text: doc, params } = splitJsDoc(n.doc);
  const ps = Object.entries(params).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n');
  return { markdown: '```js\n' + n.signature + (returns ? `: ${returns}` : '') + '\n```' + (doc ? '\n\n' + doc.replace(/^\s*@returns?\s+(\{[^}]*\}\s*)?/m, 'Returns ') : '') + (ps ? '\n\n' + ps : '') + `\n\n_Declared on line ${line}._`, range: { start: s, end: e } };
}

// ---------------------------------------------------------------------------
// Completion

export type CompletionKind = 'field' | 'property' | 'method' | 'function' | 'module' | 'variable' | 'class' | 'enum' | 'enumMember' | 'constant' | 'value' | 'snippet' | 'keyword';

export interface CompletionEntry {
  label: string;
  /** Shown next to the label, e.g. the number of a window message. */
  labelDetail?: string;
  kind: CompletionKind;
  detail?: string;
  /** Markdown. */
  documentation?: string;
  /** What to insert; the label when unset. */
  insertText?: string;
  /** insertText is a snippet (`$1`, `${1|a,b|}`, `$0`: the syntax VS Code and LSP share). */
  snippet?: boolean;
  /** The text the item replaces; the editor's word at the cursor when unset. */
  range?: Span;
  filterText?: string;
  sortText?: string;
  preselect?: boolean;
  deprecated?: boolean;
  /** Open signature help after inserting (methods). */
  signatureHelp?: boolean;
}

const KIND: Record<Member['kind'], CompletionKind> = { field: 'field', property: 'property', method: 'method', object: 'module' };

/** The value snippet for `Game.Foo = …;` by the option's type. */
export function valueSnippet(m: Member): string {
  const t = m.type ?? 'any';
  if (t === 'boolean') return '${1|true,false|}';
  if (t === 'number') return `\${1:${/^-?\d+(\.\d+)?$/.test(m.default ?? '') ? m.default : '0'}}`;
  if (t === 'string') return '"$1"';
  if (t.endsWith('[]')) return '["$1"]';
  if (t === 'function') return 'function () {\n\t$0\n}';
  if (t.startsWith('enum:')) {
    const e = t.slice(5);
    const values = api.enums[e] ? Object.keys(api.enums[e].values) : [];
    return values.length ? `Nucleus.${e}.\${1|${values.join(',')}|}` : '${1:true}';
  }
  return '$1';
}

const lineBounds = (text: string, offset: number) => {
  const s = lineStart(text, offset);
  const n = text.indexOf('\n', offset);
  let e = n < 0 ? text.length : n;
  if (e > s && text[e - 1] === '\r') e--;
  return { start: s, end: Math.max(e, offset) };
};

/** Completion items at `offset`, or undefined when there's nothing to offer (let the editor do its own). */
export function completionsAt(text: string, offset: number, opts: FeatureOptions = {}): CompletionEntry[] | undefined {
  // `Context.Options["|"]`: the keys the handler adds with Game.AddOption.
  const key = optionKeyContextAt(text, offset);
  if (key) {
    const options = addedOptions(text, offset);
    if (!options.length) return undefined;
    const closeAfter = /^["']?\s*\]/.test(text.slice(key.end));
    return options.map((o, i) => ({
      label: o.key,
      kind: 'property' as const,
      detail: o.name ?? 'Game.AddOption',
      documentation: optionMarkdown(o, text),
      insertText: key.quote ? o.key : `"${o.key}"${closeAfter ? '' : ']'}`,
      range: { start: key.start, end: key.end },
      sortText: String(i).padStart(3, '0'),
    }));
  }
  // `Context.Options["mode"] == "|"`: that option's choices.
  const cmp = optionValueContextAt(text, offset);
  if (cmp) {
    const o = addedOptions(text, offset).find((x) => x.key === cmp.key);
    if (!o?.values) return undefined;
    let end = offset;
    while (end < text.length && !/["'\n]/.test(text[end])) end++;
    return o.values.map((v, i) => ({ label: v, kind: 'value' as const, detail: o.name ?? o.key, range: { start: offset - cmp.partial.length, end }, sortText: String(i).padStart(3, '0'), preselect: v === o.default }));
  }
  // Inside `Game.ProtoInput.BlockedMessages = [ | ]`: the window messages handlers block, most used first.
  const list = blockedListAt(text, offset);
  if (list && !blockedItemAt(text, offset)) {
    const have = new Set(list.items.map((i) => i.id));
    const before = text.slice(list.open + 1, offset).trim();
    return COMMON_MESSAGES.filter((m) => !have.has(m.id)).map((m, i) => ({
      label: m.name,
      labelDetail: hex(m.id),
      kind: 'constant' as const,
      insertText: `${before && !before.endsWith(',') ? ', ' : ''}${hex(m.id)}`,
      filterText: `${m.name} ${hex(m.id)}`,
      detail: m.hub ? `Blocked by ${m.hub} of the 600 most-starred Hub handlers` : 'Window message',
      documentation: messageMarkdown(m.id),
      sortText: String(i).padStart(2, '0'),
    }));
  }
  // `Game.DPIHandling = |`: the option's values (enum values, true / false).
  const value = valueContextAt(text, offset);
  if (value && !value.partial.includes('.')) {
    const range = { start: value.partialStart, end: offset };
    const def = value.member.default?.replace(/^(\w+)\.(\w+)$/, 'Nucleus.$1.$2');
    return value.values.map(({ value: v, detail, snippet }, i) => {
      const item: CompletionEntry = {
        label: v.replace(/\n/g, ' ').replace(/\s+/g, ' '),
        kind: v.startsWith('Nucleus.') ? 'enumMember' : snippet ? 'snippet' : 'value',
        range,
        insertText: snippet ?? v,
        snippet: !!snippet,
        detail,
        sortText: String(i).padStart(3, '0'),
        documentation: memberMarkdown(value.owner, value.name, value.member),
      };
      // The option's default first (preselected), then the rest in declared order.
      if (def && (def === v || value.member.default === v)) {
        item.preselect = true;
        item.detail = [detail, 'default'].filter(Boolean).join(' · ');
      }
      return item;
    });
  }
  const ctx = memberContextAt(text, offset);
  if (!ctx) {
    const names = opts.own === false ? globalCompletions(text, offset) : identifierCompletions(text, offset, !!opts.explicit);
    const snips = snippetCompletions(text, offset, !!opts.explicit);
    return names || snips.length ? [...(names ?? []), ...snips] : undefined;
  }

  const line = lineBounds(text, offset);
  const before = text.slice(line.start, offset - ctx.partial.length);
  const rest = text.slice(offset, line.end);
  const wordAfter = rest.match(/^[\w$]*/)?.[0].length ?? 0;
  const after = rest.slice(wordAfter);
  // `Game.Foo|` on its own line: complete the whole assignment.
  const assignmentContext = /^\s*(Game|Game\.Hook|Game\.ProtoInput|Context|Context\.Hook)\.$/.test(before) && after.trim() === '';
  const range = { start: ctx.partialStart, end: offset + wordAfter };

  return membersOf(ctx.base).map(({ name, member, enumValue, detail }, i): CompletionEntry => {
    if (member) {
      const owner = ownerOf(ctx.base);
      // Required and documented options first, deprecated last.
      const rank = member.required ? 0 : member.deprecated ? 3 : member.doc ? 1 : 2;
      const item: CompletionEntry = {
        label: name,
        range,
        kind: KIND[member.kind],
        detail: memberSignature(owner, name, member)[0] + (member.overloads && member.overloads.length > 1 ? ` (+${member.overloads.length - 1} overloads)` : ''),
        documentation: memberMarkdown(owner, name, member),
        sortText: `${rank}_${name}`,
      };
      if (member.deprecated) item.deprecated = true;
      if (member.kind === 'method') {
        item.insertText = `${name}($1)`;
        item.snippet = true;
        item.signatureHelp = true;
      } else if (assignmentContext && member.kind !== 'object' && !member.readonly) {
        item.insertText = `${name} = ${valueSnippet(member)};`;
        item.snippet = true;
      }
      return item;
    }
    let kind: CompletionKind = enumValue !== undefined ? 'enumMember' : 'class';
    let documentation: string | undefined;
    if (ctx.base.kind === 'nucleus') {
      kind = detail === 'enum' ? 'enum' : 'class';
      const info = api.enums[name] ?? api.nucleusClasses[name];
      if (info?.doc) documentation = info.doc;
    }
    return { label: name, range, kind, detail, documentation, sortText: String(i).padStart(4, '0') };
  });
}

function globalCompletions(text: string, offset: number): CompletionEntry[] | undefined {
  let s = offset;
  let e = offset;
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
  while (e < text.length && /[\w$]/.test(text[e])) e++;
  const word = text.slice(s, e);
  if (!word || !/^[A-Z]/.test(word)) return undefined;
  // only at the start of an expression
  if (s > 0 && text[s - 1] === '.') return undefined;
  return Object.entries(api.globals)
    .filter(([, g]) => !g.hidden)
    .map(([name, g]) => ({ label: name, kind: 'variable' as const, detail: `${name}: ${g.type}`, documentation: g.doc + (g.topLevel ? '' : notTopLevel), sortText: `0_${name}` }));
}

/** Where a name starts (not after a dot): the handler's own functions and variables in scope, Nucleus' globals,
 *  JavaScript's own (Math, parseInt…) and the keywords. For editors without their own JavaScript suggestions. */
function identifierCompletions(text: string, offset: number, explicit: boolean): CompletionEntry[] | undefined {
  let s = offset;
  let e = offset;
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
  while (e < text.length && /[\w$]/.test(text[e])) e++;
  if (/\d/.test(text[s] ?? '')) return undefined;
  let d = s;
  while (d > 0 && /[ \t]/.test(text[d - 1])) d--;
  if (text[d - 1] === '.') return undefined;
  const lineBefore = text.slice(text.lastIndexOf('\n', s - 1) + 1, s);
  if (/\b(var|let|const|function|catch\s*\()\s*$|\bfunction\s*[\w$]*\s*\([^)]*$/.test(lineBefore)) return undefined; // naming something new
  if (codeStateAt(text, s) !== 'code') return undefined;
  const range = { start: s, end: e };
  const word = text.slice(s, offset);
  if (!word && !explicit) return undefined;
  const out: CompletionEntry[] = [];
  const seen = new Set<string>();
  for (const n of visibleNames(text, offset)) {
    if (n.name === word && n.start === s) continue; // the name being declared right here
    seen.add(n.name);
    out.push({ label: n.name, kind: n.kind === 'function' ? 'function' : 'variable', detail: n.signature, documentation: n.doc, range, sortText: `0_${n.name}`, ...(n.kind === 'function' ? { insertText: `${n.name}($1)`, snippet: true, signatureHelp: true } : {}) });
  }
  for (const [name, g] of Object.entries(api.globals)) {
    if (g.hidden || seen.has(name)) continue;
    seen.add(name);
    out.push({ label: name, kind: 'variable', detail: `${name}: ${g.type}`, documentation: g.doc + (g.topLevel ? '' : notTopLevel), range, sortText: `1_${name}` });
  }
  for (const name of JS_GLOBAL_OBJECTS) if (!seen.has(name)) (seen.add(name), out.push({ label: name, kind: 'module', detail: `JavaScript's ${name}`, range, sortText: `2_${name}` }));
  for (const [name, m] of Object.entries(JS_FUNCTIONS)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ label: name, kind: 'function', detail: memberSignature('', name, m)[0], documentation: m.doc, range, sortText: `2_${name}`, insertText: `${name}($1)`, snippet: true, signatureHelp: true });
  }
  for (const k of KEYWORDS) if (!seen.has(k)) out.push({ label: k, kind: 'keyword', range, sortText: `3_${k}` });
  return out;
}

/** Handler snippets (core/snippets.ts), where a statement starts and part of a name is typed (or on request). */
function snippetCompletions(text: string, offset: number, explicit: boolean): CompletionEntry[] {
  let s = offset;
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
  const word = text.slice(s, offset).toLowerCase();
  if ((!word && !explicit) || !/^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', s - 1) + 1, s)) || codeStateAt(text, s) !== 'code') return [];
  const program = parseTolerant(text, offset);
  let inFunction = false;
  if (program) {
    const walk = (n: any) => {
      if ((n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') && n.body.start < offset && offset < n.body.end) inFunction = true;
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && c.start <= offset && offset <= c.end && walk(c));
        else if (v && typeof v.type === 'string' && v.start <= offset && offset <= v.end) walk(v);
      }
    };
    walk(program);
  }
  let e = offset;
  while (e < text.length && /[\w$]/.test(text[e])) e++;
  return SNIPPETS.filter((x) => (x.where === 'callback') === inFunction && (!word || x.prefix.startsWith(word) || x.label.toLowerCase().includes(word))).map((x) => ({
    label: x.prefix,
    labelDetail: x.label,
    kind: 'snippet' as const,
    detail: x.label,
    documentation: x.doc + '\n\n```js\n' + x.body.replace(/\$\{\d+\|([^,|]*)[^}]*\}/g, '$1').replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d/g, '').replace(/\\([\\$}])/g, '$1') + '\n```',
    insertText: x.body,
    snippet: true,
    filterText: `${x.prefix} ${x.label}`,
    range: { start: s, end: e },
    sortText: `4_${x.prefix}`,
  }));
}

function ownerOf(base: Resolved): string {
  if (base.kind === 'object') return base.type;
  if (base.kind === 'member' && base.member.ref) return base.member.ref;
  if (base.kind === 'member' && isStringMember(base.member)) return 'String';
  return '';
}

// ---------------------------------------------------------------------------
// Signature help

export interface SignatureEntry {
  label: string;
  /** Markdown. */
  documentation?: string;
  /** Each parameter's label, a substring of `label`. */
  parameters: string[];
  /** Each parameter's docs (Markdown), where there are any. */
  parameterDocs?: (string | undefined)[];
}
export interface SignatureHelpInfo {
  signatures: SignatureEntry[];
  activeSignature: number;
  activeParameter: number;
}

/** The overloads of the method (or Nucleus class constructor) whose call the cursor is in. */
export function signatureHelpAt(text: string, offset: number, opts: FeatureOptions = {}): SignatureHelpInfo | undefined {
  const c = callContextAt(text, offset);
  if (!c || (c.callee.kind === 'member' && c.callee.member.own)) return opts.own === false ? undefined : ownSignatureHelp(text, offset);
  const signatures: SignatureEntry[] = [];
  let activeSignature = 0;
  if (c.callee.kind === 'member' && c.callee.member.kind === 'method') {
    const { owner, name, member } = c.callee;
    for (const o of member.overloads ?? []) {
      const params = o.params.map((p) => `${p.rest ? '...' : ''}${p.name}: ${p.type}`);
      const docs = o.params.map((p) => (p.doc ? p.doc + (p.docBy === 'claude' ? ' (AI-written)' : '') : undefined));
      signatures.push({ label: `${ownerLabel(owner) ? `${ownerLabel(owner)}.` : ''}${name}(${params.join(', ')}): ${o.returns}`, documentation: member.doc + (claudeNote(member) ? `\n\n_✎ ${claudeNote(member)}_` : ''), parameters: params, ...(docs.some(Boolean) ? { parameterDocs: docs } : {}) });
    }
    // Prefer the first overload that has enough parameters for the cursor position.
    const idx = (member.overloads ?? []).findIndex((o) => o.params.length > c.activeParameter || o.params.some((p) => p.rest));
    activeSignature = Math.max(0, idx);
  } else if (c.callee.kind === 'nucleusClass') {
    const cls = api.nucleusClasses[c.callee.name];
    const params = cls.params.map((p) => `${p}: string`);
    signatures.push({ label: `new Nucleus.${c.callee.name}(${params.join(', ')})`, documentation: cls.doc, parameters: params });
  } else return undefined;
  return { signatures, activeSignature, activeParameter: c.activeParameter };
}

/** A call of the handler's own function: its parameters and the comment above it. */
function ownSignatureHelp(text: string, offset: number): SignatureHelpInfo | undefined {
  const frame = innerCallFrame(text, offset);
  if (!frame) return undefined;
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, frame.pos - 100), frame.pos));
  if (!m) return undefined;
  const at = frame.pos - m[0].length;
  let d = at;
  while (d > 0 && /\s/.test(text[d - 1])) d--;
  if (text[d - 1] === '.' || /\bfunction\s*$/.test(text.slice(Math.max(0, d - 20), d))) return undefined;
  const n = ownNameAt(text, offset, m[1]);
  if (!n || n.kind !== 'function' || !n.params) return undefined;
  const { text: doc, params } = splitJsDoc(n.doc);
  const docs = n.params.map((p) => params[p]);
  return { signatures: [{ label: `${n.name}(${n.params.join(', ')})`, documentation: doc, parameters: n.params, ...(docs.some(Boolean) ? { parameterDocs: docs } : {}) }], activeSignature: 0, activeParameter: frame.commas };
}

/** `@param name what it is` lines (also `@param {type} name - …`) out of a comment, and the rest. */
export function splitJsDoc(doc: string | undefined): { text?: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  if (!doc) return { text: doc, params };
  const rest = doc
    .split('\n')
    .filter((l) => {
      const m = /^\s*@param\s+(?:\{[^}]*\}\s*)?\[?([\w$]+)[^\s\]]*\]?\s*(?:-\s*)?(.*)$/.exec(l);
      if (m) params[m[1]] = m[2].trim();
      return !m;
    })
    .join('\n')
    .trim();
  return { text: rest || undefined, params };
}

// ---------------------------------------------------------------------------
// Code actions

export type RuleOverrides = Partial<Record<RuleId, Severity | 'off'>>;

export interface CodeActionEntry {
  title: string;
  kind: 'quickfix' | 'source.fixAll';
  edits: TextEdit[];
  preferred?: boolean;
  /** The diagnostic it fixes (one of the ones passed in). */
  diagnostic?: Diagnostic;
}

/** "Fix all": every safe automatic fix (core/fix.ts), as one edit replacing the whole text. */
export function fixAllAction(text: string, rules?: RuleOverrides): { edit: TextEdit; count: number } | undefined {
  const r = fixAll(text, { rules });
  if (r.code === text) return undefined;
  return { edit: { start: 0, end: text.length, text: r.code }, count: r.applied.length };
}

/** The source.fixAll action (also what fix-on-save runs), or none when nothing is auto-fixable. */
export function fixAllCodeAction(text: string, rules?: RuleOverrides): CodeActionEntry | undefined {
  const fix = fixAllAction(text, rules);
  if (!fix) return undefined;
  return { title: `Fix ${fix.count} auto-fixable Nucleus problem${fix.count === 1 ? '' : 's'}`, kind: 'source.fixAll', edits: [fix.edit] };
}

/** Quick fixes for these diagnostics: each diagnostic's fixes, "Fix all" (once, when more than one
 *  problem is auto-fixable) and "Disable <rule> for this line". */
export function quickFixes(text: string, diagnostics: Diagnostic[], rules?: RuleOverrides): CodeActionEntry[] {
  const actions: CodeActionEntry[] = [];
  for (const diag of diagnostics) {
    for (const fix of diag.fixes ?? []) actions.push({ title: fix.title, kind: 'quickfix', edits: fix.edits, preferred: fix.preferred, diagnostic: diag });
    if (!actions.some((a) => a.kind === 'source.fixAll') && diag.fixes?.some((f) => f.preferred)) {
      const fix = fixAllAction(text, rules);
      if (fix && fix.count > 1) actions.push({ title: `Fix all ${fix.count} auto-fixable problems`, kind: 'source.fixAll', edits: [fix.edit], diagnostic: diag });
    }
    if (diag.rule in RULES && diag.rule !== 'syntax-error') {
      const start = lineStart(text, diag.start);
      const indent = text.slice(start).match(/^[ \t]*/)![0];
      actions.push({ title: `Disable ${diag.rule} for this line`, kind: 'quickfix', edits: [{ start, end: start, text: `${indent}// nucleus-lint-disable-next-line ${diag.rule}\n` }], diagnostic: diag });
    }
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Formatting

/** Format Document (core/format.ts: indentation and spacing only). `edits` is empty when already
 *  formatted; `error` says why it refused (the editor should show it, not change anything). */
/** The editor's indentation, and the style settings (core/format.ts: quotes, semicolons). */
export interface FormatSettings {
  insertSpaces: boolean;
  tabSize: number;
  quotes?: 'double' | 'single' | 'keep';
  semicolons?: 'add' | 'keep';
}
const formatOptions = (o: FormatSettings) => ({ indent: o.insertSpaces ? ' '.repeat(o.tabSize) : '\t', quotes: o.quotes, semicolons: o.semicolons });

export function formatEdits(text: string, opts: FormatSettings): { edits: TextEdit[] } | { error: string } {
  const r = formatHandler(text, formatOptions(opts));
  if (!r.ok) return { error: r.reason };
  return { edits: r.changed ? [{ start: 0, end: text.length, text: r.code }] : [] };
}

/** Format only the lines from `start` to `end` (offsets): a selection, or the line just typed. Blank lines are kept
 *  so the rest of the file doesn't move. */
export function rangeFormatEdits(text: string, start: number, end: number, opts: FormatSettings): { edits: TextEdit[] } | { error: string } {
  const r = formatHandler(text, { ...formatOptions(opts), keepBlankLines: true });
  if (!r.ok) return { error: r.reason };
  const crlf = r.code.includes('\r\n');
  const was = text.split('\n');
  const now = r.code.split('\n');
  if (now.length < was.length) return { edits: [] }; // can't line the two up: leave it
  const l0 = text.slice(0, start).split('\n').length - 1;
  const l1 = text.slice(0, Math.max(start, end)).split('\n').length - 1;
  const edits: TextEdit[] = [];
  let at = 0;
  for (let i = 0; i < was.length; i++) {
    const lineEnd = at + was[i].length;
    if (i >= l0 && i <= l1) {
      const strip = (s: string) => (crlf ? s.replace(/\r$/, '') : s);
      const a = strip(was[i]);
      const b = strip(now[i]);
      if (a !== b) edits.push({ start: at, end: at + a.length, text: b });
    }
    at = lineEnd + 1;
  }
  return { edits };
}

// ---------------------------------------------------------------------------
// Inlay hints

export interface InlayHintEntry {
  /** After this offset. */
  offset: number;
  label: string;
  /** Markdown. */
  tooltip: string;
}

/** The name after each number in Game.ProtoInput.BlockedMessages: `0x0008` WM_KILLFOCUS. */
export function inlayHints(text: string): InlayHintEntry[] {
  return blockedLists(text).flatMap((l) =>
    l.items.map((it) => {
      const t = blockTarget(it.id);
      return { offset: it.end, label: t.kind === 'ok' ? t.name : t.kind === 'out' ? 'unknown' : `→ ${t.name}?`, tooltip: messageMarkdown(it.id) };
    }),
  );
}

// ---------------------------------------------------------------------------
// Handler detection

/** Is this file a Nucleus handler? `mode`: 'auto' (a .js in a `handlers` folder, or text that looks
 *  like one: core/lint looksLikeHandler), 'always' or 'off'. `globs`: extra paths that always count. */
export function isHandlerFile(path: string | undefined, text: string, mode: 'auto' | 'always' | 'off' = 'auto', globs: string[] = []): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  if (path && globs.some((g) => globToRegExp(g).test(path.replace(/\\/g, '/')))) return true;
  if (path && !/\.js$/i.test(path)) return false;
  if (path && /[\\/]handlers[\\/][^\\/]+\.js$/i.test(path)) return true;
  return looksLikeHandler(text);
}

/** A small glob: `**` any folders, `*` any characters but `/`, `?` one. Matches the end of the path,
 *  so `handlers/*.js` matches `/home/me/Nucleus/handlers/Game.js`. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  const g = glob.replace(/\\/g, '/');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      re += '.*';
      i++;
      if (g[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`(^|/)${re}$`, 'i');
}

/** 0-based line of an offset (re-exported for adapters). */
export { lineOf };

// ---------------------------------------------------------------------------
// Outline (document symbols): a map of the handler for VS Code's Outline, breadcrumbs and Go to Symbol, and
// `textDocument/documentSymbol` in `nucleus lsp` (splitscreenme-vscode#15).

export type SymbolKind = 'namespace' | 'property' | 'function' | 'variable';
export interface SymbolEntry {
  name: string;
  detail?: string;
  kind: SymbolKind;
  /** The whole statement, and the part to select (the name). */
  range: Span;
  selection: Span;
  children?: SymbolEntry[];
}

const shortValue = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 40 ? `${one.slice(0, 39)}…` : one;
};
const memberPath = (n: any): string | undefined =>
  n?.type === 'Identifier' ? n.name : n?.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' ? ((p) => (p ? `${p}.${n.property.name}` : undefined))(memberPath(n.object)) : undefined;

/** The handler's outline: its settings grouped by object (Game, Game.ProtoInput, Game.Hook…), the callbacks
 *  (Game.Play…) with what they set inside, and its own functions and variables. Works on code that doesn't parse
 *  yet (a line-based fallback). */
export function documentSymbols(text: string): SymbolEntry[] {
  let program: any;
  try {
    program = parseLikeJint(text, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowHashBang: true }).program;
  } catch {
    return outlineByLines(text);
  }
  const groups = new Map<string, SymbolEntry>();
  const out: SymbolEntry[] = [];
  const group = (name: string, at: Span) => {
    let g = groups.get(name);
    if (!g) {
      g = { name, kind: 'namespace', range: { ...at }, selection: { ...at }, children: [] };
      groups.set(name, g);
      out.push(g);
    }
    g.range.end = Math.max(g.range.end, at.end);
    return g;
  };
  const inside = (fn: any): SymbolEntry[] => {
    const kids: SymbolEntry[] = [];
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'AssignmentExpression' && node.operator === '=') {
        const p = memberPath(node.left);
        if (p && /^(Context|Player|Game|PlayerList)\b/.test(p)) kids.push({ name: p, detail: `= ${shortValue(text.slice(node.right.start, node.right.end))}`, kind: 'property', range: { start: node.start, end: node.end }, selection: { start: node.left.start, end: node.left.end } });
      }
      if (node.type === 'FunctionDeclaration' && node.id) kids.push({ name: node.id.name, kind: 'function', range: { start: node.start, end: node.end }, selection: { start: node.id.start, end: node.id.end }, children: inside(node.body) });
      if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') if (node !== fn) return;
      for (const k of Object.keys(node)) {
        const v = (node as any)[k];
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
      }
    };
    visit(fn);
    return kids;
  };
  for (const st of program.body) {
    if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' && st.expression.operator === '=') {
      const a = st.expression;
      const p = memberPath(a.left);
      if (!p) continue;
      const span = { start: st.start, end: st.end };
      const sel = { start: a.left.start, end: a.left.end };
      if (a.right.type === 'FunctionExpression') {
        out.push({ name: p, detail: 'callback', kind: 'function', range: span, selection: sel, children: inside(a.right) });
        continue;
      }
      const dot = p.lastIndexOf('.');
      if (dot < 0) continue;
      group(p.slice(0, dot), span).children!.push({ name: p.slice(dot + 1), detail: `= ${shortValue(text.slice(a.right.start, a.right.end))}`, kind: 'property', range: span, selection: sel });
    } else if (st.type === 'FunctionDeclaration' && st.id) {
      out.push({ name: st.id.name, kind: 'function', range: { start: st.start, end: st.end }, selection: { start: st.id.start, end: st.id.end }, children: inside(st.body) });
    } else if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) {
        if (d.id.type !== 'Identifier') continue;
        const fn = d.init && (d.init.type === 'FunctionExpression' || d.init.type === 'ArrowFunctionExpression');
        out.push({ name: d.id.name, detail: d.init && !fn ? `= ${shortValue(text.slice(d.init.start, d.init.end))}` : undefined, kind: fn ? 'function' : 'variable', range: { start: st.start, end: st.end }, selection: { start: d.id.start, end: d.id.end }, children: fn ? inside(d.init) : undefined });
      }
    }
  }
  return out;
}

/** The outline of code that doesn't parse: top-level assignments and functions, line by line. */
function outlineByLines(text: string): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  const re = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)[ \t]*=(?!=)[ \t]*(.*)$|^function[ \t]+([A-Za-z_$][\w$]*)/gm;
  for (let m; (m = re.exec(text)); ) {
    const end = m.index + m[0].length;
    if (m[3]) {
      const s = m.index + m[0].lastIndexOf(m[3]);
      out.push({ name: m[3], kind: 'function', range: { start: m.index, end }, selection: { start: s, end: s + m[3].length } });
    } else {
      const fn = /^function\b/.test(m[2]);
      out.push({ name: m[1], detail: fn ? 'callback' : `= ${shortValue(m[2].replace(/;\s*$/, ''))}`, kind: fn ? 'function' : 'property', range: { start: m.index, end }, selection: { start: m.index, end: m.index + m[1].length } });
    }
  }
  return out;
}
