# AGENTS.md

Guidance for AI coding agents working on **this repository**: the SplitScreen.Me VS Code extension, the `ncdev` CLI (old name `nucleus`; also a standalone .exe), the Notepad++ plugin and the agent skill for Nucleus Co-op handlers.

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
npm run standalone  # dist-sea/: NcDev.dll (Notepad++ plugin, needs MinGW) + ncdev.exe / ncdev-linux-x64 (Node SEA); then node scripts/smoke-standalone.mjs
npm run generate    # regenerate data/nucleus-api.json + types/nucleus.d.ts (needs ../splitscreenme-nucleus and ../splitscreenme-www clones; the Sync workflow does this daily by PR)
claude plugin validate .   # validate .claude-plugin/marketplace.json and the plugin
```

Run `npm test` and `npm run typecheck` before finishing. Run `npm run build` after changing anything under `src/` and commit the regenerated `plugin/skills/nucleus-handler/reference/api.md` (CI checks it). The skill's bundle, `scripts/nucleus.js` (2.6 MB), is committed **only in the release commit** (run `npm run build` there and commit it; the Release workflow refuses a stale one). Every other commit leaves it as it is (`git checkout -- plugin/skills/nucleus-handler/scripts/nucleus.js`), so the history doesn't grow by a bundle per change. Plugin users get the released bundle from `main`.

## Layout

- `src/core/`: pure logic, no `vscode` import, shared by the extension, the CLI and the skill.
  - `api.ts`: typed access to the generated API model, member resolution.
  - `lint.ts`: the linter (acorn AST). `RULES` is the rule registry.
  - `jsrules.ts`: general JavaScript mistakes from ESLint's own rules (its `Linter`, in-process, `eslint/universal`), each with a plain title and why, merged into `lint()`'s results. Add one only after running it over every Hub handler (the `data` branch's `hub/`) with no false alarms. The Try it sandbox bundle stubs ESLint out (`eslint-stub.ts`); the workbench's build shims `path` and `process` for it.
  - `jsbuiltins.ts`: JavaScript's ES5 objects and methods (String, Array, Math, JSON, Number, global functions) for completion/hover/signature help, from `data/js-builtins.json` (generated from TypeScript's `lib.es5.d.ts` by `scripts/generate-jsbuiltins.mjs`; a test checks it's current).
  - `format.ts`: Format Document / `ncdev format`: indentation and spacing only. Line breaks never move and the result is re-tokenized and compared with the original; any difference and it refuses. Keep that guarantee.
  - `complete.ts`: text-based resolution for completion/hover/signature help (works on incomplete code).
  - `features.ts`: the editor features as plain data (hover, completion, signature help, quick fixes, Format Document edits, inlay hints, handler detection). `extension.ts` and `lsp.ts` only convert them.
  - `lookup.ts`: `ncdev api` lookup/search and the Markdown API reference.
  - `sim.ts`: "Try it", runs a handler per player emulating Jint. Shared with the testbench's browser workbench; keep it free of Node and DOM APIs.
  - `pkgcheck.ts`: checks on a handler's package files (Windows names, overwrites, INI/JSON, a misspelled `Game.Folder` file). `gamefolder.ts`: checks against the game's install folder (ExecutableName, BinariesFolder, the symlink lists). Both shared with the workbench, which imports them.
  - `notepadpp.ts`: the Notepad++ auto-completion file (API names, `System.IO` members, call tips), merged into Notepad++'s own on the user's PC by `ncdev setup notepad++` (`src/setup-npp.ts`) when there's no plugin. Never ship Notepad++'s own file.
  - `templates.ts`, `zip.ts`, `pkg.ts`, `hub.ts`: New Handler templates, .nc packages, agent-kit install, hub.splitscreen.me client.
- `src/extension.ts`, `src/commands.ts`, `src/tryit.ts`: VS Code glue (`tryit.ts` is the Try it panel).
- `src/sandbox.ts`: runs `core/sim.ts` for Node hosts inside a `vm` context. `scripts/build.mjs` bundles `src/sim-sandbox-entry.ts` into a string (`__SIM_SANDBOX__`) for it. Never call `simulate()` directly from Node code: handler code would get full Node access. `src/test/sim.test.ts` tries the known escapes. Editors and servers (Try it, Test all, `nucleus.tryIt`, `nucleus_simulate`, the debugger) go through `src/simworker.ts` instead: one worker thread owns the same vm sandbox (`src/sandbox-vm.ts`, bundled to `__SIM_WORKER__` and started with `eval: true`, so the standalone ncdev works), with a hard time limit, a memory limit and cancellation, so a looping handler never blocks the thread that serves people. The synchronous `simulateIsolated` stays for the CLI's one-shot runs and tests.
- `src/pkgfiles.ts`: the files in `<Name>/` next to `<Name>.js` on disk, for the package checks (extension, CLI, LSP). `src/gamefolder-node.ts`: reads a game's install folder from disk (extension and `ncdev lsp`). `src/gamefolders.ts`: VS Code's *Link the Game's Folder…*, its problems, fixes and completion (`splitscreenme.gameFolders`).
- `src/dap.ts`: the Debug Adapter (DAP) over `core/debug.ts` (no `vscode` import; `ncdev dap` serves it on stdio for other editors); `src/debugvscode.ts` registers it inline for VS Code's Run and Debug (`"type": "nucleus"`).
- `src/cli.ts`: the `ncdev` CLI (`nucleus` is its old name, `nucleus-lint` an alias of `ncdev lint`).
- `src/standalone.ts`: the standalone ncdev (Node single executable, built by `scripts/sea.mjs` with the pinned `NODE_VERSION`; the skill and the Notepad++ plugin are built-in assets) and `ncdev update` (newest release, SHA-256 checked, the running exe moved aside). `scripts/smoke-standalone.mjs` tests a build; the Release workflow and CI run it.
- `src/setup-npp.ts`: `ncdev setup notepad++`: installs the plugin (`plugins\NcDev\NcDev.dll`, `NcDev.ini` with ncdev's path) and copies ncdev to `%LOCALAPPDATA%\ncdev`; without a built-in plugin, merges the names into Notepad++'s list (`core/notepadpp.ts`).
- `npp-plugin/`: the Notepad++ plugin, a thin client of `ncdev lsp` (C++17, MinGW, `build.sh`; Scintilla headers vendored under their own licence, Notepad++'s plugin API declared in `NcDev.cpp`). Keep logic out of it: features go into `core/features.ts` / `lsp.ts` first. Test it in Notepad++ (Wine works: `wine explorer /desktop=…` so popups paint; `NCDEV_PLUGIN_LOG` logs the LSP traffic).
- `src/nucleusrun.ts`: Test in Nucleus Co-op: install, then start `NucleusCoop.exe <GUID>` from its folder (it selects that game; a second copy won't start, so an open one is closed first, with the user's OK); its debug log switch in `Settings.ini`. VS Code, `ncdev test`, `ncdev lsp`, Notepad++ (through `ncdev test`).
- `src/install.ts`: installs a handler and its `<Name>/` folder into Nucleus' `handlers` folder (VS Code's Install, `ncdev install`, the Notepad++ plugin through it).
- `src/hubcache.ts`: every Hub read goes through it. The list comes from the testbench's daily index (`data` branch, `hub-index.json`), revalidated hourly by ETag; the Hub API only as a fallback; packages once per version, shared requests, at most two downloads at once, capped retries on 429/5xx. Every request carries `core/hub.ts` `hubClientHeaders(tool, feature)` (our devtools, the tool, the feature; nothing personal): pass a `feature` from each call site. Keep it that way: don't add direct Hub API calls.
- `src/lsp.ts`: `ncdev lsp`, a Language Server (stdio, Content-Length framed JSON-RPC, no dependencies) for other editors. [PORTING.md](PORTING.md) explains the split and has the config for each editor.
- `src/mcp.ts`: `ncdev mcp`, the same tools as an MCP server (stdio JSON-RPC). The extension registers it for VS Code's agents. `src/simformat.ts` is the simulation text shared by both.
- `src/test/`: tests. `vscode-mock.ts` stands in for the `vscode` module, via an esbuild alias in `scripts/build.mjs`.
- `scripts/issue-bots.mjs`: the issue bots (`doc-review.yml`, `report-details.yml` call it). `src/test/bots.test.ts` checks them on real issue bodies and against the forms in `.github/ISSUE_TEMPLATE/`; rename a form field and that test fails. The details checksum must match the workbench's (`playground/src/checksum.ts` there; both test the same block).
- `scripts/generate-api.mjs`: builds the API model from the Nucleus C# sources + splitscreen.me docs.
- `plugin/`: the Claude Code plugin (`.claude-plugin/plugin.json`, `skills/nucleus-handler/`). `.claude-plugin/marketplace.json` at the root publishes it.
- `.coderabbit.yaml`: CodeRabbit's pull request reviews. It reads this file and the skill's docs as guidelines; its `path_instructions` repeat the rules above per folder (core, rules, format, sandbox, Hub, adapters), so change them together. The Nucleus source reaches it through the DeepWiki MCP server, connected in CodeRabbit's web app. [CODERABBIT.md](CODERABBIT.md) has the web app's setup.

## Docs written by Claude

`data/claude-docs.json` holds API docs Claude wrote from the Nucleus and Proto Input source, for members the official docs and the source comments leave out. Each entry has `doc` and `basis` (the files and functions it is based on). `npm run generate` uses one only where no human doc exists (or with `"override": true`, where the official text is wrong), and marks the member `docBy: "claude"`, `docBasis`. Every place docs show (hovers, completion, Reference, `api.md`, the `.d.ts`, the CLI) adds "AI-written, based on …" (`claudeNote` in `core/api.ts`; the tools say "AI-written", not Claude); human docs carry no label. A person who checks one against Nucleus is recorded with `"checkedBy": "<name>", "checkedOn": "<yyyy-mm-dd>"` (from a `doc-review` issue or the anonymous votes); the label then says "Checked by …" and it stays visible that it was AI-written. When you write one, read the source first and state only what it shows; `src/test/docs.test.ts` checks every entry is a real member and still used. `data/claude-param-docs.json` does the same for parameters (what to pass), for the most used methods: they show in parameter hints and the `.d.ts` `@param`s, marked AI-written.

## Generated files: never edit by hand

`data/nucleus-api.json`, `types/nucleus.d.ts` (from `npm run generate`), and `plugin/skills/nucleus-handler/scripts/nucleus.js` and `plugin/skills/nucleus-handler/reference/api.md` (from `npm run build`); the bundle is committed with releases only, see Commands). Fix the generator or the source instead.

## Related repositories

Where to look things up, and which to trust when they disagree (current code first, then these facts, then history). CodeRabbit reaches them through DeepWiki; an agent can clone them next to this repo.

- **Current code:** [SplitScreen-Me/splitscreenme-nucleus](https://github.com/SplitScreen-Me/splitscreenme-nucleus) (Nucleus Co-op, C#: how handlers are loaded and run, every `Game.*` option, the Hub install), [splitscreenme-protoInput](https://github.com/SplitScreen-Me/splitscreenme-protoInput) (Proto Input: input hooks, message filters), [splitscreenme-www](https://github.com/SplitScreen-Me/splitscreenme-www) (the official handler docs), [splitscreenme-hub](https://github.com/SplitScreen-Me/splitscreenme-hub) (hub.splitscreen.me), [splitscreenme-discordbot](https://github.com/SplitScreen-Me/splitscreenme-discordbot) (the bot and its handler templates), [sebastienros/jint](https://github.com/sebastienros/jint) (the engine; Nucleus pins 2.11.58).
- **Our tools:** [Snailedlt/splitscreenme-vscode](https://github.com/Snailedlt/splitscreenme-vscode) (checks, simulator, API model, editors, CLI, MCP, skill) and [Snailedlt/nucleuscoop-handler-testbench](https://github.com/Snailedlt/nucleuscoop-handler-testbench) (the workbench and site, imports the first one's `src/core`; the Jint probes).
- **History** (why something is the way it is, old handlers; current code wins): [lucasassislar/nucleuscoop](https://github.com/lucasassislar/nucleuscoop) (the original Nucleus Co-op), [distrohelena/nucleuscoop](https://github.com/distrohelena/nucleuscoop) (the community version before SplitScreen.Me), [Ilyaki/ProtoInput](https://github.com/Ilyaki/ProtoInput) (Proto Input before it moved), [UniversalSplitScreen](https://github.com/UniversalSplitScreen/UniversalSplitScreen) (Ilyaki's earlier input-hook split screen).
- **Related, for ideas only** (never a source for how Nucleus behaves): [partydeck/partydeck](https://github.com/partydeck/partydeck), a split-screen launcher for Linux/SteamOS.

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

Every user-visible change adds a line under `## Unreleased` in `CHANGELOG.md`, in an emoji group (✨ New, 🛠️ Improved, 🐛 Fixed, ⚡ Faster, ⚠️ Changed; 🙏 Thanks names the testers, bug reporters and contributors of the release, linking the GitHub profile of anyone who contributed through GitHub), starting with a **short summary** in bold (the update note and the Discord post show only that), then one or two plain sentences; big visible changes get a screenshot (the format is in the comment at the top of the file). When the tools leave beta, also do the issues labelled `full release` (README, AGENTS.md, Marketplace/GitHub presentation and screenshots: #4). To release: bump `package.json` (and `plugin/.claude-plugin/plugin.json`), run `npm run build` and commit the skill bundle with it, rename `## Unreleased` to `## <version> · <yyyy-mm-dd>`, then run the Release workflow (https://github.com/Snailedlt/splitscreenme-vscode/actions/workflows/release.yml; leave the version empty for package.json's). Versions are plain semver tags (`v0.6.0`): no `-beta` suffix, since 0.x already says the tools are in development; a patch (0.6.1) for fixes, a minor (0.7.0) for features. It checks the version first (`scripts/release-version.mjs`), and its run summary has the links and the Discord post to copy. With a `DISCORD_WEBHOOKS` secret (one Discord webhook URL per line) it also posts that announcement itself (`scripts/announce.mjs`; mentions disabled; a failed post never fails the release). It publishes that section as the GitHub release notes (`scripts/release-notes.mjs`) and refuses to release without it; `--discord --tag vX.Y.Z` prints a short post for the testers' thread (a heading, up to three highlights, the link) (the tools show what's new themselves: the extension after an update and in **Nucleus: What's New**, the workbench from its own `CHANGELOG.md`). A test checks the format.

**Which editors to put work into:** [docs/editor-poll.md](docs/editor-poll.md) has the authors' poll and the priorities it set (Notepad++ first; its Plugins Admin listing waits with the other stores).

**Store listings (prepared, not listed yet; issue #9, task #78).** 0.6.0 starts an open beta: gather testers and feedback first (a few weeks to a couple of months), then list. That includes Notepad++'s Plugins Admin, although Notepad++ is the most used editor (docs/editor-poll.md). Both are ready to list when the maintainer decides:
- *VS Code Marketplace / Open VSX:* `package.json` has the store fields (`preview: true` while in beta, `pricing`, `homepage`, `bugs`, `qna`). Run the **Publish to the extension stores** workflow (https://github.com/Snailedlt/splitscreenme-vscode/actions/workflows/publish-stores.yml; inputs: the tag, or empty for the newest release, and the store). It publishes the release's own `.vsix` and needs the `VSCE_PAT` / `OVSX_PAT` secrets (it refuses without them). Decide the publisher name first (`splitscreenme` only with the SplitScreen.Me team's OK).
- *Notepad++ Plugins Admin:* a pull request to [notepad-plus-plus/nppPluginList](https://github.com/notepad-plus-plus/nppPluginList) adding the two entries the Release workflow's summary prints (`scripts/npp-plugin-list.mjs`: `src/pl.x64.json` and `src/pl.x86.json`). Their validator compares the DLL's FileVersion with the entry, so `npp-plugin/build.sh` writes a version resource (package.json's version as a.b.c.0); CI and the Release workflow run the script and stop if a DLL or zip is wrong. Every release whose plugin changed needs a new pull request there.

**Every release is announced for both tools.** The extension's Release workflow posts its notes; the workbench (nucleuscoop-handler-testbench) posts its own when a new dated `CHANGELOG.md` section goes live on Pages (`pages.yml` compares the built and live `release.txt`, then `tools/release-post.mjs` + `tools/announce.mjs`, with that repo's own `DISCORD_WEBHOOKS` secret). When you ship both, check both posts went out (each run's summary says so, and has the text to paste if not).

## Conventions

- When the maintainer has to run a workflow or change a setting, give the direct link (e.g. https://github.com/Snailedlt/splitscreenme-vscode/actions/workflows/release.yml) and the inputs to enter.
- When you need network allowlist entries (hosts) or environment variables from the maintainer, always list them in a code block, one per line, ready to copy.

- TypeScript strict; keep `src/core` free of `vscode` imports.
- New editor features go in `src/core/features.ts` first (plain data, offsets), then into every adapter: `src/extension.ts` and `src/lsp.ts` (PORTING.md), and the Notepad++ plugin if it needs to show something new.
- **Links live for ever.** Links the tools print or put in docs (the workbench's `#docs-<name>`, `?ref=`, release and Hub links, README anchors, command and setting ids people bind keys to) keep working after any redesign: readable and generic, never internal ids. When one changes, the old one leads to the new place (the workbench's `MOVED_LINKS`; an alias for a command or setting, marked deprecated, pointing at the new one) and says so once. A removed thing gets a note saying what replaced it, not a dead end.
- **Code in docs is laid out neatly**, as prettier would (`core/pretty.ts`: `prettyCode` for examples, `prettySignature` for overloads), at 60 columns, so it reads well in a hover.
- **Every code block is syntax highlighted**, wherever it shows: hovers, hints, suggestion docs, the Docs/Try it panels, the workbench (`codehl.ts`: `hlCode`/`hlHtml`, `modeFor` by file type), the start page. Fenced Markdown gets a language (```` ```js ````/```` ```ts ````) so editors colour it; HTML we render ourselves colours it (`docspanel.ts` `highlightCode`). Inline code that is clearly code is coloured too.
- Handler code you generate (templates, snippets, skill docs) must be ES5 and lint-clean. Tests lint the templates and every `js` block in the skill docs.
- The skill docs must only name real API members. A test resolves every `Game.*`/`Context.*` path mentioned in them.
