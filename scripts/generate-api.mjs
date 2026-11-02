#!/usr/bin/env node
// Generates data/nucleus-api.json and types/nucleus.d.ts from the Nucleus Co-op
// C# sources (the source of truth for what a handler can touch) and the
// SplitScreen.Me docs (the source of descriptions/examples).
//
// Usage:
//   node scripts/generate-api.mjs --nucleus ../splitscreenme-nucleus --www ../splitscreenme-www
//
// Both repos are public:
//   https://github.com/SplitScreen-Me/splitscreenme-nucleus
//   https://github.com/SplitScreen-Me/splitscreenme-www

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const nucleusRepo = path.resolve(args.nucleus ?? process.env.NUCLEUS_REPO ?? '../splitscreenme-nucleus');
const wwwRepo = path.resolve(args.www ?? process.env.WWW_REPO ?? '../splitscreenme-www');
const gaming = path.join(nucleusRepo, 'Master', 'NucleusGaming');

for (const p of [gaming, path.join(wwwRepo, 'docs')]) {
  if (!fs.existsSync(p)) {
    console.error(`Missing ${p}. Pass --nucleus <path> and --www <path>.`);
    process.exit(1);
  }
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// C# parsing
// ---------------------------------------------------------------------------

/** Find `class Name` / `enum Name` and return the text between its braces. */
function findTypeBody(text, kind, name) {
  const re = new RegExp(`\\b${kind}\\s+${name}\\b[^{;]*\\{`, 'g');
  const m = re.exec(text);
  if (!m) throw new Error(`${kind} ${name} not found`);
  const start = m.index + m[0].length;
  const end = matchBrace(text, start - 1);
  return text.slice(start, end);
}

/** Given index of `{`, return index of matching `}` (skips strings, chars and comments). */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const skip = skipNonCode(text, i);
    if (skip !== i) {
      i = skip - 1;
      continue;
    }
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces');
}

/** If a string/char/comment starts at i, return the index right after it; else i. */
function skipNonCode(text, i) {
  const c = text[i];
  const n = text[i + 1];
  if (c === '/' && n === '/') {
    const e = text.indexOf('\n', i);
    return e < 0 ? text.length : e;
  }
  if (c === '/' && n === '*') {
    const e = text.indexOf('*/', i + 2);
    return e < 0 ? text.length : e + 2;
  }
  let j = i;
  let verbatim = false;
  while (text[j] === '$' || text[j] === '@') {
    if (text[j] === '@') verbatim = true;
    j++;
  }
  if (text[j] === '"') {
    j++;
    while (j < text.length) {
      if (verbatim && text[j] === '"' && text[j + 1] === '"') j += 2;
      else if (!verbatim && text[j] === '\\') j += 2;
      else if (text[j] === '"') return j + 1;
      else j++;
    }
    return j;
  }
  if (j === i && c === "'") {
    j++;
    while (j < text.length && text[j] !== "'") j += text[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  return i;
}

const xmlDoc = (lines) =>
  lines
    .join(' ')
    .replace(/<\/?summary>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Split a class body into depth-0 member declarations, keeping /// docs and
 * same-line trailing // comments.
 */
function members(body) {
  const out = [];
  let buf = '';
  let docLines = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '/' && body[i + 1] === '/') {
      const e = body.indexOf('\n', i);
      const end = e < 0 ? body.length : e;
      const comment = body.slice(i, end);
      if (comment.startsWith('///')) docLines.push(comment.slice(3));
      else if (!buf.trim() && out.length && out[out.length - 1].sameLine) {
        out[out.length - 1].trailing = comment.slice(2).trim();
      }
      i = end - 1;
      continue;
    }
    if (c === '\n' && out.length) out[out.length - 1].sameLine = false;
    const skip = skipNonCode(body, i);
    if (skip !== i) {
      buf += body.slice(i, skip);
      i = skip - 1;
      continue;
    }
    if (c === ';') {
      if (buf.trim()) out.push({ decl: norm(buf), doc: xmlDoc(docLines), sameLine: true, block: false });
      buf = '';
      docLines = [];
    } else if (c === '{') {
      const close = matchBrace(body, i);
      // `Type Name { get; set; } = init;` / `Name => ...` handled by decl text
      if (buf.trim()) {
        const isProp = !/\(/.test(buf) && !/\b(class|enum|struct|interface)\b/.test(buf);
        out.push({ decl: norm(buf), doc: xmlDoc(docLines), sameLine: true, block: true, isProp });
      }
      buf = '';
      docLines = [];
      i = close;
      // swallow optional `= init;` after auto-property
      const rest = body.slice(i + 1).match(/^\s*=[^;]*;/);
      if (rest) i += rest[0].length;
    } else {
      buf += c;
    }
  }
  return out.filter((m) => /^\s*public\b/.test(m.decl));
}

const norm = (s) => s.replace(/\[[A-Za-z]+(\([^)]*\))?\]/g, '').replace(/\s+/g, ' ').trim();

const TYPE = String.raw`[\w.]+(?:<[^<>()=;]*(?:<[^<>()=;]*>)?[^<>()=;]*>)?(?:\[\])?\??`;
const MOD = String.raw`(?:(?:static|readonly|extern|virtual|override|new|unsafe|async|const)\s+)*`;

function classify(m, className) {
  const d = m.decl;
  if (/\b(class|enum|struct|interface|delegate|event)\b/.test(d.split('(')[0])) return null;
  const isStatic = /\bstatic\b/.test(d.split('(')[0]);
  let r;
  // methods (incl. extern), but not constructors
  if ((r = d.match(new RegExp(`^public\\s+${MOD}(${TYPE})\\s+(\\w+)\\s*\\(([\\s\\S]*)\\)\\s*(?:=>[\\s\\S]*)?$`)))) {
    if (r[1] === 'override') return null;
    return { kind: 'method', csType: r[1], name: r[2], params: parseParams(r[3]), isStatic };
  }
  if (new RegExp(`^public\\s+${className}\\s*\\(`).test(d)) return null;
  // expression-bodied property
  if ((r = d.match(new RegExp(`^public\\s+${MOD}(${TYPE})\\s+(\\w+)\\s*=>`)))) {
    return { kind: 'property', csType: r[1], name: r[2], readonly: true, isStatic };
  }
  // block property
  if (m.block && m.isProp && (r = d.match(new RegExp(`^public\\s+${MOD}(${TYPE})\\s+(\\w+)$`)))) {
    return { kind: 'property', csType: r[1], name: r[2], readonly: false, isStatic };
  }
  // field
  if ((r = d.match(new RegExp(`^public\\s+${MOD}(${TYPE})\\s+(\\w+)\\s*(?:=\\s*([\\s\\S]+))?$`)))) {
    return {
      kind: 'field',
      csType: r[1],
      name: r[2],
      default: r[3]?.trim(),
      readonly: /\b(readonly|const)\b/.test(d),
      isStatic,
    };
  }
  return null;
}

function parseParams(s) {
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
  if (!s) return [];
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '<' || c === '(') depth++;
    if (c === '>' || c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts.map((p) => {
    p = p.replace(/\/\*.*?\*\//g, '').trim();
    const r = p.match(new RegExp(`^(params\\s+|out\\s+|ref\\s+)?(${TYPE})\\s+(\\w+)(?:\\s*=\\s*(.+))?$`));
    if (!r) return { name: p, csType: 'object' };
    return {
      name: r[3],
      csType: r[2],
      ...(r[1]?.trim() === 'params' ? { rest: true } : {}),
      ...(r[1]?.trim() === 'out' ? { out: true } : {}),
      ...(r[4] !== undefined ? { optional: true, default: r[4].trim() } : {}),
    };
  });
}

function parseEnum(text, name) {
  const body = findTypeBody(text, 'enum', name);
  const values = {};
  let next = 0;
  for (const raw of body.replace(/\/\/.*$/gm, '').split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const [k, v] = t.split('=').map((x) => x.trim());
    let val = next;
    if (v !== undefined) {
      if (/^-?\d+$/.test(v)) val = Number(v);
      else if (/^0x[0-9a-f]+$/i.test(v)) val = parseInt(v, 16);
      else if (values[v] !== undefined) val = values[v];
    }
    values[k] = val;
    next = val + 1;
  }
  return values;
}

function parseClass(file, className) {
  const text = read(gaming, file);
  return members(findTypeBody(text, 'class', className))
    .map((m) => {
      const c = classify(m, className);
      if (!c) return null;
      const doc = [m.doc, m.trailing && !/^TODO/i.test(m.trailing) ? m.trailing : ''].filter(Boolean).join(' ').trim();
      return { ...c, ...(doc ? { sourceDoc: doc } : {}) };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Docs parsing
// ---------------------------------------------------------------------------

/** key -> { doc, example, category, deprecated } */
const docs = new Map();
const MEMBER_LINE = /^\s*((?:Game|Context|Hub|ProtoInput)(?:\.\w+)*)\.(\w+)(\s*(?:=|\(|;|\/\/|$).*)$/;

function setDoc(key, info, override = false) {
  const prev = docs.get(key);
  if (prev && !override) {
    for (const [k, v] of Object.entries(info)) if (v && !prev[k]) prev[k] = v;
    return;
  }
  docs.set(key, { ...(prev ?? {}), ...Object.fromEntries(Object.entries(info).filter(([, v]) => v)) });
}

const cleanMd = (s) =>
  s
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/:::\w*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const undocumented = (s) => !s || /^(\(undocumented\)|no documentation yet\.?)$/i.test(s.trim());

function parseHandlerApiMdx() {
  const text = read(wwwRepo, 'docs', 'handler-api.mdx');
  let category = '';
  let prose = [];
  let code = null;
  const flush = () => {
    prose = [];
  };
  for (const line of text.split('\n')) {
    const h = line.match(/^\s*#{2,4}\s+(?:\d+\.\s*)?(.+?)\s*$/);
    if (code) {
      if (/^```/.test(line)) {
        handleBlock(code, prose.join('\n'), category);
        code = null;
        flush();
      } else code.push(line);
      continue;
    }
    if (/^```js/.test(line)) code = [];
    else if (h) {
      category = h[1].trim();
      flush();
    } else if (/^---\s*$/.test(line)) flush();
    else if (/^Game(\.\w+)+\s*;?\s*\/\//.test(line)) {
      // A bare `Game.X; // description` line outside a code block (handler-api.mdx has one for
      // GamePlayAfterLaunch): its own doc, not prose for the next block.
      const m = line.match(/^(Game(?:\.\w+)*)\.(\w+)\s*;?\s*\/\/\s*(.*)$/);
      if (m) setDoc(`${m[1]}.${m[2]}`, { doc: m[3].trim(), category });
    } else prose.push(line);
  }
}

function handleBlock(lines, proseText, category) {
  const refs = lines.map((l) => l.match(MEMBER_LINE)).filter(Boolean);
  const description = cleanMd(proseText);
  const deprecated = /deprecated/i.test(description) ? description : undefined;
  const single = refs.length === 1 || (refs.length > 1 && new Set(refs.map((r) => r[1] + '.' + r[2])).size === 1);
  for (const r of refs) {
    const key = `${r[1]}.${r[2]}`;
    const rest = r[3];
    const inline = rest.match(/\/\/(.*)$/)?.[1]?.trim();
    const example = r[0].replace(/\s*\/\/.*$/, '').trim();
    const isSig = /^\s*\(/.test(rest);
    let doc = single && !undocumented(description) ? description : '';
    if (!doc && inline && !undocumented(inline)) doc = inline;
    setDoc(key, {
      doc,
      example: isSig ? undefined : example,
      signatureDoc: isSig ? example : undefined,
      category,
      deprecated: deprecated ? 'Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).' : undefined,
    });
  }
}

function parseCreateHandlersMd() {
  const text = read(wwwRepo, 'docs', 'create-handlers.md');
  for (const line of text.split('\n')) {
    const r = line.match(/^\s*`?((?:Game|Context)(?:\.\w+)+)\s*(=[^|]*?)?;?`?\s*\|\s*(.+)$/);
    if (!r) continue;
    const parts = r[1].split('.');
    const name = parts.pop();
    setDoc(`${parts.join('.')}.${name}`, { doc: cleanMd(r[3].replace(/\|\s*$/, '')), example: (r[1] + ' ' + (r[2] ?? '')).trim() + ';' });
  }
}

function parseProtoInputMd() {
  const text = read(wwwRepo, 'docs', 'protoinput.md');
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const cell = cells.find((c) => c.includes('`Game.ProtoInput.'));
    if (!cell) continue;
    const pieces = cell.split(/<br\s*\/?>\s*<br\s*\/?>/);
    const desc = cleanMd(pieces.slice(1).join('\n\n'));
    for (const m of cell.matchAll(/`(Game\.ProtoInput\.(\w+)\s*=[^`]*?);?`/g)) {
      setDoc(`Game.ProtoInput.${m[2]}`, { doc: desc, example: m[1].trim() + ';', category: 'Proto Input' });
    }
  }
  // Code blocks: `Game.ProtoInput.X = ...; // comment`
  for (const m of text.matchAll(/^\s*(Game\.ProtoInput\.(\w+)\s*=[^;\n]*;)\s*(?:\/\/\s*(.*))?$/gm)) {
    setDoc(`Game.ProtoInput.${m[2]}`, { example: m[1], doc: m[3], category: 'Proto Input' });
  }
}

function parseMasterHandler() {
  const text = read(nucleusRepo, 'Master', 'NucleusCoopTool', 'copyoutput', 'handlers', 'MasterHandler.js');
  for (const m of text.matchAll(/^\s*((?:Game)(?:\.\w+)*)\.(\w+)\s*=\s*(\[?)[^\n]*?\/\/\s*(.+)$/gm)) {
    setDoc(`${m[1]}.${m[2]}`, { doc: m[4].replace(/\s+/g, ' ').trim() });
  }
}

parseHandlerApiMdx();
parseCreateHandlersMd();
parseProtoInputMd();
parseMasterHandler();

// handler-api.mdx marks the whole legacy multi-keyboard section deprecated. The Proto Input
// guide refines that: options in its "deprecated, must explicitly be set to false" block stay
// deprecated (and must be turned off when using Proto Input, since some default to true);
// the other plain Game.* options it sets (SupportsMultipleKeyboardsAndMice, LockInputAtStart,
// LockInputToggleKey, ...) are still in use.
const protoLegacy = new Set();
{
  let inLegacyBlock = false;
  for (const line of read(wwwRepo, 'docs', 'protoinput.md').split('\n')) {
    if (/^\s*\/\/.*deprecated/i.test(line)) inLegacyBlock = true;
    else if (/^\s*(\/\/|$|```)/.test(line)) inLegacyBlock = false;
    const m = line.match(/^\s*Game\.(?!ProtoInput\.)(\w+)\s*=/);
    if (!m) continue;
    const d = docs.get(`Game.${m[1]}`) ?? (docs.set(`Game.${m[1]}`, {}), docs.get(`Game.${m[1]}`));
    if (inLegacyBlock) protoLegacy.add(m[1]);
    else delete d.deprecated;
  }
}

// ---------------------------------------------------------------------------
// Assemble the model
// ---------------------------------------------------------------------------

const enumSources = {
  Folder: ['Coop/Generic/Folder.cs', 'Location of a folder used by `Context.GetFolder(...)`.'],
  SaveType: ['Coop/Generic/SaveType.cs', 'Format of a save/config file for `Context.ModifySaveFile(...)`.'],
  SearchType: ['Coop/Generic/SearchType.cs', 'How a text line is matched by the text-file helpers.'],
  RegType: ['Coop/Generic/RegType.cs', 'Registry value kind for `Context.EditRegKey(...)`.'],
  DPIHandling: ['Coop/Generic/DPIHandling.cs', 'How Nucleus compensates for Windows DPI scaling when sizing windows.'],
  DpiAwarenessMode: ['Tools/Hdpi/GameDpiAwareness.cs', 'DPI awareness compatibility flag applied to the game executable.'],
};
const enums = {};
for (const [name, [file, doc]] of Object.entries(enumSources)) enums[name] = { doc, values: parseEnum(read(gaming, file), name) };

// The Proto Input option enums are declared in namespace Nucleus.Gaming too, so handlers can
// use them as Nucleus.SetWindowPosHook.DontResize etc. (verified with Jint 2.11.58).
const protoEnumFile = read(gaming, 'Coop/ProtoInput/ProtoInputEnumsOptions.cs');
if (!/namespace\s+Nucleus\.Gaming\s*[{;\n]/.test(protoEnumFile)) throw new Error('ProtoInputEnumsOptions.cs moved out of Nucleus.Gaming');
const protoEnumDocs = {
  SetWindowPosHook: 'Value for `Game.ProtoInput.SetWindowPosHook`. `true` is the same as `True`.',
  MoveWindowHook: 'Value for `Game.ProtoInput.MoveWindowHook`. `true` is the same as `True`.',
  DrawFakeCursor: 'Value for `Game.ProtoInput.DrawFakeCursor`. `true` is the same as `True`.',
  PutMouseInsideWindow: 'Value for `Game.ProtoInput.PutMouseInsideWindow`. `true` is the same as `True`.',
  SetRemoveBorderHook: 'Value for `Game.ProtoInput.SetRemoveBorderHook`. `true` is the same as `True`.',
  Key: 'Virtual key codes.',
};
for (const m of protoEnumFile.matchAll(/public\s+enum\s+(\w+)/g)) {
  enums[m[1]] = { doc: protoEnumDocs[m[1]] ?? 'Proto Input option values.', values: parseEnum(protoEnumFile, m[1]) };
}

const enumNames = new Set(Object.keys(enums));

const NUM = new Set(['int', 'uint', 'long', 'ulong', 'double', 'float', 'short', 'ushort', 'byte', 'sbyte', 'decimal', 'IntPtr']);
/** Simplified type used by the linter: string|boolean|number|string[]|number[]|function|enum:X|object:X|any */
function simpleType(cs) {
  cs = cs.replace(/\?$/, '');
  if (cs === 'string') return 'string';
  if (cs === 'bool') return 'boolean';
  if (NUM.has(cs)) return 'number';
  if (cs === 'string[]') return 'string[]';
  if (/^(int|uint|float|double|byte|long)\[\]$/.test(cs)) return 'number[]';
  if (cs === 'bool[]') return 'boolean[]';
  if (cs === 'Action' || cs.startsWith('Action<') || cs.startsWith('Func<')) return 'function';
  if (enumNames.has(cs)) return `enum:${cs}`;
  if (cs === 'void') return 'void';
  if (/^(List|IList)</.test(cs) || cs.endsWith('[]')) return 'array';
  return 'any';
}

const objRefs = {
  GameHookInfo: 'GameHook',
  ProtoInputOptions: 'GameProtoInput',
  Hub: 'Hub',
  GenericContext: 'Context',
  UserInfo: 'UserInfo',
};

function tsType(cs) {
  cs = cs.replace(/\?$/, '');
  const st = simpleType(cs);
  if (st.startsWith('enum:')) {
    const n = st.slice(5);
    return enums[n] ? `Nucleus.${n} | number | boolean` : `number | boolean`;
  }
  switch (st) {
    case 'string':
    case 'boolean':
    case 'number':
    case 'void':
      return st;
    case 'string[]':
      return 'string[]';
    case 'number[]':
      return cs === 'byte[]' ? 'number[]' : 'number[]';
    case 'boolean[]':
      return 'boolean[]';
    case 'function':
      return '() => void';
  }
  if (objRefs[cs]) return objRefs[cs];
  if (cs === 'object') return 'any';
  if (cs === 'SaveInfo' || cs === 'SaveInfo[]') return cs.replace('SaveInfo', 'Nucleus.SaveInfo');
  if (cs === 'Rectangle' || cs === 'RectangleF') return 'Rectangle';
  if (cs === 'List<PlayerInfo>') return 'PlayerInfo[]';
  if (cs === 'List<string>') return 'string[]';
  if (cs.startsWith('Dictionary<string')) return 'Record<string, any>';
  if (cs === 'GameOption') return 'GameOption';
  if (cs === 'CustomStep') return 'CustomStep';
  if (cs === 'Type') return 'any';
  if (/^(List|IList)</.test(cs)) return 'any[]';
  return 'any';
}

// Fields that exist on the CLR object but are set by Nucleus itself, or are
// plumbing that handlers should not touch. Not flagged as unknown, but hidden
// from completion and marked as read-only where appropriate.
const INTERNAL = {
  Game: new Set([
    'UpdateAvailable', 'Favorite', 'Options', 'CustomSteps', 'JsFileName', 'HandlerType', 'MetaInfo', 'IsUpdateAvailable',
    'LoadCustomAssemblies', 'SetPlayerList', 'SetProtoInputValues', 'PrePlay', 'CreateContext', 'SaveType', 'SavePath',
    'Profiles_ConfigPath', 'Profiles_SavePath', 'Profiles_Documents_ConfigPath', 'Profiles_Documents_SavePath',
    'Players_BackupPath', 'Content_Folder', 'HandlerId',
  ]),
  Context: new Set(['HandlerType', 'bHasKeyboardPlayer', 'searchType', 'Error', 'Interval']),
};
const READONLY = { Game: new Set(['EpicLang', 'GogLang', 'SteamLang', 'Hub', 'Hook', 'ProtoInput', 'MetaInfo']) };

const REQUIRED_GAME = ['GUID', 'GameName', 'ExecutableName'];

const looseParam = (t) => (t === 'string' ? 'string | number | boolean' : t);

function buildObject(objName, docPrefix, parsed, extraDoc = {}, override = {}) {
  const result = {};
  for (const m of parsed) {
    if (m.isStatic && m.kind !== 'method') continue;
    const key = `${docPrefix}.${m.name}`;
    const d = docs.get(key) ?? {};
    const internal = INTERNAL[objName]?.has(m.name) || undefined;
    if (m.kind === 'method') {
      const entry = (result[m.name] ??= {
        kind: 'method',
        doc: override[m.name] || d.doc || m.sourceDoc || extraDoc[m.name] || '',
        overloads: [],
        ...(internal ? { internal } : {}),
        ...(d.category ? { category: d.category } : {}),
      });
      entry.overloads.push({
        returns: tsType(m.csType),
        params: m.params.filter((p) => !p.out).map((p) => ({
          name: p.name,
          // Jint converts JS primitives to string arguments, so numbers/booleans are accepted.
          type: looseParam(p.rest ? tsType(p.csType.replace(/\[\]$/, '')) : tsType(p.csType)),
          csType: p.csType,
          ...(p.rest ? { rest: true } : {}),
          // C# default values don't make a parameter optional in Jint 2.11: it only matches
          // overloads with exactly as many parameters as arguments (testbench probe 110:
          // Context.RandomString(8) throws, RandomString(8, false) works). So they're required.
          ...(p.optional ? { csDefault: p.default } : {}),
        })),
      });
      continue;
    }
    if (result[m.name]) continue;
    const ref = objRefs[m.csType];
    result[m.name] = {
      kind: ref && m.csType !== 'GenericContext' ? 'object' : m.kind === 'property' ? 'property' : 'field',
      csType: m.csType,
      type: simpleType(m.csType),
      ts: tsType(m.csType),
      ...(ref ? { ref } : {}),
      ...(m.default !== undefined ? { default: m.default } : {}),
      ...(m.readonly || READONLY[objName]?.has(m.name) ? { readonly: true } : {}),
      ...(internal ? { internal } : {}),
      doc: override[m.name] || d.doc || m.sourceDoc || extraDoc[m.name] || '',
      ...(d.example ? { example: d.example } : {}),
      ...(d.category ? { category: d.category } : {}),
      ...(d.deprecated ? { deprecated: d.deprecated } : {}),
      ...(objName === 'Game' && protoLegacy.has(m.name) ? { protoInputLegacy: true } : {}),
      ...(objName === 'Game' && REQUIRED_GAME.includes(m.name) ? { required: true } : {}),
    };
  }
  return result;
}

const gameParsed = parseClass('Coop/Generic/GenericGameInfo.cs', 'GenericGameInfo');
const hookParsed = parseClass('Coop/Generic/GameHookInfo.cs', 'GameHookInfo');
const protoOptParsed = parseClass('Coop/ProtoInput/ProtoInputOptions.cs', 'ProtoInputOptions');
const contextParsed = parseClass('Coop/Generic/GenericContext.cs', 'GenericContext');
const playerParsed = parseClass('Coop/PlayerInfo.cs', 'PlayerInfo');
const protoRtText = read(gaming, 'Coop/ProtoInput/ProtoInput.cs');
const protoRtParsed = members(findTypeBody(protoRtText, 'class', 'ProtoInput'))
  .map((m) => classify(m, 'ProtoInput'))
  .filter((m) => m && m.kind === 'method');
const exposedParsed = parseClass('Coop/ProtoInput/ProtoInput.cs', 'ExposedValues');

// Facts checked in the Nucleus source; these replace the docs site's text.
const gameDocOverride = {
  Play: 'Called once per instance (player), in player order. By default it runs after Nucleus has set up the instance (Goldberg, XInput DLLs, ...) and before the game starts, and `Context.StartArguments` is read after it. `Game.GamePlayBeforeGameSetup` runs it before that setup; `Game.GamePlayAfterLaunch` runs it after the game has started (then `Context.StartArguments` has no effect). If both are true it never runs. `Context`, `Player`, `PlayerList`, `Handler` and `ProtoInput` are available inside it. An error thrown here ends the whole session.',
  GamePlayAfterLaunch: 'Run `Game.Play` after the instance has been launched instead of before. Changes to `Context.StartArguments` then have no effect. Don\'t combine with `Game.GamePlayBeforeGameSetup`: if both are true, `Game.Play` never runs.',
  GamePlayBeforeGameSetup: 'Run `Game.Play` before the majority of the instance is set up (Goldberg, XInput DLLs, ...) instead of after it. Don\'t combine with `Game.GamePlayAfterLaunch`: if both are true, `Game.Play` never runs.',
  OnStop: 'Called when the session ends, with the last player\'s `Context`/`Player`. If it throws, Nucleus skips its cleanup (leftover processes, registry restore, temporary users, backups), so keep it error-free. `Context` is undefined if the session ends before the first instance was set up.',
  OnFinishedSetup: 'Called once after all instances have been set up and started, with the last player\'s `Context`/`Player`. An error thrown here ends the session.',
  SetupSse: 'Never called by Nucleus (declared but unused): assigning it has no effect.',
};
const gameExtraDoc = {
  AddOption: 'Adds a user-selectable option to the game profile. Read it back in `Game.Play` with `Context.Options["key"]`.',
  ShowOptionAsStep: 'Shows a previously added option as its own setup step before launching.',
  Folder: 'Path to this handler\'s own folder (Nucleus-Coop\\handlers\\<handler name>). Set by Nucleus before the handler runs; overwriting it changes where Game.Folder points for the rest of the handler.',
  Hub: 'Hub metadata, filled in by hub.splitscreen.me when the handler is published.',
  Hook: 'Settings for Nucleus\' custom xinput/x360ce hook DLL.',
  ProtoInput: 'Proto Input options (multiple mice/keyboards, focus hooks, input redirection). See https://www.splitscreen.me/docs/protoinput',
  OnCustomHotKey_1: 'Called when the first custom hotkey from `Game.CustomHotkeys` is pressed. Required if that hotkey is defined (Nucleus calls it without checking). `Context` is the last player\'s, or undefined before the first instance is set up.',
  OnCustomHotKey_2: 'Called when the second custom hotkey from `Game.CustomHotkeys` is pressed. Required if that hotkey is defined (Nucleus calls it without checking). `Context` is the last player\'s, or undefined before the first instance is set up.',
  OnCustomHotKey_3: 'Called when the third custom hotkey from `Game.CustomHotkeys` is pressed. Required if that hotkey is defined (Nucleus calls it without checking). `Context` is the last player\'s, or undefined before the first instance is set up.',
  Description: 'Text shown to the user when the game is selected in Nucleus (setup notes, known issues, ...).',
  ExecutableNames: 'Alternative executable names this handler matches (e.g. different store versions).',
  Debug: 'Writes a detailed debug log while the handler runs.',
};
const contextExtraDoc = {
  Width: 'Width in pixels of this instance\'s window.',
  Height: 'Height in pixels of this instance\'s window.',
  PosX: 'X position of this instance\'s window.',
  PosY: 'Y position of this instance\'s window.',
  MonitorWidth: 'Width of the monitor this instance is on.',
  MonitorHeight: 'Height of the monitor this instance is on.',
  PlayerID: 'Zero-based index of the player/instance being set up.',
  NumberOfPlayers: 'Total number of players in this session.',
  Nickname: 'Nickname of the current player (set in Nucleus settings).',
  PlayerSteamID: 'Steam ID assigned to the current player.',
  GamepadId: 'One-based index of the current player\'s gamepad.',
  IsKeyboardPlayer: 'True if the current player uses keyboard & mouse.',
  HasKeyboardPlayer: 'True if any player in the session uses keyboard & mouse.',
  AspectRatio: 'Aspect ratio of this instance as a string, e.g. "16:9".',
  AspectRatioDecimal: 'Aspect ratio of this instance as a number (Width / Height).',
  OrigAspectRatio: 'Aspect ratio of the full monitor as a string.',
  OrigAspectRatioDecimal: 'Aspect ratio of the full monitor as a number.',
  RootFolder: 'Root of the current instance\'s game folder (Nucleus-Coop\\content\\<GUID>\\Instance<N>).',
  RootInstallFolder: 'Root of the original game installation.',
  ExePath: 'Full path of the executable being launched for this instance.',
  Options: 'Values chosen by the user for options added with `Game.AddOption`.',
  Arch: 'Architecture of the game executable ("x86" or "x64").',
  LocalIP: 'Local IP address of this PC.',
  UserName: 'Windows user name.',
  GetFolder: 'Returns the path of one of the well known folders. Example: `Context.GetFolder(Nucleus.Folder.InstancedGameFolder)`.',
  ModifySaveFile: 'Edits keys in an INI/CFG file. Example: `Context.ModifySaveFile(path, path, Nucleus.SaveType.INI, [new Nucleus.IniSaveInfo("Section", "Key", "Value")]);`',
  PatchFile: 'Patches bytes in a file (copy of the original). The file must be excluded from symlinking (e.g. via `Game.FileSymlinkExclusions`).',
  WriteTextFile: 'Writes the given lines to a text file, replacing its contents.',
  StartProcess: 'Starts a process with arguments, optionally elevated.',
  Wait: 'Pauses the handler for the given number of milliseconds.',
  Log: 'Writes a line to the Nucleus debug log (requires `Game.Debug = true` or debug logging enabled).',
  RandomInt: 'Returns a random integer between min and max.',
  RandomString: 'Returns a random alphanumeric string of the given length.',
  HexEdit: 'Writes bytes at an address in a file.',
  CopyScriptFolder: 'Copies the handler\'s folder (Game.Folder) to the given destination.',
  EditRegKey: 'Edits a registry value (backed up and restored when Nucleus closes). Base key is e.g. "HKEY_CURRENT_USER".',
  ReadRegKey: 'Reads a registry value.',
  CustomUserGeneralValues: 'Answers to `Game.CustomUserGeneralPrompts`.',
  CustomUserPlayerValues: 'Answers to `Game.CustomUserPlayerPrompts` for the current player.',
  CustomUserInstanceValues: 'Answers to `Game.CustomUserInstancePrompts` for the current instance.',
};

const model = {
  $comment: 'Generated by scripts/generate-api.mjs. Do not edit by hand.',
  source: {
    nucleus: gitRev(nucleusRepo),
    www: gitRev(wwwRepo),
  },
  jint: jintVersion(),
  globals: {
    Game: { type: 'Game', doc: 'The handler being defined. Set options on it at the top level of the file; define `Game.Play` to customise each instance.', topLevel: true },
    Hub: { type: 'Hub', doc: 'Hub metadata (filled in when published on hub.splitscreen.me).', topLevel: true },
    Nucleus: { type: 'Nucleus', doc: 'The `Nucleus.Gaming` .NET namespace: enums such as `Nucleus.Folder` and helper classes such as `Nucleus.IniSaveInfo`.', topLevel: true },
    System: { type: 'any', doc: '.NET `System` namespace (e.g. `System.IO.File.Copy`, `System.IO.Path.Combine`).', topLevel: true },
    importNamespace: { type: 'function', doc: 'Imports a .NET namespace, e.g. `importNamespace("System.IO")`.', topLevel: true },
    Context: { type: 'Context', doc: 'Per-instance context. Only available inside `Game.Play` and other callbacks.', topLevel: false },
    Player: { type: 'PlayerInfo', doc: 'The player whose instance is being set up. Only available inside `Game.Play` and other callbacks.', topLevel: false },
    PlayerList: { type: 'PlayerInfo[]', doc: 'All players of the session (`PlayerList.Count`). Only available inside callbacks.', topLevel: false },
    Handler: { type: 'any', doc: 'The running `GenericGameHandler`. Only available inside callbacks.', topLevel: false },
    ProtoInput: { type: 'ProtoInputRuntime', doc: 'Proto Input runtime API (install hooks, toggle message filters). Only available inside callbacks such as `Game.ProtoInput.OnInputLocked`.', topLevel: false },
  },
  objects: {
    Game: { doc: 'Handler definition (`GenericGameInfo`).', members: buildObject('Game', 'Game', gameParsed, gameExtraDoc, gameDocOverride) },
    GameHook: { doc: 'Custom xinput/x360ce hook settings (`Game.Hook`).', members: buildObject('GameHook', 'Game.Hook', hookParsed) },
    GameProtoInput: { doc: 'Proto Input options (`Game.ProtoInput`).', members: buildObject('GameProtoInput', 'Game.ProtoInput', protoOptParsed) },
    Context: { doc: 'Per-instance context (`GenericContext`).', members: buildObject('Context', 'Context', contextParsed, contextExtraDoc) },
    PlayerInfo: {
      doc: 'A player (`PlayerInfo`).',
      members: buildObject('PlayerInfo', 'Player', playerParsed.filter((m) => m.name !== 'Image')),
    },
    Hub: {
      doc: 'Hub metadata.',
      members: {
        Maintainer: { kind: 'object', ref: 'HubMaintainer', type: 'any', ts: 'HubMaintainer', doc: 'Handler maintainer on hub.splitscreen.me.' },
        Handler: { kind: 'object', ref: 'HubHandler', type: 'any', ts: 'HubHandler', doc: 'Handler identity on hub.splitscreen.me, used for update checks.' },
      },
    },
    HubMaintainer: {
      doc: 'Hub maintainer.',
      members: {
        Name: { kind: 'field', type: 'string', ts: 'string', doc: 'Maintainer display name.' },
        Id: { kind: 'field', type: 'string', ts: 'string', doc: 'Maintainer user id on the hub.' },
      },
    },
    HubHandler: {
      doc: 'Hub handler identity.',
      members: {
        Version: { kind: 'field', type: 'number', ts: 'number', doc: 'Published version number. Nucleus compares it with the hub to offer updates.' },
        Id: { kind: 'field', type: 'string', ts: 'string', doc: 'Handler id on hub.splitscreen.me.' },
      },
    },
    ProtoInputRuntime: {
      doc: 'Proto Input runtime API.',
      members: {
        ...buildObject('ProtoInputRuntime', 'ProtoInput', protoRtParsed.map((m) => ({ ...m, params: m.params.map((p) => ({ ...p, csType: /HookIDs|FilterIDs/.test(p.csType) ? 'uint' : p.csType })) }))),
        Values: { kind: 'object', ref: 'ProtoInputValues', type: 'any', ts: 'ProtoInputValues', readonly: true, doc: 'Hook and message filter IDs for `InstallHook`, `EnableMessageFilter`, ...' },
      },
    },
    ProtoInputValues: { doc: 'Proto Input hook/filter ids.', members: buildObject('ProtoInputValues', 'ProtoInput.Values', exposedParsed) },
    UserInfo: { doc: 'User info.', members: { GetLocalIP: { kind: 'method', doc: 'Local IP address.', overloads: [{ returns: 'string', params: [] }] } } },
  },
  enums,
  nucleusClasses: {
    IniSaveInfo: { doc: 'A key in an INI file, for `Context.ModifySaveFile(..., Nucleus.SaveType.INI, [...])`.', params: ['section', 'key', 'value'] },
    CfgSaveInfo: { doc: 'A key in a CFG file, for `Context.ModifySaveFile(..., Nucleus.SaveType.CFG, [...])`.', params: ['section', 'key', 'value'] },
    SaveInfo: { doc: 'Base class of save file entries.', params: ['section', 'key', 'value'] },
  },
};

// GenericGameInfo.CreateContext copies every same-named field onto the context,
// so Context.X mirrors Game.X: reuse its docs.
for (const [k, m] of Object.entries(model.objects.Context.members)) {
  const g = model.objects.Game.members[k];
  if (g && m.kind !== 'method' && g.kind !== 'method') {
    if (!m.doc && g.doc) m.doc = g.doc;
    m.doc = `${m.doc ? m.doc + '\n\n' : ''}Copied from \`Game.${k}\` for the current instance.`;
  }
}

fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'nucleus-api.json'), JSON.stringify(model, null, 1) + '\n');

// ---------------------------------------------------------------------------
// TypeScript declarations
// ---------------------------------------------------------------------------

const jsdoc = (doc, extra = [], indent = '  ') => {
  const lines = [...(doc ? doc.split('\n') : []), ...extra].map((l) => l.replace(/\*\//g, '*\\/'));
  if (!lines.length) return '';
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`.trimEnd()).join('\n')}\n${indent} */\n`;
};

function iface(name, obj) {
  let s = jsdoc(obj.doc, [], '');
  s += `interface ${name} {\n`;
  for (const [k, m] of Object.entries(obj.members)) {
    if (m.kind === 'method') {
      for (const o of m.overloads) {
        const variants = [o.params.map((p) => `${p.rest ? '...' : ''}${safeIdent(p.name)}${p.optional ? '?' : ''}: ${p.rest ? `(${p.type})[]` : p.type}`)];
        // .NET `params T[]` also accepts a single JS array.
        if (o.params.some((p) => p.rest)) variants.push(o.params.map((p) => `${safeIdent(p.name)}${p.optional ? '?' : ''}: ${p.rest ? `(${p.type})[]` : p.type}`));
        for (const params of variants) {
          s += jsdoc(m.doc, m.internal ? ['@internal'] : []);
          s += `  ${k}(${params.join(', ')}): ${o.returns};\n`;
        }
      }
    } else {
      const extra = [];
      if (m.default !== undefined) extra.push(`@default ${m.default}`);
      if (m.example) extra.push(`@example ${m.example}`);
      if (m.deprecated) extra.push(`@deprecated ${m.deprecated}`);
      s += jsdoc(m.doc, extra);
      let t = m.ts;
      if (t === '() => void') t = '(() => void) | null';
      s += `  ${m.readonly ? 'readonly ' : ''}${k}: ${t};\n`;
    }
  }
  return s + '}\n';
}
const RESERVED = new Set(['function', 'default', 'new', 'class', 'var', 'in', 'delete', 'type']);
const safeIdent = (n) => (RESERVED.has(n) ? `_${n}` : n);

let dts = `// Type definitions for Nucleus Co-op game handlers.
// Generated by splitscreenme-vscode (scripts/generate-api.mjs) from
// SplitScreen-Me/splitscreenme-nucleus@${model.source.nucleus ?? 'unknown'}.
// Do not edit by hand.

interface Rectangle { X: number; Y: number; Width: number; Height: number; }
interface GameOption { Name: string; Description: string; Key: string; Value: any; DefaultValue: any; Hidden: boolean; }
interface CustomStep { Option: GameOption; Title: string; Required: boolean; UpdateRequired: (() => void) | null; }
/** A .NET List exposed to JavaScript. */
interface DotNetList<T> { Count: number; [index: number]: T; }

`;
for (const [name, obj] of Object.entries(model.objects)) dts += iface(name, obj) + '\n';

dts += `declare namespace Nucleus {\n`;
for (const [name, e] of Object.entries(enums)) {
  dts += jsdoc(e.doc);
  dts += `  enum ${name} {\n${Object.entries(e.values).map(([k, v]) => `    ${k} = ${v},`).join('\n')}\n  }\n`;
}
dts += `  /** Base class of save file entries. */\n  class SaveInfo { constructor(section: string, key: string, value: string); }\n`;
for (const [name, c] of Object.entries(model.nucleusClasses)) {
  if (name === 'SaveInfo') continue;
  dts += jsdoc(c.doc) + `  class ${name} extends SaveInfo { constructor(section: string, key: string, value: string | number | boolean); Section: string; Key: string; Value: string; }\n`;
}
dts += `}\n\n`;

for (const [name, g] of Object.entries(model.globals)) {
  if (name === 'Nucleus') continue;
  let t = g.type;
  if (name === 'PlayerList') t = 'DotNetList<PlayerInfo>';
  if (name === 'importNamespace') {
    dts += jsdoc(g.doc, [], '') + `declare function importNamespace(name: string): any;\n`;
    continue;
  }
  dts += jsdoc(g.doc, [], '') + `declare const ${name}: ${t};\n`;
}

fs.mkdirSync(path.join(root, 'types'), { recursive: true });
fs.writeFileSync(path.join(root, 'types', 'nucleus.d.ts'), dts);

const count = (o) => Object.keys(o.members).length;
console.log(
  `Wrote data/nucleus-api.json and types/nucleus.d.ts: ` +
    Object.entries(model.objects).map(([k, o]) => `${k}=${count(o)}`).join(' '),
);
const undocumentedGame = Object.entries(model.objects.Game.members).filter(([, m]) => !m.doc && !m.internal).map(([k]) => k);
console.log(`Game members without docs (${undocumentedGame.length}): ${undocumentedGame.join(', ')}`);

function gitRev(dir) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}
function jintVersion() {
  try {
    return read(gaming, 'packages.config').match(/id="Jint" version="([^"]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}
