# SplitScreen.Me / Nucleus Co-op Handler Tools for VS Code

Tooling for writing [Nucleus Co-op](https://github.com/SplitScreen-Me/splitscreenme-nucleus) game handlers: the JavaScript files that tell Nucleus how to run several copies of a game side by side.

- **IntelliSense** for `Game`, `Game.Hook`, `Game.ProtoInput`, `Context`, `Player`, `PlayerList`, `ProtoInput`, `Hub` and the `Nucleus.*` enums. Completion lists every option Nucleus actually has, with types, defaults and docs. On an empty line, `Game.` completes the whole assignment, e.g. `Game.SymlinkGame = true|false;`.
- **Hover docs** and **signature help** for every `Context` method and its overloads.
- **Linting** for the mistakes that make handlers fail, often silently. See [Lint rules](#lint-rules).
- **Quick fixes**: did-you-mean for typos, `"true"` → `true`, template string → concatenation, wrap a value in an array, add missing required options, and more.
- **New Handler** wizard that generates a handler which passes the linter, with optional Proto Input, Goldberg, INI resolution and user-option sections.
- **Package for the Hub**: builds a `.nc` package laid out the way Nucleus' installer expects.
- **Install into Nucleus**: copies the handler and its asset folder into your Nucleus `handlers` folder.
- **Browse the Hub**: search the 600+ handlers on [hub.splitscreen.me](https://hub.splitscreen.me) and open any handler's source, which is handy for seeing how others solved a problem.
- **Type definitions** (`nucleus.d.ts`), so you can opt into full TypeScript checking with `// @ts-check`.
- **Snippets** (`nc-…`) for common tasks: INI/XML edits, text-file line replacement, registry edits, copying files from the handler folder, options, Goldberg and Proto Input.
- **`nucleus-lint` CLI** that runs the same checks in CI.

The API model is **generated from the Nucleus C# sources** (`GenericGameInfo`, `GameHookInfo`, `GenericContext`, `ProtoInputOptions`, …) and the [splitscreen.me docs](https://www.splitscreen.me/docs/handler-api), so it reflects what Nucleus really accepts rather than a hand-maintained list.

## Getting started

1. Install the extension. Until it is on the Marketplace, run `npm ci && npm run package`, then **Extensions: Install from VSIX…**.
2. Open the folder where you keep your handlers. Any `.js` file that sets `Game.GUID`, `Game.GameName`, `Game.ExecutableName` or `Game.Play`, or lives in a `handlers` folder, gets handler features. Other JavaScript files are left alone.
3. Run **Nucleus: New Handler…** from the Command Palette, or type `nc-handler` in an empty `.js` file.

### Commands

| Command | What it does |
| --- | --- |
| **Nucleus: New Handler…** | Asks for the game name, executable, Steam app ID and optional features, then writes a ready-to-edit handler. |
| **Nucleus: Package Handler for the Hub (.nc)** | Zips `Game.js` as `handler.js`, plus the `Game/` asset folder next to it. Also available in the Explorer context menu. |
| **Nucleus: Install Handler into Nucleus Co-op** | Copies `Game.js` and `Game/` into `<Nucleus>/handlers/`. Asks for your Nucleus folder once (`splitscreenme.nucleusPath`). |
| **Nucleus: Browse Handlers on the Hub…** | Searches hub.splitscreen.me; opens a handler's source or its Hub page. |
| **Nucleus: Set Up Type Definitions** | Writes `.vscode/nucleus.d.ts` and a `jsconfig.json` (ES5 lib), then hands completion over to the TypeScript service. Add `// @ts-check` to a handler for type errors. |
| **Nucleus: Lint All Handlers in Workspace** | Lints every handler in the workspace, not just open files. |
| **Nucleus: Open Documentation…** | Quick links to the handler API, guides, Proto Input, FAQ, Hub and PCGamingWiki. |

Package and Install both refuse to continue if the handler has lint errors, unless you confirm.

### Handler asset folder

Nucleus sets `Game.Folder` to `handlers/<handler file name without .js>/`. Keep files your handler copies (DLLs, configs, …) in a folder with the same name next to the handler:

```
MyGame.js
MyGame/
  steam_api64.dll
```

Package and Install both pick this folder up automatically.

## AI agents

The repo also ships an agent kit, so coding agents (Claude Code, Copilot, Codex, Cursor, …) write handlers that load and work, instead of guessing option names from memory.

- **The `nucleus-handler` skill** (`plugin/skills/nucleus-handler/`) contains:
  - the hard rules: ES5 only, real options only, `Context` only inside callbacks, Hub line format, …;
  - a research → reference handlers → scaffold → lint → test-plan workflow;
  - a symptom-to-option troubleshooting table;
  - lint-clean recipes;
  - a generated, greppable API reference.
- **A bundled CLI** at `plugin/skills/nucleus-handler/scripts/nucleus.js` is a single file with no dependencies; it needs Node. Agents can't see squiggles or hovers, so this gives them the same checks:

  | Command | What it does |
  | --- | --- |
  | `nucleus lint <file> --json` | Diagnostics and available fixes |
  | `nucleus api Game.KillMutex` / `nucleus api --search mutex` | The "hover": type, default and docs |
  | `nucleus hub search <game>` / `nucleus hub fetch <id>` | Study how existing handlers solved the same problem |
  | `nucleus new …` / `nucleus package …` | Scaffold a handler / build the `.nc` package |

### Claude Code

```
/plugin marketplace add SplitScreen-Me/splitscreenme-vscode
/plugin install nucleus-coop@splitscreenme
```

The skill loads automatically when you ask about Nucleus handlers.

### Any agent, in your handler folder

Run **Nucleus: Set Up AI Agent Support** in VS Code, or:

```bash
node path/to/nucleus.js init-agent .
```

This writes three things:
- `.claude/skills/nucleus-handler/`: the skill and the CLI;
- a marked section in `AGENTS.md`, which most agents read;
- `CLAUDE.md`, containing `@AGENTS.md`.

Existing `AGENTS.md`/`CLAUDE.md` content is kept, and re-running only refreshes the kit.

Agents can't run Nucleus or the game, so the skill tells them to finish with a concrete test plan and to ask for Nucleus' `debug-log.txt`.

Contributors' agents: see [AGENTS.md](AGENTS.md).

## Lint rules

| Rule | Default | What it catches |
| --- | --- | --- |
| `syntax-error` | error | The file does not parse. |
| `es5-only` | error | Syntax Jint 2.x cannot parse: arrow functions, template strings, classes, spread/rest, destructuring, default parameters, `for…of`, `?.`, `??`, `**`, trailing commas in calls, `const` in a `for` head, … The handler would not load. Fixes are offered where mechanical. |
| `let-const-semantics` | info | `let`/`const` *are* accepted by Jint 2.x, but behave exactly like `var`: function-scoped and reassignable. |
| `unknown-member` | warning | `Game.IgnoreWindowBordercheck`, `Context.PLayerID`, `player.ProtoController5`, … Jint silently ignores writes to unknown properties of Nucleus objects, and reads return `undefined`. With `"use strict"`, writes throw instead. Includes a did-you-mean fix. |
| `readonly-member` | warning | Assigning computed values such as `Context.Width`, or methods. |
| `type-mismatch` | warning | `Game.KillMutex = "x"` (needs an array), `Game.HandlerInterval = "100"`, a non-function `Game.Play`, the wrong `Nucleus.*` enum, … `"true"`/`"false"` strings are only `info`, because .NET parses them. |
| `wrong-arguments` | warning | No overload of a `Context`/`ProtoInput` method or `new Nucleus.IniSaveInfo` takes that many arguments. This fails at runtime with "No public methods with the specified arguments were found". |
| `missing-required` | error | `Game.GUID`, `Game.GameName` or `Game.ExecutableName` is missing or empty (`ExecutableNames` also satisfies the executable). |
| `callback-only-global` | error | `Context`, `Player`, `PlayerList`, `Handler` or `ProtoInput` used at the top level. They only exist inside callbacks such as `Game.Play`. |
| `duplicate-assignment` | warning | The same option is set twice at the top level, so the first value is dead. |
| `hub-install-parse` | warning | When installing from the Hub, Nucleus reads `Game.GameName` and `Game.ExecutableName` by finding a line that *starts with* them and taking the text between the first and last `"`. Indented lines, single quotes, extra quotes on the line (for example in a comment), or `Game.ExecutableNames` appearing first all break the install. |
| `guid-characters` | info | `Game.GUID` becomes a folder name, so use letters, digits and spaces. |
| `deprecated` | hint | Options the docs mark deprecated, such as the pre-Proto Input multi-keyboard settings. |

Change severities with the `splitscreenme.lint.rules` setting, e.g. `{ "deprecated": "off" }`, or with comments:

```js
// nucleus-lint-disable-next-line unknown-member
Game.SomethingNucleusWillAddLater = true;
Game.Other = 1; // nucleus-lint-disable-line
/* nucleus-lint-disable deprecated */   // whole file
```

### How the rules were validated

The linter runs over the 150 most-downloaded handlers on the Hub with **no errors**. The warnings it reports there are real defects: typos such as `Context.PLayerID` and `Game.IgnoreWindowBordercheck`, options that don't exist (`Game.ForceFinishOnPlay`, `Player.ProtoController5`–`17`), and a find-and-replace accident (`Game.PauseEscapeTheBackroomsweenStarts`). The `let`/`const` and unknown-property behaviours were confirmed in the Jint 2.11 parser and interop sources.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `splitscreenme.detection` | `auto` | `auto`: handler-looking files and files in a `handlers` folder. `always`: every `.js` file. `off`: disable. |
| `splitscreenme.lint.enable` | `true` | Report problems. |
| `splitscreenme.lint.rules` | `{}` | Per-rule severity: `error`, `warning`, `info`, `hint` or `off`. |
| `splitscreenme.completion.enable` | `true` | The extension's completion/hover/signature help. Turned off by **Set Up Type Definitions**, because TypeScript then provides them. |
| `splitscreenme.nucleusPath` | | Your Nucleus Co-op folder, used by Install. |

## Command-line linter

```bash
npm ci && npm run build
node dist/cli.js path/to/handlers   # or `nucleus-lint` once the package is installed
```

It also has `api`, `hub`, `new`, `package` and `init-agent` subcommands (`node dist/cli.js --help`). Lint options: `--json`, `--rule unknown-member=error`, `--quiet` (errors only), `--verbose` (include hints), `--all` (lint every `.js`, not just handler-looking ones), `--list-rules`. The exit code is 1 when there are errors.

## Development

```bash
npm ci
npm run build      # bundle dist/extension.js and dist/cli.js with esbuild
npm test           # node:test suite (linter, completion, zip/packaging, templates, extension glue)
npm run typecheck
npm run package    # build a .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

### Regenerating the API model

`data/nucleus-api.json` and `types/nucleus.d.ts` are generated. Do not edit them by hand. To update them after Nucleus changes:

```bash
git clone --depth 1 https://github.com/SplitScreen-Me/splitscreenme-nucleus ../splitscreenme-nucleus
git clone --depth 1 https://github.com/SplitScreen-Me/splitscreenme-www ../splitscreenme-www
npm run generate   # or: node scripts/generate-api.mjs --nucleus <path> --www <path>
```

The generator parses the public members of the C# classes exposed to handlers, with their types and defaults. It then merges descriptions from `docs/handler-api.mdx`, `docs/create-handlers.md`, `docs/protoinput.md` and `MasterHandler.js`. A weekly workflow (`.github/workflows/update-api.yml`) does this automatically and opens a PR when anything changes.

### Layout

```
src/core/api.ts         typed access to the API model, member resolution, suggestions
src/core/lint.ts        the linter (acorn AST, no VS Code dependency)
src/core/complete.ts    text-based resolution for completion/hover/signature help
src/core/templates.ts   New Handler templates
src/core/zip.ts         dependency-free zip reader/writer for .nc packages
src/core/hub.ts         hub.splitscreen.me client
src/extension.ts        VS Code providers
src/commands.ts         VS Code commands
src/cli.ts              nucleus-lint
scripts/generate-api.mjs
```

## Links

[Handler API](https://www.splitscreen.me/docs/handler-api) · [Creating handlers](https://www.splitscreen.me/docs/create-handlers) · [Proto Input](https://www.splitscreen.me/docs/protoinput) · [Hub](https://hub.splitscreen.me) · [Nucleus Co-op](https://github.com/SplitScreen-Me/splitscreenme-nucleus) · [r/nucleuscoop](https://www.reddit.com/r/nucleuscoop/)
