// JavaScript's own ES5 objects (String, Array, Math, JSON, Number) and global functions, as Jint 2.11.58 has them,
// from data/js-builtins.json (generated from TypeScript's lib.es5.d.ts by scripts/generate-jsbuiltins.mjs).
// Offered after a string (`Context.StartArguments.`, `var args = "-w " + …; args.`), an array literal, `Math.` and
// `JSON.`. .NET strings reach handlers as JavaScript strings, so these are the methods that work on them.
import raw from '../../data/js-builtins.json';
import type { ApiObject, Member } from './api';

type Raw = { objects: Record<string, { doc: string; members: Record<string, Member> }>; functions: Record<string, Member> };
const data = raw as unknown as Raw;

/** Handler-specific notes added to TypeScript's docs. */
const NOTES: Record<string, string> = {
  'String.indexOf': 'To test whether a string contains another: `s.indexOf("x") !== -1` (ES5 has no `includes`; .NET\'s `Contains` doesn\'t work on these strings).',
  'String.replace': 'With a string it replaces only the first match; for every match use a regular expression with the g flag: `s.replace(/\\\\/g, "/")`.',
  'String.split': '`"a,b".split(",")` gives `["a", "b"]`.',
  'Array.indexOf': 'To test whether an array contains a value: `a.indexOf(x) !== -1` (ES5 has no `includes`).',
};

/** Objects that aren't fixed lists of members for our purposes: other names aren't flagged unless they look like a typo. */
const OPEN = new Set(['String', 'Array', 'Number']);

export const JS_OBJECTS: Record<string, ApiObject> = Object.fromEntries(
  Object.entries(data.objects).map(([name, o]) => [
    name,
    {
      doc: o.doc,
      open: OPEN.has(name),
      members: Object.fromEntries(Object.entries(o.members).map(([k, m]) => [k, NOTES[`${name}.${k}`] ? { ...m, doc: `${m.doc}\n\n${NOTES[`${name}.${k}`]}` } : m])),
    },
  ]),
);
/** parseInt, parseFloat, isNaN, isFinite, encodeURIComponent… */
export const JS_FUNCTIONS: Record<string, Member> = data.functions;
/** Globals that are JavaScript objects with members (`Math.`, `JSON.`). */
export const JS_GLOBAL_OBJECTS = ['Math', 'JSON'];
export const isJsBuiltin = (owner: string) => owner === '' || !!JS_OBJECTS[owner];
export const mdnUrl = (owner: string, name: string) =>
  `https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/${owner || name}${owner ? `/${name}` : ''}`;
