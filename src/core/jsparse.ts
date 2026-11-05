// Parsing the way Jint 2.11.58 does where acorn is stricter: Jint treats `let`/`const` as `var`,
// so redeclaring one (`let x` then `var x` in a nested block) loads fine there (probe 112), while
// acorn rejects it as ES2015 does. On that error we parse again with the declarations as `var`.
import * as acorn from 'acorn';

/** `let`/`const` declaration keywords as `var`, padded so every offset stays the same. */
export function letConstAsVar(text: string): string {
  const edits: [number, number][] = [];
  try {
    const tokens = [...acorn.tokenizer(text, { ecmaVersion: 'latest', allowHashBang: true })];
    tokens.forEach((t, i) => {
      const next = tokens[i + 1];
      if (t.type === acorn.tokTypes._const) edits.push([t.start, t.end]);
      // `let` is a declaration only when a binding follows (else it is a plain identifier).
      else if (t.type === acorn.tokTypes.name && (t as acorn.Token & { value?: unknown }).value === 'let' && next && (next.type === acorn.tokTypes.name || next.type === acorn.tokTypes.bracketL || next.type === acorn.tokTypes.braceL)) edits.push([t.start, t.end]);
    });
  } catch {
    return text;
  }
  let out = text;
  for (const [s, e] of edits.reverse()) out = out.slice(0, s) + 'var'.padEnd(e - s) + out.slice(e);
  return out;
}

const REDECLARED = /has already been declared/;

/** acorn.parse, retried with `let`/`const` as `var` when only Jint-tolerated redeclarations fail it.
 *  `text` is the source actually parsed (offsets match the input). */
export function parseLikeJint(text: string, options: acorn.Options): { program: acorn.Node; text: string } {
  try {
    return { program: acorn.parse(text, options), text };
  } catch (e: any) {
    if (!REDECLARED.test(String(e?.message))) throw e;
    const asVar = letConstAsVar(text);
    if (asVar === text) throw e;
    return { program: acorn.parse(asVar, options), text: asVar };
  }
}
