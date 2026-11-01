# Building a handler: step by step

Based on the official guide (https://www.splitscreen.me/docs/create-handlers) and the handler API docs (https://www.splitscreen.me/docs/handler-api). Verify any option with `nucleus api <name>` before using it.

## 1. Research the game

Collect these facts. Use PCGamingWiki (https://www.pcgamingwiki.com/) and the user, who has the game installed.

- **Executable** name, and whether it is in a subfolder (`Game.BinariesFolder`, relative to the game root). Ask which exe the user adds in Nucleus.
- **Engine.** Handlers for the same engine share most settings (Unreal Engine 4/5, Unity, Source, id Tech, ...).
- **Store/DRM:** Steam (app ID from steamdb.info goes in `Game.SteamID`), Epic, GOG, launcher (`Game.LauncherExe`).
- **Multiplayer:** native LAN? Steam networking only? Online-only (usually impossible)?
- **Input:** XInput controllers? DirectInput only (old games)? Keyboard/mouse via raw input?
- **Config and save locations:** a file in the game folder, Documents, AppData or the registry, and its format (INI, XML, JSON, text, binary).
- **Window mode:** does it support windowed/borderless? Is there a command-line switch (`-windowed`, `-ResX=`) or a config key?

## 2. Find similar handlers

```bash
node nucleus.js hub search "<game name>"
node nucleus.js hub search "<series name>"
node nucleus.js hub search "<another game on the same engine>"   # the Hub has no engine field
node nucleus.js hub fetch <id> --out ref/<name>
```

Read how the author handled mutexes, focus, input, LAN and config edits. Copy approaches, not blindly: options are often left over from experiments. Lint the reference too; its warnings show dead options.

## 3. Get multiple instances running

Nucleus copies or symlinks the game into `content/<GUID>/Instance<N>` (`Game.SymlinkGame = true;` is the normal setup) and starts one process per player. If the second instance refuses to start, try these in order:

1. **Mutexes / single-instance handles.** Find them with Process Explorer (View Handles on the game process, run as admin). Often they are named after the game or engine; Source games use `hl2_singleton_mutex`. Set `Game.KillMutex = ["name"];`. Related options: `Game.KillMutexType` (default `"Mutant"`; also `"Event"`, `"Semaphore"`), `Game.PartialMutexSearch`, `Game.KillMutexDelay`, `Game.RenameNotKillMutex`. With Proto Input you can instead rename handles at startup: `Game.ProtoInput.RenameHandlesHook = true;` plus `Game.ProtoInput.RenameHandles = [...]`.
2. **Rename the exe per instance:** `Game.ChangeExe = true;`
3. **Unique window titles:** `Game.IdInWindowTitle = true;`
4. **Hooks that hide other instances:** `Game.HookInit = true;`
5. **Run each instance as a different Windows user:** `Game.LaunchAsDifferentUsers = true;` (heavier; sometimes with `Game.ThirdPartyLaunch = true;`).
6. **Launchers** that refuse to start twice: launch the game exe directly if possible; otherwise `Game.LauncherExe`, `Game.LauncherTitle` and `Game.KillMutexLauncher`.

While testing, `Game.KeepSymLinkOnExit = true;` keeps the instance folders so the user can inspect them.

## 4. Connectivity

- **Native LAN:** nothing special. Check the instances see each other in the multiplayer menu.
- **Steam networking:** `Game.UseGoldberg = true;` replaces the Steam API with the Goldberg emulator so instances find each other over LAN. Each instance gets its own Steam ID and nickname. Related options: `Game.GoldbergNeedSteamInterface`, `Game.GoldbergLobbyConnect`, `Game.GoldbergExperimental`, `Game.GoldbergLanguage`, `Game.UseHandlerSteamIds` (search `api --search goldberg`).
- **Epic Online Services:** `Game.UseNemirtingasEpicEmu = true;`. **GOG Galaxy:** `Game.UseNemirtingasGalaxyEmu = true;` (see the emulator sections of the handler API docs for their JSON settings).
- **Separate user data per player:** `Game.UseNucleusEnvironment = true;` gives each player their own Documents/AppData, so saves and configs in those folders don't collide. Related options: `Game.UserProfileConfigPath`, `Game.DocumentsConfigPath`, and their `Save` variants.

## 5. Windows and resolution

Nucleus positions and resizes windows (`Game.SupportsPositioning = true;`). Make the game itself windowed at the right size, in `Game.Play`, using `Context.Width` and `Context.Height`:

- through launch arguments: `Context.StartArguments = "-windowed -ResX=" + Context.Width + " -ResY=" + Context.Height;`
- or through its config file (see recipes.md)

If the window title is needed for positioning or focus, set `Game.Hook.ForceFocusWindowName` to the exact title, plus `Game.HasDynamicWindowTitle = true;` if the title changes. Related options: `Game.ResetWindows`, `Game.DontResize`, `Game.DontReposition`, `Game.KeepAspectRatio`, `Game.WindowStyleValues`.

## 6. Focus

Every instance must think it is the active window, or it pauses, mutes or ignores input. See troubleshooting.md for symptom-driven choices. Common options: `Game.HookFocus`, `Game.FakeFocus`, `Game.PreventWindowDeactivation`, `Game.SetForegroundWindowElsewhere`, `Game.Hook.ForceFocus`. With Proto Input: `Game.ProtoInput.FocusHooks = true;`, and the focus message loop options.

## 7. Input

Assign one device per instance.

- **XInput controllers.** Pick ONE restriction method:
  - XInputPlus (simple and common): `Game.XInputPlusDll = ["xinput1_3.dll"];` with `Game.Hook.CustomDllEnabled = false;`. Use the dll name the game actually loads; find it with Process Explorer's View DLLs.
  - Proto Input's Xinput hook: `Game.ProtoInput.XinputHook = true;`, often with `Game.ProtoInput.UseOpenXinput = true;` (more than 4 controllers).
  - Nucleus' custom x360ce dll: `Game.Hook.CustomDllEnabled = true;` with `Game.Hook.XInputNames`.
- **DirectInput-only games:** `Game.UseDevReorder = true;`, Proto Input's `DinputDeviceHook`, or XInputPlus with dinput dlls.
- **Keyboard and mouse.** `Game.SupportsKeyboard = true;` gives one KB/M player. Multiple keyboards and mice need **Proto Input** (https://www.splitscreen.me/docs/protoinput): `Game.SupportsMultipleKeyboardsAndMice = true;` plus the `Game.ProtoInput.*` hooks and filters (template feature `protoinput`). The older `Game.Hook*`/`Game.Send*` multi-KB options are deprecated and must be set to `false` when using Proto Input (several default to `true`); the template does this. Users press End (`Game.LockInputToggleKey`) to lock input once all instances run.

## 8. Test plan for the user

Write down exactly what to check, for example:

1. Copy `<Name>.js` (and the `<Name>/` folder if any) to `<Nucleus>/handlers/`, restart Nucleus, add the game (select `<exe>`).
2. Enable debug logging in Nucleus settings.
3. Start with 2 players: 1 controller + 1 keyboard (or 2 controllers).
4. Report: did both instances start? Are both windows the right size and position? Does each player only control their own window? Do the instances see each other in multiplayer? Is there audio from both?
5. Send `debug-log.txt` (Nucleus folder) and any error dialog text.
