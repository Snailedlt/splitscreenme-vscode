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
npm run generate    # regenerate data/nucleus-api.json + types/nucleus.d.ts (needs ../splitscreenme-nucleus and ../splitscreenme-www clones; the Sync workflow does this daily by PR)
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
- `src/hubcache.ts`: every Hub read goes through it. The list comes from the testbench's daily index (`data` branch, `hub-index.json`), revalidated hourly by ETag; the Hub API only as a fallback; packages once per version. Keep it that way: don't add direct Hub API calls.
- `src/mcp.ts`: `nucleus mcp`, the same tools as an MCP server (stdio JSON-RPC). The extension registers it for VS Code's agents. `src/simformat.ts` is the simulation text shared by both.
- `src/test/`: tests. `vscode-mock.ts` stands in for the `vscode` module, via an esbuild alias in `scripts/build.mjs`.
- `scripts/generate-api.mjs`: builds the API model from the Nucleus C# sources + splitscreen.me docs.
- `plugin/`: the Claude Code plugin (`.claude-plugin/plugin.json`, `skills/nucleus-handler/`). `.claude-plugin/marketplace.json` at the root publishes it.

## Generated files: never edit by hand

`data/nucleus-api.json`, `types/nucleus.d.ts` (from `npm run generate`), and `plugin/skills/nucleus-handler/scripts/nucleus.js` and `plugin/skills/nucleus-handler/reference/api.md` (from `npm run build`). Fix the generator or the source instead.

## Facts the code relies on (verified, don't "fix" them away)

- Nucleus runs handlers with **Jint 2.11.58** (`Master/NucleusGaming/packages.config` in splitscreenme-nucleus). Its parser is ES5 plus `let`/`const`, which behave like `var` (the interpreter ignores the declaration kind), so redeclaring one with `var` loads fine (probe 112; `core/jsparse.ts`). Arrow functions, template literals, classes, spread and destructuring are rejected.
- Jint resolves .NET members with only the **first character** case-insensitive (`ObjectWrapper.EqualsIgnoreCasing`). Writes to unknown members are silently ignored outside strict mode.
- .NET is reachable from handlers (`new Engine(cfg => cfg.AllowClr(assembly))`, GenericGameInfo.cs), so `System.IO.File.Copy` etc. work. `src/core/dotnet.ts` lists the `System.*` members handlers use, as open objects (unlisted names allowed unless they look like a typo). Calling a member that doesn't exist throws `Object has no method 'X'` (probe 116), reading one gives `undefined` (117), and `params` overloads such as `Path.Combine(params string[])` are expanded (114, 115).
- `Context` fields with the same name and type as `Game` fields are copied from `Game` (`GenericGameInfo.CreateContext`).
- `Game.Play` runs per instance (GenericGameHandler: three call sites). Default: after the instance is set up (Goldberg, XInput, ...) and before launch, and `Context.StartArguments` is read after it. `GamePlayBeforeGameSetup` runs it before the setup, `GamePlayAfterLaunch` after launch; both true means never. An exception in it (or in `OnFinishedSetup`) ends the session. `OnFinishedSetup`, `OnStop`, hotkey and Proto Input lock callbacks see the last player's `Context`. `SetupSse` is never invoked.
- Nucleus reads the handler line by line and executes `"\r\n" + line + "\r\n"` per line (GenericGameInfo's constructor), so a string continued with a backslash fails to parse. The testbench harness does the same.
- Jint 2.11.58 only matches overloads with exactly as many parameters as arguments: C# default values are ignored, so the generator marks no parameter optional (probe 110).
- The Hub install (DownloadPrompt.ExtractHandler; also HubWebView and drag & drop) scans raw lines, comments included, for `line.ToLower().StartsWith("game.executablename" / "game.gamename")`, takes the text between the first and last `"`, stops after two matches, and throws on a matched line with fewer than two `"`. `GameManager.AnyGame` (Search disks) reads `Game.ExecutableName` without a null check.
- `Hub.*` lines (`Hub.Handler.Id/Version`, `Hub.Maintainer.*`) are written by hub.splitscreen.me on upload. Authors don't add or edit them: the model marks them `internal`/`hidden` (no completion), and the linter must stay quiet on them.
- `.nc` packages: `handler.js` at the root, plus top-level folders that need **explicit directory entries**. `Game.Folder` is `handlers/<js file name without .js>/`. A Hub install (DownloadPrompt.ExtractHandler) names that file after `Game.GameName` (raw line value, minus `/ : * ? " < > |`; a backslash stays and breaks the install) and merges the contents of every top-level folder of the package into `handlers/<GameName>/`; other files at the zip root are dropped. A saved profile gives every `Game.AddOption` value back as text (`GameProfile.LoadGameProfile`: `JToken.ToString()`), and Nucleus reads handlers as UTF-8. The simulator uses the Hub install's folder name.

## Changing lint rules

1. Add or change the rule in `RULES` and implement it in `Analyzer` (`src/core/lint.ts`).
2. Add tests in `src/test/lint.test.ts`, including a no-false-positive case.
3. Keep the rule list in sync: `package.json` → `contributes.configuration` → `splitscreenme.lint.rules.properties` (a test checks this), and the README table.
4. Check for false positives against real handlers: download some from the Hub (`node dist/cli.js hub fetch <id> --out /tmp/x`) and lint them. Published, working handlers should produce **no errors**.

## Release notes

Every user-visible change adds a line under `## Unreleased` in `CHANGELOG.md`, in an emoji group (✨ New, 🛠️ Improved, 🐛 Fixed, ⚡ Faster, ⚠️ Changed; 🙏 Thanks names the testers, bug reporters and contributors of the release, linking the GitHub profile of anyone who contributed through GitHub), starting with a **short summary** in bold (the update note and the Discord post show only that), then one or two plain sentences; big visible changes get a screenshot (the format is in the comment at the top of the file). To release: bump `package.json` (and `plugin/.claude-plugin/plugin.json`), rename `## Unreleased` to `## <version> (beta) · <yyyy-mm-dd>`, then run the Release workflow (https://github.com/Snailedlt/splitscreenme-vscode/actions/workflows/release.yml; leave the version empty for the next beta). It checks the version first (`scripts/release-version.mjs`), and its run summary has the links and the Discord post to copy. With a `DISCORD_WEBHOOKS` secret (one Discord webhook URL per line) it also posts that announcement itself (`scripts/announce.mjs`; mentions disabled; a failed post never fails the release). It publishes that section as the GitHub release notes (`scripts/release-notes.mjs`) and refuses to release without it; `--discord` prints a short post for the testers' thread (a heading, up to three highlights, the link) (the tools show what's new themselves: the extension after an update and in **Nucleus: What's New**, the workbench from its own `CHANGELOG.md`). A test checks the format.

## Conventions

- When the maintainer has to run a workflow or change a setting, give the direct link (e.g. https://github.com/Snailedlt/splitscreenme-vscode/actions/workflows/release.yml) and the inputs to enter.
- When you need network allowlist entries (hosts) or environment variables from the maintainer, always list them in a code block, one per line, ready to copy.

- TypeScript strict; keep `src/core` free of `vscode` imports.
- Handler code you generate (templates, snippets, skill docs) must be ES5 and lint-clean. Tests lint the templates and every `js` block in the skill docs.
- The skill docs must only name real API members. A test resolves every `Game.*`/`Context.*` path mentioned in them.
