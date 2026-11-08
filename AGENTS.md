# AGENTS.md

Guidance for AI coding agents working on **this repository**: the SplitScreen.Me VS Code extension, the `nucleus` CLI and the agent skill for Nucleus Co-op handlers.

If you are writing or fixing a *game handler* rather than this tooling, use the skill in `plugin/skills/nucleus-handler/` (start with its `SKILL.md`).

## Who it's for: a tool for every level

**Priorities, in order:** 1. a great tool for experienced developers and handler authors (correct checks, speed, keyboard, the core features); 2. easy to understand and use for newcomers, without getting in the way of 1.

The tools serve experienced developers, handler authors, Nucleus Co-op experts and complete newcomers alike. Welcome beginners without making the work slower or more cluttered for anyone else. (The model is Warcraft 3's editor: clickable, choices from lists, one-button testing, and a way into real code.)

- **One code underneath.** Every view (Code, Form, Blocks, pickers) edits the real handler code, so nobody is locked into a beginner mode and people move up a tier by looking at the code.
- **Two ways to work** (in the workbench; VS Code users write code, so there it means clear hovers and suggestions). Code is for people who write code. Form and Blocks belong together as the visual editor: plain-language names next to (or instead of) the API names, tips and docs right where each option is, values picked from lists. Each can be shown or hidden; most developers never open the visual editor, and most newcomers end up in Code.
- **Help on request, not on screen.** Markers, hints, plain-language labels and pickers show on hover, tap or a key (Ctrl+Space, Alt+Enter), never permanently in the code.
- **Keyboard first for experienced users.** Everything is reachable from the keyboard and the command palette; no wizard is ever required.
- **The first-run choice only sets defaults.** "Guide me" turns on the visual editor, tips and guided help; "I write code" starts compact. Every part can be switched in Settings.
- **The tool teaches.** Our community is small and won't write many guides, so the explanations live in the tool: plain-language docs on every option, "why" in every problem, examples from real Hub handlers, help that starts from the symptom ("my game pauses when it loses focus").
- **Desktop first.** Over 90% of people write handlers on a desktop or laptop: design and test for that (mouse, keyboard, a wide screen). Phones are supported but not tailored: nothing broken, cut off or untappable, checked by the smoke test's phone checks. No phone-only features, no phone layouts driving a design, no manual phone testing or phone screenshots for every change.
- **The check for every new feature:** does it add anything on screen for someone who didn't ask for it? If so, put it behind a hover, tap or key, or a setting.

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
  - `format.ts`: Format Document / `nucleus format`: indentation and spacing only. Line breaks never move and the result is re-tokenized and compared with the original; any difference and it refuses. Keep that guarantee.
  - `complete.ts`: text-based resolution for completion/hover/signature help (works on incomplete code).
  - `features.ts`: the editor features as plain data (hover, completion, signature help, quick fixes, Format Document edits, inlay hints, handler detection). `extension.ts` and `lsp.ts` only convert them.
  - `lookup.ts`: `nucleus api` lookup/search and the Markdown API reference.
  - `sim.ts`: "Try it", runs a handler per player emulating Jint. Shared with the testbench's browser workbench; keep it free of Node and DOM APIs.
  - `pkgcheck.ts`: checks on a handler's package files (Windows names, overwrites, INI/JSON, a misspelled `Game.Folder` file). `gamefolder.ts`: checks against the game's install folder (ExecutableName, BinariesFolder, the symlink lists). Both shared with the workbench, which imports them.
  - `templates.ts`, `zip.ts`, `pkg.ts`, `hub.ts`: New Handler templates, .nc packages, agent-kit install, hub.splitscreen.me client.
- `src/extension.ts`, `src/commands.ts`, `src/tryit.ts`: VS Code glue (`tryit.ts` is the Try it panel).
- `src/sandbox.ts`: runs `core/sim.ts` for Node hosts inside a `vm` context. `scripts/build.mjs` bundles `src/sim-sandbox-entry.ts` into a string (`__SIM_SANDBOX__`) for it. Never call `simulate()` directly from Node code: handler code would get full Node access. `src/test/sim.test.ts` tries the known escapes.
- `src/pkgfiles.ts`: the files in `<Name>/` next to `<Name>.js` on disk, for the package checks (extension, CLI, LSP). `src/gamefolder-node.ts`: reads a game's install folder from disk (extension and `nucleus lsp`). `src/gamefolders.ts`: VS Code's *Link the Game's Folder…*, its problems, fixes and completion (`splitscreenme.gameFolders`).
- `src/dap.ts`: the Debug Adapter (DAP) over `core/debug.ts` (no `vscode` import; `nucleus dap` serves it on stdio for other editors); `src/debugvscode.ts` registers it inline for VS Code's Run and Debug (`"type": "nucleus"`).
- `src/cli.ts`: the `nucleus` CLI (`nucleus-lint` is an alias of `nucleus lint`).
- `src/hubcache.ts`: every Hub read goes through it. The list comes from the testbench's daily index (`data` branch, `hub-index.json`), revalidated hourly by ETag; the Hub API only as a fallback; packages once per version. Keep it that way: don't add direct Hub API calls.
- `src/lsp.ts`: `nucleus lsp`, a Language Server (stdio, Content-Length framed JSON-RPC, no dependencies) for other editors. [PORTING.md](PORTING.md) explains the split and has the config for each editor.
- `src/mcp.ts`: `nucleus mcp`, the same tools as an MCP server (stdio JSON-RPC). The extension registers it for VS Code's agents. `src/simformat.ts` is the simulation text shared by both.
- `src/test/`: tests. `vscode-mock.ts` stands in for the `vscode` module, via an esbuild alias in `scripts/build.mjs`.
- `scripts/issue-bots.mjs`: the issue bots (`doc-review.yml`, `report-details.yml` call it). `src/test/bots.test.ts` checks them on real issue bodies and against the forms in `.github/ISSUE_TEMPLATE/`; rename a form field and that test fails. The details checksum must match the workbench's (`playground/src/checksum.ts` there; both test the same block).
- `scripts/generate-api.mjs`: builds the API model from the Nucleus C# sources + splitscreen.me docs.
- `plugin/`: the Claude Code plugin (`.claude-plugin/plugin.json`, `skills/nucleus-handler/`). `.claude-plugin/marketplace.json` at the root publishes it.

## Docs written by Claude

`data/claude-docs.json` holds API docs Claude wrote from the Nucleus and Proto Input source, for members the official docs and the source comments leave out. Each entry has `doc` and `basis` (the files and functions it is based on). `npm run generate` uses one only where no human doc exists (or with `"override": true`, where the official text is wrong), and marks the member `docBy: "claude"`, `docBasis`. Every place docs show (hovers, completion, Reference, `api.md`, the `.d.ts`, the CLI) adds "AI-written, based on …" (`claudeNote` in `core/api.ts`; the tools say "AI-written", not Claude); human docs carry no label. A person who checks one against Nucleus is recorded with `"checkedBy": "<name>", "checkedOn": "<yyyy-mm-dd>"` (from a `doc-review` issue or the anonymous votes); the label then says "Checked by …" and it stays visible that it was AI-written. When you write one, read the source first and state only what it shows; `src/test/docs.test.ts` checks every entry is a real member and still used.

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

- Proto Input only starts with `Game.ProtoInput.InjectStartup` or an `InjectRuntime_…` option (GenericGameHandler); otherwise every `Game.ProtoInput.*` option is ignored. `BlockedMessages` and the `…Filter` options only act inside its message filter hook (`MessageFilterHook`; ProtoInputHooks `MessageFilterHook.cpp`). A blocked number goes through Proto Input's own message table (`MessageList.cpp`, `GenerateIndexTable`, reproduced in `core/wm.ts`): unlisted numbers land on another entry's switch, numbers past the end do nothing. `data/window-messages.json` comes from that file (`scripts/generate-wm.mjs`, part of `npm run generate`; needs a `../splitscreenme-protoInput` clone). Nucleus spells one option `WindowActvateAppFilter`.
- Options Nucleus only reads inside another's `if` (`needs-option` in `core/lint.ts`): `FakeFocusInterval` and `FakeFocusSendActivateIgnoreKB` need `FakeFocus`; `FakeFocusSendActivate` needs `FakeFocus` or `SendFakeFocusMsg` (WindowFakeFocus); the fake-cursor options need `DrawFakeMouseCursor`; `SteamlessArgs`/`SteamlessTiming` need `UseSteamless`; `Game.ProtoInput.FocusLoop_*` and `FocusLoopIntervalMilliseconds` need `Game.ProtoInput.EnableFocusMessageLoop` (ProtoInputLauncher; skipped when the handler calls `ProtoInput.StartFocusMessageLoop` itself).
- `ProtoInput.Values.GetCursorInfoID` is a Nucleus bug: it holds `RemoveBorderHookID` (ProtoInput.cs ExposedValues), so installing it installs the remove-border hook.

## Changing lint rules

1. Add or change the rule in `RULES` and implement it in `Analyzer` (`src/core/lint.ts`).
2. Add tests in `src/test/lint.test.ts`, including a no-false-positive case.
3. Keep the rule list in sync: `package.json` → `contributes.configuration` → `splitscreenme.lint.rules.properties` (a test checks this), and the README table.
4. Check for false positives against real handlers: download some from the Hub (`node dist/cli.js hub fetch <id> --out /tmp/x`) and lint them. Published, working handlers should produce **no errors**.

## Release notes

Every user-visible change adds a line under `## Unreleased` in `CHANGELOG.md`, in an emoji group (✨ New, 🛠️ Improved, 🐛 Fixed, ⚡ Faster, ⚠️ Changed; 🙏 Thanks names the testers, bug reporters and contributors of the release, linking the GitHub profile of anyone who contributed through GitHub), starting with a **short summary** in bold (the update note and the Discord post show only that), then one or two plain sentences; big visible changes get a screenshot (the format is in the comment at the top of the file). When the tools leave beta, also do the issues labelled `full release` (README, AGENTS.md, Marketplace/GitHub presentation and screenshots: #4). To release: bump `package.json` (and `plugin/.claude-plugin/plugin.json`), rename `## Unreleased` to `## <version> (beta) · <yyyy-mm-dd>`, then run the Release workflow (https://github.com/Snailedlt/splitscreenme-vscode/actions/workflows/release.yml; leave the version empty for the next beta). It checks the version first (`scripts/release-version.mjs`), and its run summary has the links and the Discord post to copy. With a `DISCORD_WEBHOOKS` secret (one Discord webhook URL per line) it also posts that announcement itself (`scripts/announce.mjs`; mentions disabled; a failed post never fails the release). It publishes that section as the GitHub release notes (`scripts/release-notes.mjs`) and refuses to release without it; `--discord` prints a short post for the testers' thread (a heading, up to three highlights, the link) (the tools show what's new themselves: the extension after an update and in **Nucleus: What's New**, the workbench from its own `CHANGELOG.md`). A test checks the format.

**Every release is announced for both tools.** The extension's Release workflow posts its notes; the workbench (nucleuscoop-handler-testbench) posts its own when a new dated `CHANGELOG.md` section goes live on Pages (`pages.yml` compares the built and live `release.txt`, then `tools/release-post.mjs` + `tools/announce.mjs`, with that repo's own `DISCORD_WEBHOOKS` secret). When you ship both, check both posts went out (each run's summary says so, and has the text to paste if not).

## Conventions

- When the maintainer has to run a workflow or change a setting, give the direct link (e.g. https://github.com/Snailedlt/splitscreenme-vscode/actions/workflows/release.yml) and the inputs to enter.
- When you need network allowlist entries (hosts) or environment variables from the maintainer, always list them in a code block, one per line, ready to copy.

- TypeScript strict; keep `src/core` free of `vscode` imports.
- New editor features go in `src/core/features.ts` first (plain data, offsets), then into every adapter: `src/extension.ts` and `src/lsp.ts` (PORTING.md).
- Handler code you generate (templates, snippets, skill docs) must be ES5 and lint-clean. Tests lint the templates and every `js` block in the skill docs.
- The skill docs must only name real API members. A test resolves every `Game.*`/`Context.*` path mentioned in them.
