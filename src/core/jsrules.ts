// General JavaScript mistakes, checked by ESLint's own rules (its Linter class, in-process: no config files, no
// plugins), next to our Jint/Nucleus rules in core/lint.ts. Only rules that catch real bugs, each checked against
// every Hub handler for false alarms. Each has a plain-language "why" for handler authors; ESLint's own fixes and
// suggestions become our quick fixes. Rule ids are ESLint's, so JavaScript developers recognise them.
import { Linter } from 'eslint/universal';

export interface JsRule {
  /** A short plain-language name for the problem (the workbench's card title). */
  title: string;
  /** Why it matters in a handler (after ESLint's own message). */
  why: string;
  options?: unknown[];
}

export const JS_RULES = {
  'no-cond-assign': { title: 'An assignment where a comparison was meant?', why: 'A single `=` inside a condition assigns: the condition is the assigned value. To compare, write `==` (or `===`).' },
  'no-constant-condition': { title: 'A condition that is always the same', why: 'This condition is always the same, so one branch never runs. A common cause: `=` (assign) where `==` (compare) was meant.', options: [{ checkLoops: false }] },
  'no-dupe-keys': { title: 'The same key twice in an object', why: 'An object can\'t have the same key twice: the later value replaces the earlier one.' },
  'no-duplicate-case': { title: 'The same case twice', why: 'Only the first of two identical `case`s ever runs.' },
  'no-dupe-else-if': { title: 'An else-if that can never run', why: 'This `else if` tests what an earlier branch already caught, so it never runs.' },
  'no-dupe-args': { title: 'Two parameters with the same name', why: 'Two parameters with the same name: the second hides the first.' },
  'use-isnan': { title: 'A comparison with NaN', why: 'Nothing equals NaN, not even NaN: this comparison is always false. Use `isNaN(x)`.' },
  'valid-typeof': { title: 'A typeof check that is never true', why: '`typeof` only gives "undefined", "object", "boolean", "number", "string" or "function": this comparison is never true (a typo?).' },
  'no-unreachable': { title: 'Code that never runs', why: 'Nothing after `return`, `throw`, `break` or `continue` runs.' },
  'no-unused-expressions': { title: 'A line that does nothing', why: 'This line computes something and throws the result away: it does nothing. A missing assignment or call, or a statement split over two lines?', options: [{ allowShortCircuit: true, allowTernary: true }] },
  'no-self-assign': { title: 'A value assigned to itself', why: 'Assigning a value to itself does nothing.' },
  'no-self-compare': { title: 'A value compared with itself', why: 'Comparing something with itself is always the same; probably a typo.' },
  'no-unsafe-negation': { title: 'A ! in the wrong place', why: '`!a in b` means `(!a) in b`; you probably meant `!(a in b)`.' },
  'no-compare-neg-zero': { title: 'A comparison with -0', why: '`x === -0` is also true for 0. Use `1 / x === -Infinity` if you really need to tell them apart.' },
  'no-invalid-regexp': { title: 'An invalid regular expression', why: 'This regular expression is invalid: it throws when that line runs.' },
  'no-empty-character-class': { title: 'A regular expression that never matches', why: '`[]` in a regular expression matches nothing, so the whole expression never matches.' },
  'no-control-regex': { title: 'A control character in a regular expression', why: 'A control character in a regular expression is almost always a mistake (a lost backslash).' },
  'no-sparse-arrays': { title: 'A hole in a list', why: 'Two commas in a row leave a hole (`undefined`) in the array; usually a typo.' },
  'no-useless-escape': { title: 'A backslash that disappears', why: 'In a string a backslash only escapes some characters: here it disappears. In a Windows path write two backslashes (`"C:\\\\Games"`), or `"\\\\"` for one.' },
  'no-octal-escape': { title: 'A backslash before a number', why: 'A backslash before a digit in a string is a character code, not a backslash: `"\\\\45"`, not `"\\45"` (which is "%"). Common in Windows paths with numbers.' },
  'no-loss-of-precision': { title: 'A number too precise for JavaScript', why: 'JavaScript numbers can\'t hold this value exactly: it is silently rounded.' },
  'for-direction': { title: 'A loop that counts the wrong way', why: 'The counter moves away from the end condition, so the loop never stops (or never runs).' },
  'no-unsafe-finally': { title: 'A return inside finally', why: 'A `return`/`throw` in `finally` overrides the one in `try`/`catch`, hiding errors.' },
  'no-func-assign': { title: 'A function overwritten', why: 'This overwrites a function declared with the same name.' },
  'no-ex-assign': { title: 'A caught error overwritten', why: 'Overwriting the caught error loses it.' },
  'no-obj-calls': { title: 'Math or JSON called as a function', why: '`Math` and `JSON` are objects, not functions: calling them throws.' },
  'no-shadow-restricted-names': { title: 'A variable named undefined, NaN or Infinity', why: 'Naming a variable `undefined`, `NaN` or `Infinity` changes what that name means everywhere after.' },
} as const satisfies Record<string, JsRule>;

export type JsRuleId = keyof typeof JS_RULES;

export interface JsDiagnostic {
  rule: JsRuleId;
  message: string;
  start: number;
  end: number;
  fixes: { title: string; edits: { start: number; end: number; text: string }[] }[];
}

let linter: Linter | undefined;

/** ESLint's findings for `text` (only the given rules). Nothing when ESLint can't parse it (ours reports that). */
export function jsRuleDiagnostics(text: string, rules: JsRuleId[]): JsDiagnostic[] {
  if (!rules.length) return [];
  linter ??= new Linter({ configType: 'flat' });
  const config = [
    {
      // ES5 plus let/const, like Jint; newer syntax is reported by our es5-only rule.
      languageOptions: { ecmaVersion: 2015 as const, sourceType: 'script' as const },
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' as const },
      rules: Object.fromEntries(rules.map((r) => [r, ['warn', ...((JS_RULES[r] as JsRule).options ?? [])]])),
    },
  ];
  let messages: Linter.LintMessage[];
  try {
    messages = linter.verify(text, config as any);
  } catch {
    return [];
  }
  if (messages.some((m) => m.fatal)) return [];
  const starts = [0];
  // ESLint's own line breaks (\r\n, \r, \n, U+2028, U+2029), so positions after a lone \r stay right.
  for (const m of text.matchAll(/\r\n|[\r\n\u2028\u2029]/g)) starts.push(m.index! + m[0].length);
  const offset = (line: number, col: number) => Math.min(text.length, (starts[line - 1] ?? text.length) + col - 1);
  return messages
    .filter((m) => m.ruleId && m.ruleId in JS_RULES)
    .map((m) => {
      const start = offset(m.line, m.column);
      const end = m.endLine ? offset(m.endLine, m.endColumn ?? m.column) : start + 1;
      const fixes = [
        ...(m.fix ? [{ title: 'Fix it', edits: [{ start: m.fix.range[0], end: m.fix.range[1], text: m.fix.text }] }] : []),
        ...(m.suggestions ?? []).map((s) => ({ title: fixTitle(s.desc), edits: [{ start: s.fix.range[0], end: s.fix.range[1], text: s.fix.text }] })),
      ];
      // A real backslash is what a Windows path needs: offer that first.
      if (m.ruleId === 'no-useless-escape') fixes.reverse();
      const rule = m.ruleId as JsRuleId;
      return { rule, message: `${m.message} ${JS_RULES[rule].why}`, start, end: Math.max(end, start + 1), fixes };
    });
}

/** ESLint's suggestion texts, in plainer words. */
function fixTitle(desc: string): string {
  if (/^Replace the `\\` with `\\\\`/.test(desc)) return 'Make it a real backslash (\\\\)';
  if (/^Remove the `\\`/.test(desc)) return 'Remove the backslash';
  return desc.replace(/\s*This (maintains|changes) the current functionality\.?$/, '');
}
