---
name: nucleus-handler
description: Write, fix, review or port Nucleus Co-op (SplitScreen.Me) game handlers, the JavaScript files that make PC games run split-screen. Use when the user mentions Nucleus Co-op, SplitScreen.Me, a handler .js with Game.GUID / Game.Play / Context, hub.splitscreen.me, Proto Input, Goldberg, or wants a game to run multiple instances for local co-op.
---

# Nucleus Co-op handlers

A handler is a JavaScript file that Nucleus Co-op (Windows) loads to launch several copies of a game, one per player, each in its own window with its own input device. Top-level code sets options on `Game`; `Game.Play` runs once per instance to customise it (config files, launch arguments, ...).

You usually **cannot run Nucleus or the game** (Windows GUI, the user's game install). Your job is to produce a handler that is correct by construction, verify it with the tools below, and give the user precise things to test and report back.

## Tools

This skill ships a self-contained Node CLI at `${CLAUDE_SKILL_DIR}/scripts/nucleus.js` (`${CLAUDE_SKILL_DIR}` is this skill's base directory; if it is not substituted, use the directory this SKILL.md is in). Run it with `node`. Every command takes `--json`.

| Command | Use it to |
| --- | --- |
| `node .../nucleus.js lint <file.js>` | **Always run after every edit.** Catches syntax Nucleus can't load, nonexistent options, wrong types, Context used outside `Game.Play`, Hub-install pitfalls. Shows available fixes. |
| `node .../nucleus.js api <name>` | Check an option/method before using it: `api Game.KillMutex`, `api Context.ModifySaveFile`, `api ForceFocus`, `api Nucleus.Folder`. |
| `node .../nucleus.js api --search <words>` | Find the right option: `api --search mutex`, `api --search window title`, `api --search steam emulator`. |
| `node .../nucleus.js hub search <words>` | Find existing handlers by game or series name. The Hub has no engine field: to find same-engine handlers, get a list of games on that engine (for example PCGamingWiki's engine page) and search for those titles. |
| `node .../nucleus.js hub fetch <id> --out <dir>` | Download one to read how its author solved instancing, input and LAN. The best learning resource there is. |
| `node .../nucleus.js new --name "Game" --exe Game.exe [--steam-id N] [--features protoinput,goldberg,resolution-ini,options]` | Start a new handler from a lint-clean template. |
| `node .../nucleus.js package <file.js>` | Build the `.nc` package for hub.splitscreen.me. |

If `node` is unavailable, read [reference/api.md](reference/api.md) (grep for `### Game.Name`) and apply the rules below by hand.

## Hard rules (a violation means the handler silently misbehaves or fails to load)

1. **ES5 JavaScript only.** Nucleus runs handlers with Jint 2.11. No arrow functions, template strings, classes, spread/rest, destructuring, default parameters, `for...of`, `?.`, `??`, or trailing commas in calls. `let`/`const` parse but behave like `var` (function-scoped), so just use `var`.
2. **Only use options that exist.** Assigning a misspelled or invented option (`Game.IgnoreWindowBordercheck`, `Game.ForceFinishOnPlay`) is silently ignored, so the handler "works" but does nothing. Verify every option with `api` or lint; never guess names. Options are case-sensitive.
3. **`Context`, `Player`, `PlayerList`, `Handler`, `ProtoInput` exist only inside callbacks** (`Game.Play`, `Game.ProtoInput.OnInputLocked`, ...). Top-level code may only use `Game`, `Hub`, `Nucleus`, `System`.
4. **Required:** `Game.GUID` (letters/digits/spaces only; becomes a folder name and must be unique), `Game.GameName`, `Game.ExecutableName` (exact .exe file name).
5. **Hub install parsing:** `Game.GameName = "...";` and `Game.ExecutableName = "...";` must each start their own line (no indentation), use double quotes, and have no other `"` on the line (not even in a comment). Nucleus reads them with a line scanner when installing from the Hub.
6. **Types matter:** list options take arrays (`Game.KillMutex = ["name"];`, not `"name"`), booleans are `true`/`false` (not strings), numbers are numbers.
7. **Files you modify per instance must not be symlinks to the original game.** With `Game.SymlinkGame = true`, edit config files that live outside the game folder (Documents/AppData via `Game.UseNucleusEnvironment`), or add the file to `Game.FileSymlinkExclusions` / `Game.FileSymlinkCopyInstead` so each instance gets its own copy. Otherwise every instance (and the real install) shares one file.
8. **With Proto Input, turn the legacy input options off.** Set `Game.HookGetCursorPos`, `Game.SendNormalMouseInput`, `Game.DrawFakeMouseCursor` and the rest to `false`; several default to `true` and would run alongside Proto Input. The `protoinput` template and lint rule `protoinput-legacy-hooks` handle this. Keep `Game.SupportsMultipleKeyboardsAndMice`, `Game.LockInputAtStart` and `Game.LockInputToggleKey`: they are still used.
9. **Don't add Hub metadata lines** (`Hub.Handler.Version`, `Hub.Handler.Id`, `Hub.Maintainer.*`). The Hub writes them on upload; keep them unchanged if they are already present.

## Workflow

**New handler.** Follow [reference/workflow.md](reference/workflow.md). In short:
1. **Research.** Look up the game's engine, input API (XInput/DirectInput/raw input), multiplayer type (LAN, online-only, Steam/Epic/GOG networking), launcher/DRM, config and save locations. PCGamingWiki is the best single source. Ask the user what you can't find; they have the game.
2. **Learn from existing handlers.** `hub search` the game and its series. If a handler for this exact game already exists (especially a verified one), tell the user **first**. Installing it from Nucleus' handler browser may be all they need. If they still want changes, build on it rather than starting over. Then search titles of other games on the same engine (Unreal Engine 4, Unity, Source, ...). `hub fetch` one or two and reuse their approach.
3. **Scaffold** with `new`, then adapt it: multiple instances (mutexes, `ChangeExe`, ...), connectivity (LAN or emulator), windowing/resolution in `Game.Play`, focus, input.
4. **Lint** until there are no errors or warnings you can't justify.
5. **Hand over a test plan.** Install via the VS Code extension or copy `<Name>.js` (and its `<Name>/` folder) into `<Nucleus>/handlers/`. Ask the user to enable debug logging (Settings, or `DebugLog=True` under `[Misc]` in Nucleus' `Settings.ini`), test with 2 players, and send `debug-log.txt` from the Nucleus folder plus what they saw.

**Fixing a handler.** Lint first, then match the user's symptom in [reference/troubleshooting.md](reference/troubleshooting.md). Change one thing at a time and say what each change is for, so test results stay interpretable.

**Reviewing.** Lint, then check the hard rules, then check the handler's logic against the game facts (paths, file formats, arguments).

## Code you'll write in `Game.Play`

See [reference/recipes.md](reference/recipes.md) for tested patterns: INI/XML/text config edits, launch arguments, copying files from the handler folder, Goldberg settings, registry edits, per-player values, options. Key facts:

- `Context.Width` / `Context.Height`: this instance's window size. `Context.PlayerID`: 0-based instance index. `Context.Nickname`: player name.
- `Context.GetFolder(Nucleus.Folder.InstancedGameFolder)`: this instance's copy of the game. `Game.Folder`: the handler's own asset folder (`handlers/<Name>/`).
- `Context.StartArguments = "..."` in `Game.Play` sets this instance's command line.
- Use `\\` in path strings. `System.IO.*` (.NET) is available for files and folders.
- `Context.Log("...")` writes to Nucleus' debug log; use it to confirm what `Game.Play` computed.

## Style

Match the conventions of the handler you're editing. For new handlers, group options (game info, instances, windows, input, network) and comment non-obvious choices with the reason (for example `// game refuses a 2nd instance without this`). Put user-facing notes (setup steps, known issues, which key locks input) in `Game.Description`.
