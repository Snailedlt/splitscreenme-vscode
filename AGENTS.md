# AGENTS.md

Guidance for AI coding agents working on **this repository**: the SplitScreen.Me VS Code extension, the `nucleus` CLI and the agent skill for Nucleus Co-op handlers.

If you are writing or fixing a *game handler* rather than this tooling, use the skill in `plugin/skills/nucleus-handler/` (start with its `SKILL.md`).

## Commands

```bash
npm ci
npm run build       # esbuild: dist/extension.js, dist/cli.js, AND the skill's scripts/nucleus.js + reference/api.md
npm test            # build + node:test (dist-test/*.test.js)
npm run typecheck   # tsc --noEmit
npm run package     # .vsix
npm run generate    # regenerate data/nucleus-api.json + types/nucleus.d.ts (needs ../splitscreenme-nucleus and ../splitscreenme-www clones)
claude plugin validate .   # validate .claude-plugin/marketplace.json and the plugin
```

Run `npm test` and `npm run typecheck` before finishing. Run `npm run build` after changing anything under `src/` and commit the regenerated skill files. A test fails when they are stale.

## Layout

- `src/core/`: pure logic, no `vscode` import, shared by the extension, the CLI and the skill.
  - `api.ts`: typed access to the generated API model, member resolution.
  - `lint.ts`: the linter (acorn AST). `RULES` is the rule registry.
  - `complete.ts`: text-based resolution for completion/hover/signature help (works on incomplete code).
  - `lookup.ts`: `nucleus api` lookup/search and the Markdown API reference.
  - `sim.ts`: "Try it", runs a handler per player emulating Jint. Shared with the testbench's browser workbench; keep it free of Node and DOM APIs.
  - `templates.ts`, `zip.ts`, `pkg.ts`, `hub.ts`: New Handler templates, .nc packages, agent-kit install, hub.splitscreen.me client.
- `src/extension.ts`, `src/commands.ts`, `src/tryit.ts`: VS Code glue (`tryit.ts` is the Try it panel).
- `src/sandbox.ts`: runs `core/sim.ts` for Node hosts inside a `vm` context. `scripts/build.mjs` bundles `src/sim-sandbox-entry.ts` into a string (`__SIM_SANDBOX__`) for it. Never call `simulate()` directly from Node code: handler code would get full Node access. `src/test/sim.test.ts` tries the known escapes.
- `src/cli.ts`: the `nucleus` CLI (`nucleus-lint` is an alias of `nucleus lint`).
- `src/test/`: tests. `vscode-mock.ts` stands in for the `vscode` module, via an esbuild alias in `scripts/build.mjs`.
- `scripts/generate-api.mjs`: builds the API model from the Nucleus C# sources + splitscreen.me docs.
- `plugin/`: the Claude Code plugin (`.claude-plugin/plugin.json`, `skills/nucleus-handler/`). `.claude-plugin/marketplace.json` at the root publishes it.

## Generated files: never edit by hand

`data/nucleus-api.json`, `types/nucleus.d.ts` (from `npm run generate`), and `plugin/skills/nucleus-handler/scripts/nucleus.js` and `plugin/skills/nucleus-handler/reference/api.md` (from `npm run build`). Fix the generator or the source instead.

## Facts the code relies on (verified, don't "fix" them away)

- Nucleus runs handlers with **Jint 2.11.58** (`Master/NucleusGaming/packages.config` in splitscreenme-nucleus). Its parser is ES5 plus `let`/`const`, which behave like `var` (the interpreter ignores the declaration kind), so redeclaring one with `var` loads fine (probe 112; `core/jsparse.ts`). Arrow functions, template literals, classes, spread and destructuring are rejected.
- Jint resolves .NET members with only the **first character** case-insensitive (`ObjectWrapper.EqualsIgnoreCasing`). Writes to unknown members are silently ignored outside strict mode.
- `Context` fields with the same name and type as `Game` fields are copied from `Game` (`GenericGameInfo.CreateContext`).
- `Game.Play` runs per instance (GenericGameHandler: three call sites). Default: after the instance is set up (Goldberg, XInput, ...) and before launch, and `Context.StartArguments` is read after it. `GamePlayBeforeGameSetup` runs it before the setup, `GamePlayAfterLaunch` after launch; both true means never. An exception in it (or in `OnFinishedSetup`) ends the session. `OnFinishedSetup`, `OnStop`, hotkey and Proto Input lock callbacks see the last player's `Context`. `SetupSse` is never invoked.
- Nucleus reads the handler line by line and executes `"\r\n" + line + "\r\n"` per line (GenericGameInfo's constructor), so a string continued with a backslash fails to parse. The testbench harness does the same.
- Jint 2.11.58 only matches overloads with exactly as many parameters as arguments: C# default values are ignored, so the generator marks no parameter optional (probe 110).
- The Hub install (DownloadPrompt.ExtractHandler; also HubWebView and drag & drop) scans raw lines, comments included, for `line.ToLower().StartsWith("game.executablename" / "game.gamename")`, takes the text between the first and last `"`, stops after two matches, and throws on a matched line with fewer than two `"`. `GameManager.AnyGame` (Search disks) reads `Game.ExecutableName` without a null check.
- `Hub.*` lines (`Hub.Handler.Id/Version`, `Hub.Maintainer.*`) are written by hub.splitscreen.me on upload. Authors don't add or edit them: the model marks them `internal`/`hidden` (no completion), and the linter must stay quiet on them.
- `.nc` packages: `handler.js` at the root, plus top-level folders that need **explicit directory entries**. `Game.Folder` is `handlers/<js file name without .js>/`.

## Changing lint rules

1. Add or change the rule in `RULES` and implement it in `Analyzer` (`src/core/lint.ts`).
2. Add tests in `src/test/lint.test.ts`, including a no-false-positive case.
3. Keep the rule list in sync: `package.json` → `contributes.configuration` → `splitscreenme.lint.rules.properties` (a test checks this), and the README table.
4. Check for false positives against real handlers: download some from the Hub (`node dist/cli.js hub fetch <id> --out /tmp/x`) and lint them. Published, working handlers should produce **no errors**.

## Conventions

- TypeScript strict; keep `src/core` free of `vscode` imports.
- Handler code you generate (templates, snippets, skill docs) must be ES5 and lint-clean. Tests lint the templates and every `js` block in the skill docs.
- The skill docs must only name real API members. A test resolves every `Game.*`/`Context.*` path mentioned in them.
