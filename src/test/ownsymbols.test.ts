import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionsAt, hoverAt, signatureHelpAt } from '../core/features';
import { renameEdits, renameTargetAt } from '../core/definition';
import { addedOptions, visibleNames } from '../core/ownsymbols';

const H = `Game.GUID = "A";
Game.ExecutableName = "a.exe";
Game.AddOption("Language", "The game's language.", "lang", ["English", "French"], "English");
var modes = ["Borderless", "Windowed"];
Game.AddOption("Window mode", "How each instance is shown.", "mode", modes);
// Copies the config for a player.
// Returns the copied path.
function copyCfg(player, folder) {
  var inner = 1;
  return folder;
}
/** Where the saves go. */
var savePath = "x";
Game.Play = function () {
  var here = 2;
  @
};
`;
const at = (code: string) => {
  const t = H.replace('@', code);
  const i = t.indexOf('|');
  return { text: t.slice(0, i) + t.slice(i + 1), offset: i };
};
const labels = (r: ReturnType<typeof completionsAt>) => (r ?? []).map((c) => c.label);

test('own names: suggested where they are visible, with keywords and globals; not where a name is declared or in strings', () => {
  let p = at('co|');
  let l = labels(completionsAt(p.text, p.offset));
  for (const n of ['copyCfg', 'savePath', 'here', 'Context', 'Math', 'parseInt', 'var', 'return']) assert.ok(l.includes(n), n);
  assert.ok(!l.includes('inner') && !l.includes('player'), 'names of another function are not visible here');
  const fn = completionsAt(p.text, p.offset)!.find((c) => c.label === 'copyCfg')!;
  assert.equal(fn.kind, 'function');
  assert.equal(fn.insertText, 'copyCfg($1)');
  assert.match(fn.documentation!, /Copies the config/);
  p = at('var x|');
  assert.equal(completionsAt(p.text, p.offset), undefined, 'naming a new variable');
  p = at('var s = "co|";');
  assert.equal(completionsAt(p.text, p.offset), undefined, 'in a string');
  p = at('// co|');
  assert.equal(completionsAt(p.text, p.offset), undefined, 'in a comment');
  p = at('var y = |');
  assert.equal(completionsAt(p.text, p.offset), undefined, 'nothing typed: only when asked');
  assert.ok(labels(completionsAt(p.text, p.offset, { explicit: true })).includes('savePath'), 'Ctrl+Space');
  p = at('co|');
  assert.ok(!labels(completionsAt(p.text, p.offset, { own: false })).includes('copyCfg'), 'VS Code has its own');
  // While the line doesn't parse yet.
  p = at('copyCfg(sav|');
  assert.ok(labels(completionsAt(p.text, p.offset)).includes('savePath'));
});

test('own names: hover shows the declaration and the comment above it; parameter hints for own functions', () => {
  const t = H.replace('@', 'copyCfg(1, 2);');
  let h = hoverAt(t, t.indexOf('copyCfg(1') + 2)!;
  assert.match(h.markdown, /function copyCfg\(player, folder\)/);
  assert.match(h.markdown, /Copies the config for a player\.\nReturns the copied path\./);
  h = hoverAt(t, t.indexOf('savePath') + 1)!;
  assert.match(h.markdown, /var savePath/);
  assert.match(h.markdown, /Where the saves go\./);
  assert.equal(hoverAt(t, t.indexOf('savePath') + 1, { own: false }), undefined);
  const p = at('copyCfg(Context.PlayerID, |');
  const s = signatureHelpAt(p.text, p.offset)!;
  assert.equal(s.signatures[0].label, 'copyCfg(player, folder)');
  assert.equal(s.activeParameter, 1);
  assert.match(s.signatures[0].documentation!, /Copies the config/);
});

test('Context.Options: the keys Game.AddOption adds, their choices, and hovers', () => {
  const opts = addedOptions(H);
  assert.deepEqual(opts.map((o) => [o.key, o.values?.join('/'), o.default]), [['lang', 'English/French', 'English'], ['mode', 'Borderless/Windowed', undefined]]);
  let p = at('var l = Context.Options["|"];');
  let c = completionsAt(p.text, p.offset)!;
  assert.deepEqual(c.map((x) => x.label), ['lang', 'mode']);
  assert.equal(c[0].insertText, 'lang');
  p = at('var l = Context.Options[|');
  assert.equal(completionsAt(p.text, p.offset)![1].insertText, '"mode"]');
  p = at('if (Context.Options["mode"] == "|") {}');
  c = completionsAt(p.text, p.offset)!;
  assert.deepEqual(c.map((x) => x.label), ['Borderless', 'Windowed']);
  const t = H.replace('@', 'var l = Context.Options["lang"];');
  const h = hoverAt(t, t.indexOf('"lang"]') + 2)!;
  assert.match(h.markdown, /\*\*Language\*\*: The game's language\./);
  assert.match(h.markdown, /Choices: `English`, `French`/);
});

test('rename: every use of the handler\'s own name, and refusals', () => {
  const t = H.replace('@', 'copyCfg(1, savePath);');
  const off = t.indexOf('savePath);') + 2;
  assert.deepEqual(renameTargetAt(t, off), { start: t.indexOf('savePath);'), end: t.indexOf('savePath);') + 8 });
  const r = renameEdits(t, off, 'saveDir');
  assert.ok('edits' in r);
  if ('edits' in r) assert.equal(r.edits.length, 2);
  assert.ok('error' in renameEdits(t, off, '2x'));
  assert.ok('error' in renameEdits(t, off, 'var'));
  assert.ok('error' in renameEdits(t, off, 'Context'));
  assert.equal(renameTargetAt(t, t.indexOf('GUID') + 1), undefined, 'Nucleus names are not ours to rename');
  assert.ok(visibleNames(t, t.indexOf('copyCfg(1')).some((n) => n.name === 'here'));
});

test('types of expressions: literals, string concatenation, call results, list items, numbers', () => {
  const members = (code: string) => {
    const t = `Game.Play = function () {\n  ${code}\n};\n`;
    const i = t.indexOf('|');
    return labels(completionsAt(t.slice(0, i) + t.slice(i + 1), i));
  };
  assert.ok(members('"a,b".|').includes('split'), 'a string literal');
  assert.ok(members('var f = Context.UserProfileConfigPath + "\\\\x.ini";\n  f.|').includes('replace'), 'a concatenation');
  assert.ok(members('Context.UserProfileConfigPath.replace("a", "b").|').includes('toLowerCase'), 'a call result');
  assert.ok(members('var parts = "a,b".split(",");\n  parts.|').includes('join'), 'split gives a list');
  assert.ok(members('var parts = "a,b".split(",");\n  parts[0].|').includes('trim'), 'an item of that list');
  assert.ok(members('var n = Context.PlayerID;\n  n.|').includes('toFixed'), 'a number');
  const t = 'Game.Play = function () {\n  var x = "a,b".split(",");\n};\n';
  assert.match(hoverAt(t, t.indexOf('split') + 1)!.markdown, /String\.split/);
  const p = 'Game.Play = function () {\n  "x".replace(\n};\n';
  assert.match(signatureHelpAt(p, p.indexOf('replace(') + 8)!.signatures[0].label, /String\.replace/);
});

test('Context.Options hover lists the keys the handler adds', () => {
  const t = H.replace('@', 'var l = Context.Options["lang"];');
  const h = hoverAt(t, t.indexOf('Options[') + 2)!;
  assert.match(h.markdown, /This handler adds:\*\*\n- `"lang"`: Language \(`English`, `French`\)\n- `"mode"`: Window mode/);
});

test('snippets: at the start of a statement, where they make sense, lint-clean', async () => {
  const { SNIPPETS } = await import('../core/snippets');
  const { lint } = await import('../core/lint');
  const { snippetToPlain } = await import('../lsp');
  let p = at('ini|');
  const c = completionsAt(p.text, p.offset)!.filter((x) => x.kind === 'snippet');
  assert.deepEqual(c.map((x) => x.label), ['iniset']);
  p = at('var x = ini|');
  assert.ok(!(completionsAt(p.text, p.offset) ?? []).some((x) => x.kind === 'snippet'), 'not inside an expression');
  const top = 'Game.GUID = "A";\nopt|\n';
  assert.deepEqual((completionsAt(top.replace('|', ''), top.indexOf('|'), { own: false }) ?? []).filter((x) => x.kind === 'snippet').map((x) => x.label), ['option'], 'top level; VS Code gets them too');
  for (const s of SNIPPETS) {
    const body = snippetToPlain(s.body);
    const code = s.where === 'top' ? `Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\n${body}\n` : `Game.GUID = "A";\nGame.GameName = "A";\nGame.ExecutableName = "a.exe";\nGame.AddOption("A", "", "key", ["Yes", "No"]);\nGame.Play = function () {\n${body}\n};\n`;
    const bad = lint(code).filter((d) => d.severity === 'error' || d.severity === 'warning');
    assert.deepEqual(bad.map((d) => `${d.rule}: ${d.message}`), [], s.prefix);
  }
  assert.match(snippetToPlain(SNIPPETS.find((s) => s.prefix === 'iniset')!.body), /\+ "\\\\config\.ini"/, 'a backslash written the JavaScript way');
});

test('parameter docs: JavaScript\'s from TypeScript, own functions from @param; own functions\' return types', () => {
  let p = at('"a".replace("b", |');
  let s = signatureHelpAt(p.text, p.offset)!;
  assert.match(s.signatures[0].parameterDocs![1]!, /text to replace/);
  const t = H.replace('// Copies the config for a player.\n// Returns the copied path.', '// Copies the config for a player.\n// @param player Which player (Context.PlayerID).\n// @param {string} folder - Where to copy it.');
  const i = t.indexOf('@\n') ;
  const code = t.slice(0, i) + 'copyCfg(1, ' + t.slice(i + 1);
  s = signatureHelpAt(code, i + 'copyCfg(1, '.length)!;
  assert.deepEqual(s.signatures[0].parameterDocs, ['Which player (Context.PlayerID).', 'Where to copy it.']);
  assert.equal(s.signatures[0].documentation, 'Copies the config for a player.');
  const r = 'function name() { return "x" + 1; }\nfunction n2() { return 2 * 3; }\nGame.Play = function () {\n  name().|\n};\n';
  const ri = r.indexOf('|');
  assert.ok(labels(completionsAt(r.slice(0, ri) + r.slice(ri + 1), ri)).includes('toUpperCase'));
  const h = hoverAt(r, r.indexOf('name()') + 1)!;
  assert.match(h.markdown, /function name\(\): string/);
});

test('an empty file offers the whole New Handler template', async () => {
  const { snippetToPlain } = await import('../lsp');
  const { lint } = await import('../core/lint');
  const c = completionsAt('hand', 4)!.find((x) => x.label === 'handler')!;
  assert.ok(c);
  const code = snippetToPlain(c.insertText!);
  assert.match(code, /Game\.GameName = "My Game";/);
  assert.deepEqual(lint(code).filter((d) => d.severity === 'error').map((d) => d.message), []);
  assert.ok(!(completionsAt('Game.GUID = "A";\nhand', 21) ?? []).some((x) => x.label === 'handler'), 'not in a file that has code');
});
