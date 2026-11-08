// Editor features for Nucleus handlers, as plain data: hover, completion, signature help, code
// actions, formatting and inlay hints. Every editor adapter (src/extension.ts for VS Code,
// src/lsp.ts for the Language Server) only converts these to its own types, so a new editor gets the
// same behaviour. Positions are UTF-16 offsets into the text (what JavaScript strings index), which
// is also what LSP counts by default. No `vscode` import here, no Node APIs either.
import { blockedItemAt, blockedListAt, blockedLists, blockTarget, COMMON_MESSAGES, hex, messageMarkdown } from './wm';
import { api, claudeNote, DOCS_URL, Member, memberMarkdown, memberSignature, membersOf, ownerLabel, Resolved } from './api';
import { callContextAt, memberContextAt, resolveAt, valueContextAt } from './complete';
import { Diagnostic, lineOf, lineStart, looksLikeHandler, RuleId, RULES, Severity, TextEdit } from './lint';
import { fixAll } from './fix';
import { formatHandler } from './format';
import { parseLikeJint } from './jsparse';

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
export function hoverAt(text: string, offset: number): HoverInfo | undefined {
  // A number in Game.ProtoInput.BlockedMessages: the window message's name and what it does.
  const msg = blockedItemAt(text, offset);
  if (msg) return { markdown: messageMarkdown(msg.id), range: { start: msg.start, end: msg.end } };
  const r = resolveAt(text, offset);
  if (!r) return undefined;
  const range = { start: r.start, end: r.end };
  const word = text.slice(r.start, r.end);
  const res = r.resolved;
  switch (res.kind) {
    case 'member':
      return { markdown: memberMarkdown(res.owner, res.name, res.member), range };
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
      if (!g) return undefined;
      return { markdown: '```ts\n' + `${word}: ${g.type}` + '\n```\n\n' + g.doc + (g.topLevel ? '' : notTopLevel) + `\n\n[Handler API docs](${DOCS_URL})`, range };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Completion

export type CompletionKind = 'field' | 'property' | 'method' | 'module' | 'variable' | 'class' | 'enum' | 'enumMember' | 'constant' | 'value' | 'snippet';

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
export function completionsAt(text: string, offset: number): CompletionEntry[] | undefined {
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
      detail: m.hub ? `Blocked by ${m.hub} of 600 Hub handlers` : 'Window message',
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
  if (!ctx) return globalCompletions(text, offset);

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

function ownerOf(base: Resolved): string {
  if (base.kind === 'object') return base.type;
  if (base.kind === 'member' && base.member.ref) return base.member.ref;
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
}
export interface SignatureHelpInfo {
  signatures: SignatureEntry[];
  activeSignature: number;
  activeParameter: number;
}

/** The overloads of the method (or Nucleus class constructor) whose call the cursor is in. */
export function signatureHelpAt(text: string, offset: number): SignatureHelpInfo | undefined {
  const c = callContextAt(text, offset);
  if (!c) return undefined;
  const signatures: SignatureEntry[] = [];
  let activeSignature = 0;
  if (c.callee.kind === 'member' && c.callee.member.kind === 'method') {
    const { owner, name, member } = c.callee;
    for (const o of member.overloads ?? []) {
      const params = o.params.map((p) => `${p.rest ? '...' : ''}${p.name}: ${p.type}`);
      signatures.push({ label: `${ownerLabel(owner)}.${name}(${params.join(', ')}): ${o.returns}`, documentation: member.doc + (claudeNote(member) ? `\n\n_✎ ${claudeNote(member)}_` : ''), parameters: params });
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
export function formatEdits(text: string, opts: { insertSpaces: boolean; tabSize: number }): { edits: TextEdit[] } | { error: string } {
  const r = formatHandler(text, { indent: opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t' });
  if (!r.ok) return { error: r.reason };
  return { edits: r.changed ? [{ start: 0, end: text.length, text: r.code }] : [] };
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
