// One page per check: a plain title, what it means and why, a wrong and a right example, and how to fix it.
// The workbench site builds a page from each (…/rules/<id>/), the editors link to it from every problem
// (ruleUrl), and src/test/ruledocs.test.ts lints every example: `bad` must trigger its rule, `good` must not.
// Examples are handler code (ES5); unless `whole` is set they are checked with Game.GUID, GameName and
// ExecutableName in front of them, so they can stay short.
import { RULES } from './lint';
import { JS_RULES } from './jsrules';

export interface RuleDoc {
  /** The rule's title, in plain words. */
  title: string;
  /** What happens in Nucleus, and why it matters. */
  why: string;
  bad?: string;
  good?: string;
  /** How to fix it (one or two sentences); the editors' quick fix, when there is one. */
  fix: string;
  /** The examples are a whole handler (checked as written). */
  whole?: boolean;
  /** Why there is no example (it needs the Hub, or a file's bytes). */
  noExample?: string;
}

/** Where the pages live: the workbench site (GitHub Pages). */
export const RULES_BASE = 'https://snailedlt.github.io/nucleuscoop-handler-testbench/rules/';
/** A check's page; `ref` tags the link with the tool it was followed from, for the anonymous visit counts. */
export const ruleUrl = (id: string, ref?: string) => `${RULES_BASE}${encodeURIComponent(id)}/${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;

const NUCLEUS: Record<string, RuleDoc> = {
  'syntax-error': {
    title: 'Code that can\'t be read',
    why: 'The handler isn\'t valid JavaScript, so Nucleus can\'t load it at all: the game disappears from its list. Often a missing bracket, quote or comma.',
    bad: 'Game.Play = function () {\n  Context.StartArguments = "-windowed";\n',
    good: 'Game.Play = function () {\n  Context.StartArguments = "-windowed";\n};',
    fix: 'Look at the line the problem points to and the line before it: close the bracket or quote that is still open.',
  },
  'es5-only': {
    title: 'Newer JavaScript than Nucleus understands',
    why: 'Nucleus runs handlers with Jint 2.11.58, which only reads ES5 (plus `let` and `const`). Arrow functions, template strings, classes, spread and destructuring stop the handler from loading.',
    bad: 'Game.Play = function () {\n  var args = `-width ${Context.Width}`;\n};',
    good: 'Game.Play = function () {\n  var args = "-width " + Context.Width;\n};',
    fix: 'Write it the ES5 way: `function () {}` instead of `() =>`, `"a" + b` instead of a template string. The quick fix rewrites most of them.',
  },
  'let-const-semantics': {
    title: '`let` and `const` work like `var` here',
    why: 'Jint 2.x accepts `let` and `const` but treats them exactly like `var`: they belong to the whole function, not the block, and a `const` can be changed. Code that relies on block scope behaves differently in Nucleus.',
    bad: 'Game.Play = function () {\n  for (let i = 0; i < 2; i++) {\n    const name = "p" + i;\n  }\n};',
    good: 'Game.Play = function () {\n  for (var i = 0; i < 2; i++) {\n    var name = "p" + i;\n  }\n};',
    fix: 'Use `var`, so the code says what Nucleus does.',
  },
  'unknown-member': {
    title: 'A name Nucleus doesn\'t have',
    why: 'This option or method doesn\'t exist on that Nucleus object, usually a typo. Setting it does nothing (Jint ignores it without an error), reading it gives `undefined`, and calling it stops the handler.',
    bad: 'Game.KillMutexs = ["Mutex"];',
    good: 'Game.KillMutex = ["Mutex"];',
    fix: 'The problem suggests the closest real name; pick it from the quick fix, or look the option up in the docs.',
  },
  'readonly-member': {
    title: 'A value Nucleus sets itself',
    why: 'Nucleus computes this value (a player\'s index, the screen size…); setting it from the handler is ignored.',
    bad: 'Game.Play = function () {\n  Context.Width = 1280;\n};',
    good: 'Game.Play = function () {\n  var width = Context.Width;\n};',
    fix: 'Read it instead of setting it, or store what you need in your own variable.',
  },
  'type-mismatch': {
    title: 'The wrong kind of value',
    why: 'Nucleus expects another type here (a number, true/false, a list…). Some values are converted, others make Nucleus fail to load the handler or ignore the option.',
    bad: 'Game.MaxPlayers = "4";',
    good: 'Game.MaxPlayers = 4;',
    fix: 'Write the value the way the option\'s docs show it: numbers and true/false without quotes, lists in `[ ]`. The quick fix converts it when it can.',
  },
  'value-format': {
    title: 'The value has the wrong form',
    why: 'Some text options have a fixed form (CustomHotkeys, CopyFoldersTo, SteamlessPatch, BinariesFolder…). Written another way, Nucleus fails during setup or the option does nothing.',
    bad: 'Game.CustomHotkeys = ["true|Toggle HUD|H"];',
    good: 'Game.CustomHotkeys = ["true|Toggle HUD|Ctrl|H"];\nGame.OnCustomHotKey_1 = function () {\n};',
    fix: 'Use the form from the option\'s docs (a hotkey is "on|name|modifier|key"); the quick fix rewrites the common cases.',
  },
  'wrong-arguments': {
    title: 'A call with the wrong number of values',
    why: 'Jint only finds a Nucleus method when you pass exactly as many values as one of its versions takes (default values in C# don\'t count). Otherwise it throws "No public methods with the specified arguments were found" and the session ends.',
    bad: 'Game.Play = function () {\n  var folder = Context.GetFolder();\n};',
    good: 'Game.Play = function () {\n  var folder = Context.GetFolder(Nucleus.Folder.InstancedGameFolder);\n};',
    fix: 'Check the signature in the hover or the docs and pass every value, even ones that look optional.',
  },
  'missing-required': {
    title: 'A required option is missing',
    why: 'Nucleus needs Game.GUID, Game.GameName and Game.ExecutableName to load a handler; without one, the game doesn\'t appear.',
    bad: 'Game.GameName = "My Game";\nGame.ExecutableName = "game.exe";',
    good: 'Game.GUID = "My Game";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";',
    fix: 'Add the missing line at the top of the handler.',
    whole: true,
  },
  'replaces-nucleus-object': {
    title: 'Game or Context replaced',
    why: 'Nucleus gives the handler its own Game and Context and reads the settings from those. A variable, parameter or function of the same name puts a new object in their place, so Nucleus never sees what is set on it: with `var Game = {}` at the top it finds no Game.Play, and a `var Context` in Game.Play loses StartArguments.',
    bad: 'Game.Play = function () {\n  var Context = {};\n  Context.StartArguments = "-windowed";\n};',
    good: 'Game.Play = function () {\n  Context.StartArguments = "-windowed";\n};',
    fix: 'Remove the declaration, or give your own variable another name.',
  },
  'callback-only-global': {
    title: 'Code in the wrong place',
    why: 'Context, Player, PlayerList, Handler and ProtoInput only exist while Nucleus runs a callback such as Game.Play. Used at the top of the handler, they make it fail to load.',
    bad: 'var width = Context.Width;',
    good: 'Game.Play = function () {\n  var width = Context.Width;\n};',
    fix: 'Move the line into Game.Play (or the callback it belongs to).',
  },
  'too-late': {
    title: 'An option set too late',
    why: 'Nucleus reads some options (GUID, GameName, MaxPlayers, AddOption…) before any player starts. Set inside Game.Play or another function, they have no effect.',
    bad: 'Game.Play = function () {\n  Game.MaxPlayers = 4;\n};',
    good: 'Game.MaxPlayers = 4;\nGame.Play = function () {\n};',
    fix: 'Move the line to the top level of the handler.',
  },
  'duplicate-assignment': {
    title: 'The same option set twice',
    why: 'Only the last value counts, so the first line does nothing. Usually a leftover from copying another handler.',
    bad: 'Game.MaxPlayers = 4;\nGame.MaxPlayers = 8;',
    good: 'Game.MaxPlayers = 8;',
    fix: 'Keep the value you mean and delete the other line.',
  },
  'hub-install-parse': {
    title: 'A line the Hub install misreads',
    why: 'When a handler is installed from the Hub, Nucleus finds Game.GameName and Game.ExecutableName by reading lines that start with them and taking the text between the first and last double quote. A comment, a second string or single quotes on that line break the install.',
    bad: 'Game.GUID = "My Game";\nGame.GameName = \'My Game\';\nGame.ExecutableName = "game.exe";',
    good: 'Game.GUID = "My Game";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";',
    fix: 'Keep each of these lines simple: the name in double quotes, nothing else on the line.',
    whole: true,
  },
  'guid-characters': {
    title: 'Characters a folder name can\'t have',
    why: 'Game.GUID becomes a folder name in Nucleus. Characters like `: * ? " < > |` don\'t work in Windows folder names.',
    bad: 'Game.GUID = "My Game: Deluxe";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";',
    good: 'Game.GUID = "My Game Deluxe";\nGame.GameName = "My Game";\nGame.ExecutableName = "game.exe";',
    fix: 'Use letters, digits, spaces, dots, dashes and underscores. Change it before publishing: a later change drops the game from users\' lists.',
    whole: true,
  },
  'protoinput-legacy-hooks': {
    title: 'Old input options fighting Proto Input',
    why: 'With Proto Input and several keyboards and mice, the old input options (Game.HookGetCursorPos, Game.SendNormalMouseInput…) must be off: several default to on and get in Proto Input\'s way.',
    bad: 'Game.ProtoInput.InjectStartup = true;\nGame.SupportsMultipleKeyboardsAndMice = true;\nGame.HookGetCursorPos = true;',
    good: 'Game.ProtoInput.InjectStartup = true;\nGame.SupportsMultipleKeyboardsAndMice = true;\nGame.HookGetCursorPos = false;\nGame.HookSetCursorPos = false;\nGame.HookGetKeyState = false;\nGame.HookGetAsyncKeyState = false;\nGame.HookGetKeyboardState = false;\nGame.HookMouseVisibility = false;\nGame.SendNormalMouseInput = false;\nGame.SendNormalKeyboardInput = false;\nGame.DrawFakeMouseCursor = false;',
    fix: 'Set the old options it lists to false; the quick fix adds the lines.',
  },
  'protoinput-inactive': {
    title: 'Proto Input options that never start',
    why: 'Proto Input only starts with Game.ProtoInput.InjectStartup or one of the InjectRuntime_… options. Without one, every other Game.ProtoInput option is ignored.',
    bad: 'Game.ProtoInput.FocusHooksHookGetFocus = true;',
    good: 'Game.ProtoInput.InjectStartup = true;\nGame.ProtoInput.FocusHooksHookGetFocus = true;',
    fix: 'Turn on the way Proto Input should start (usually Game.ProtoInput.InjectStartup = true), or remove the unused options.',
  },
  'protoinput-needs-hook': {
    title: 'A message filter without its hook',
    why: 'Game.ProtoInput.BlockedMessages and the message filters only act inside Proto Input\'s message filter hook; without that hook they do nothing.',
    bad: 'Game.ProtoInput.InjectStartup = true;\nGame.ProtoInput.BlockedMessages = [0x0008];',
    good: 'Game.ProtoInput.InjectStartup = true;\nGame.ProtoInput.MessageFilterHook = true;\nGame.ProtoInput.BlockedMessages = [0x0008];',
    fix: 'Add `Game.ProtoInput.MessageFilterHook = true;` (the quick fix does).',
  },
  'blocked-message': {
    title: 'A message Proto Input can\'t block',
    why: 'Proto Input looks blocked messages up in its own list. A number that isn\'t in it blocks a different message, or nothing.',
    bad: 'Game.ProtoInput.InjectStartup = true;\nGame.ProtoInput.MessageFilterHook = true;\nGame.ProtoInput.BlockedMessages = [0x0009];',
    good: 'Game.ProtoInput.InjectStartup = true;\nGame.ProtoInput.MessageFilterHook = true;\nGame.ProtoInput.BlockedMessages = [0x0008];',
    fix: 'Pick the message by name from the list (hover a number to see which message it is).',
  },
  'needs-option': {
    title: 'An option that needs another one',
    why: 'Nucleus only reads some options when another is on: FakeFocusInterval needs FakeFocus, SteamlessArgs needs UseSteamless, and so on. Alone, it does nothing.',
    bad: 'Game.FakeFocusInterval = 1000;',
    good: 'Game.FakeFocus = true;\nGame.FakeFocusInterval = 1000;',
    fix: 'Turn on the option it names (the quick fix adds it), or remove the line.',
  },
  'guid-changed': {
    title: 'A GUID that differs from the Hub',
    why: 'Nucleus keys a user\'s game, profiles, cover and content folder by Game.GUID. Updating a published handler with another GUID drops the game from their list.',
    noExample: 'This check compares with the version on the Hub, so it only appears for handlers that have a Hub.Handler.Id line.',
    fix: 'Keep the GUID the Hub version has.',
  },
  'file-encoding': {
    title: 'A file that isn\'t UTF-8',
    why: 'Nucleus reads handlers as UTF-8. A file saved as ANSI / Windows-1252 turns accented letters into � in names, paths and messages.',
    noExample: 'This check looks at the file\'s bytes, so it can\'t be shown as text.',
    fix: 'Save the file as UTF-8 (in Notepad++: Encoding › Convert to UTF-8; in VS Code: the encoding in the status bar).',
  },
  'undefined-name': {
    title: 'A name that doesn\'t exist',
    why: 'Nothing declares this name and Nucleus doesn\'t provide it: a typo, a stray word or a variable from another handler. Reading it throws "<name> is not defined": at the top level the handler fails to load, in Game.Play the session ends.',
    bad: 'Game.Play = function () {\n  var args = "-w " + widht;\n};',
    good: 'Game.Play = function () {\n  var width = Context.Width;\n  var args = "-w " + width;\n};',
    fix: 'Fix the spelling (the problem suggests the closest name) or declare the variable first.',
  },
  'missing-builtin': {
    title: 'A JavaScript function Nucleus doesn\'t have',
    why: 'Jint 2.x only has ES5\'s built-in functions. Newer ones such as `"…".includes()`, `[].find()`, `Object.assign` or `Array.from` don\'t exist, so calling one ends the session.',
    bad: 'Game.Play = function () {\n  var copy = Array.from([1, 2]);\n};',
    good: 'Game.Play = function () {\n  var copy = [1, 2].slice();\n};',
    fix: 'Use the ES5 way: `indexOf(…) !== -1` for includes, a loop for find, `slice()` to copy a list. The quick fix rewrites the common ones.',
  },
  'callback-misuse': {
    title: 'A callback Nucleus never runs',
    why: 'Some callbacks never run (Game.SetupSse), or run under conditions that can\'t happen (Game.Play with both GamePlayBeforeGameSetup and GamePlayAfterLaunch on).',
    bad: 'Game.SetupSse = function () {\n};',
    good: 'Game.Play = function () {\n};',
    fix: 'Move the code to a callback Nucleus runs (usually Game.Play), or remove it.',
  },
  deprecated: {
    title: 'A deprecated option',
    why: 'Nucleus still reads this option but it has a replacement, or it is kept only for old handlers.',
    fix: 'The hover names what to use instead. Setting it to false is fine.',
    noExample: 'Which options are deprecated follows Nucleus\' own list; the hover on each says what replaces it.',
  },
};

// General JavaScript mistakes (ESLint's rules): their titles and why come from core/jsrules.ts; the examples are here.
const JS_EXAMPLES: Record<string, { bad: string; good: string; fix: string }> = {
  'no-cond-assign': { bad: 'var a = 1;\nif (a = 2) {\n}', good: 'var a = 1;\nif (a == 2) {\n}', fix: 'Use `==` (or `===`) to compare.' },
  'no-constant-condition': { bad: 'if (true) {\n}', good: 'var on = Game.MaxPlayers > 2;\nif (on) {\n}', fix: 'Test something that changes, or remove the condition.' },
  'no-dupe-keys': { bad: 'var o = { a: 1, a: 2 };', good: 'var o = { a: 1, b: 2 };', fix: 'Give each key its own name, or keep one.' },
  'no-duplicate-case': { bad: 'var m = "a";\nswitch (m) {\n  case "a": break;\n  case "a": break;\n}', good: 'var m = "a";\nswitch (m) {\n  case "a": break;\n  case "b": break;\n}', fix: 'Remove the second case or test another value.' },
  'no-dupe-else-if': { bad: 'var a = 1;\nif (a == 1) {\n} else if (a == 1) {\n}', good: 'var a = 1;\nif (a == 1) {\n} else if (a == 2) {\n}', fix: 'Test something the earlier branch didn\'t.' },
  'no-dupe-args': { bad: 'function f(a, a) {\n  return a;\n}\nf(1, 2);', good: 'function f(a, b) {\n  return a + b;\n}\nf(1, 2);', fix: 'Rename one of the parameters.' },
  'use-isnan': { bad: 'var n = Number("x");\nif (n == NaN) {\n}', good: 'var n = Number("x");\nif (isNaN(n)) {\n}', fix: 'Use `isNaN(x)`.' },
  'valid-typeof': { bad: 'var a = 1;\nif (typeof a == "numbr") {\n}', good: 'var a = 1;\nif (typeof a == "number") {\n}', fix: 'Fix the spelling of the type name.' },
  'no-unreachable': { bad: 'function f() {\n  return 1;\n  var x = 2;\n}\nf();', good: 'function f() {\n  var x = 2;\n  return x;\n}\nf();', fix: 'Move the code before the `return`, or remove it.' },
  'no-unused-expressions': { bad: 'var a = 1;\na == 2;', good: 'var a = 1;\na = 2;', fix: 'Assign or call what you meant; check for a line split in two.' },
  'no-self-assign': { bad: 'var a = 1;\na = a;', good: 'var a = 1;\nvar b = a;', fix: 'Assign the value you meant.' },
  'no-self-compare': { bad: 'var a = 1;\nif (a == a) {\n}', good: 'var a = 1;\nvar b = 2;\nif (a == b) {\n}', fix: 'Compare with the other value you meant.' },
  'no-unsafe-negation': { bad: 'var o = {};\nif (!"a" in o) {\n}', good: 'var o = {};\nif (!("a" in o)) {\n}', fix: 'Put the brackets around the whole test: `!(a in b)`.' },
  'no-compare-neg-zero': { bad: 'var x = 0;\nif (x === -0) {\n}', good: 'var x = 0;\nif (x === 0) {\n}', fix: 'Compare with 0, or use `1 / x === -Infinity` if the sign matters.' },
  'no-invalid-regexp': { bad: 'var r = new RegExp("[");', good: 'var r = new RegExp("\\\\[");', fix: 'Escape the special character, or close the bracket.' },
  'no-empty-character-class': { bad: 'var r = /a[]/;', good: 'var r = /a[b]/;', fix: 'Put the characters to match inside `[ ]`.' },
  'no-control-regex': { bad: 'var r = /\\x0C/;', good: 'var r = /\\f/;', fix: 'Write the character you meant, usually an escaped backslash.' },
  'no-sparse-arrays': { bad: 'var list = [1, , 2];', good: 'var list = [1, 2];', fix: 'Remove the extra comma.' },
  'no-useless-escape': { bad: 'var p = "C:\\Games";', good: 'var p = "C:\\\\Games";', fix: 'In a Windows path write two backslashes.' },
  'no-octal-escape': { bad: 'var p = "C:\\45";', good: 'var p = "C:\\\\45";', fix: 'Write two backslashes before the number.' },
  'no-loss-of-precision': { bad: 'var n = 9007199254740993;', good: 'var n = "9007199254740993";', fix: 'Keep a value that big as text.' },
  'for-direction': { bad: 'for (var i = 0; i < 4; i--) {\n}', good: 'for (var i = 0; i < 4; i++) {\n}', fix: 'Count towards the end condition (`i++` with `<`).' },
  'no-unsafe-finally': { bad: 'function f() {\n  try {\n    return 1;\n  } finally {\n    return 2;\n  }\n}\nf();', good: 'function f() {\n  try {\n    return 1;\n  } finally {\n    Context.StartArguments = "";\n  }\n}', fix: 'Don\'t `return` or `throw` in `finally`.' },
  'no-func-assign': { bad: 'function f() {\n}\nf = 1;', good: 'function f() {\n}\nvar g = 1;', fix: 'Use another name for the value.' },
  'no-ex-assign': { bad: 'try {\n  Game.MaxPlayers = 4;\n} catch (e) {\n  e = null;\n}', good: 'try {\n  Game.MaxPlayers = 4;\n} catch (e) {\n  var err = e;\n}', fix: 'Copy the error to a new variable instead.' },
  'no-obj-calls': { bad: 'var m = Math();', good: 'var m = Math.max(1, 2);', fix: 'Call one of its functions: `Math.max(…)`, `JSON.parse(…)`.' },
  'no-shadow-restricted-names': { bad: 'var undefined = 1;', good: 'var nothing = 1;', fix: 'Pick another name.' },
};

const JS: Record<string, RuleDoc> = Object.fromEntries(
  Object.entries(JS_RULES as Record<string, { title: string; why: string }>).map(([id, r]) => {
    const ex = JS_EXAMPLES[id];
    return [id, { title: r.title, why: r.why, fix: ex?.fix ?? 'See the explanation above.', ...(ex ? { bad: ex.bad, good: ex.good } : { noExample: 'A general JavaScript mistake; see the explanation above.' }) }];
  }),
);

export const RULE_DOCS: Record<string, RuleDoc> = { ...NUCLEUS, ...JS };

/** Every rule the linter has, with its doc (the test checks none is missing). */
export const ruleIds = () => Object.keys(RULES);
