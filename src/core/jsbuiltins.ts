// JavaScript's own string methods, as Jint 2.11.58 has them (ES5): offered after a string value, such as
// `Context.StartArguments.` or a variable set from a string (`var args = "-w " + Context.Width; args.`).
// .NET strings reach handlers as JavaScript strings, so these are the methods that work on them (`.Contains`
// and the other .NET string methods don't). Listed as an open object: other names aren't flagged unless they look
// like a typo of one of these.
import type { ApiObject, Member } from './api';

const m = (doc: string, returns: string, ...params: [string, string][][]): Member => ({
  kind: 'method',
  doc,
  overloads: (params.length ? params : [[]]).map((ps) => ({ returns, params: ps.map(([name, type]) => ({ name, type })) })),
});

export const JS_STRING: ApiObject = {
  doc: 'A JavaScript string (ES5, as Jint runs it).',
  open: true,
  members: {
    length: { kind: 'property', type: 'number', ts: 'number', readonly: true, doc: 'The number of characters.' },
    charAt: m('The character at a position (0-based), or "" past the end.', 'string', [['index', 'number']]),
    charCodeAt: m('The UTF-16 code of the character at a position.', 'number', [['index', 'number']]),
    concat: m('The strings joined, like `+`.', 'string', [['other', 'string']]),
    indexOf: m('Where a piece first appears (0-based), or -1. Use `s.indexOf("x") !== -1` to test whether it contains it (ES5 has no `includes`).', 'number', [['search', 'string']], [['search', 'string'], ['from', 'number']]),
    lastIndexOf: m('Where a piece last appears, or -1.', 'number', [['search', 'string']]),
    match: m('Matches a regular expression: the matches, or null.', 'string[] | null', [['pattern', 'RegExp']]),
    replace: m('Replaces the first match (a string), or every match of a regular expression with the g flag: `s.replace(/\\\\/g, "/")`.', 'string', [['search', 'string | RegExp'], ['replacement', 'string']]),
    search: m('Where a regular expression first matches, or -1.', 'number', [['pattern', 'RegExp']]),
    slice: m('Part of the string, from `start` up to (not including) `end`; negative counts from the end.', 'string', [['start', 'number']], [['start', 'number'], ['end', 'number']]),
    split: m('Cuts the string at each separator: `"a,b".split(",")` gives `["a", "b"]`.', 'string[]', [['separator', 'string | RegExp']]),
    substr: m('`length` characters from `start`.', 'string', [['start', 'number']], [['start', 'number'], ['length', 'number']]),
    substring: m('Part of the string, from `start` up to (not including) `end`.', 'string', [['start', 'number']], [['start', 'number'], ['end', 'number']]),
    toLowerCase: m('The string in lower case.', 'string'),
    toUpperCase: m('The string in upper case.', 'string'),
    trim: m('The string without spaces and line breaks at both ends.', 'string'),
  },
};
