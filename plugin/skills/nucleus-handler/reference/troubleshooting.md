# Troubleshooting: symptom → what to try

Change one thing per test round. Confirm every option with `nucleus api <name>`.

| Symptom | Likely cause | Try |
| --- | --- | --- |
| Game missing from Nucleus after adding the handler, or an "Error in handler" dialog | JS error while loading: syntax Jint can't parse, a duplicate `GUID`, or `Context` used at top level | `nucleus lint`. Dialog line numbers count from the top of the file. Make `Game.GUID` unique. |
| Installing from the Hub uses the wrong name/exe, or fails | The `GameName`/`ExecutableName` lines don't follow the line format | Lint rule `hub-install-parse`: each line unindented, double quotes, no other `"` on the line. |
| An option seems to do nothing | Misspelled or nonexistent option (silently ignored), or wrong type | Lint (`unknown-member`, `type-mismatch`); `nucleus api <name>`. |
| Second instance doesn't start, or closes the first | Single-instance mutex/handle, launcher check, or window-title check | `Game.KillMutex` (find names with Process Explorer), `Game.ChangeExe`, `Game.IdInWindowTitle`, `Game.HookInit`, `Game.LaunchAsDifferentUsers`; Proto Input `RenameHandles`. |
| Only the first instance starts, others hang | Same as above, or the launcher is in the way | Launch the game exe directly; `Game.HookInit = true;`; increase `Game.PauseBetweenStarts`. |
| Windows not resized/positioned | Game is fullscreen, or the title doesn't match | Make the game windowed (arguments/config in `Game.Play`); set `Game.Hook.ForceFocusWindowName` exactly, plus `Game.HasDynamicWindowTitle = true;` if it changes; `Game.ResetWindows = true;`. |
| Game resizes itself back | Game enforces its own resolution | Write `Context.Width`/`Context.Height` into its config; Proto Input `Game.ProtoInput.SetWindowPosHook = true;` (usually with startup injection). |
| Title bar or border comes back | Game re-applies its window style | `Game.ProtoInput.SetWindowStyleHook = true;`, or `Game.WindowStyleEndChanges`. |
| Audio from only one instance | Inactive windows mute themselves | `Game.HookFocus = true;` (or Proto Input `FocusHooks`). |
| Only one instance reacts to input | Instances pause or ignore input when unfocused | `Game.FakeFocus = true;`, or instead `Game.PreventWindowDeactivation = true;` (blocks KB/M); Proto Input `FocusHooks` + focus message loop. |
| One instance has much higher FPS than the others | Foreground window gets priority | `Game.SetForegroundWindowElsewhere = true;` (gamepads). |
| Every controller controls every instance | No input restriction method active | Choose one: `Game.XInputPlusDll` (+ `Game.Hook.CustomDllEnabled = false;`), Proto Input `XinputHook`, or `Game.Hook.CustomDllEnabled` with the right `Game.Hook.XInputNames`. Check which xinput dll the game loads. |
| Controllers don't work at all after restriction | Wrong xinput dll name, or a DirectInput-only game | Match the dll the game loads (`xinput1_3.dll`, `xinput1_4.dll`, `xinput9_1_0.dll`, ...); for DirectInput try `Game.UseDevReorder`, XInputPlus dinput dlls, or Proto Input `DinputDeviceHook`. |
| Keyboard/mouse goes to every instance | Multi-KB/M not set up | Proto Input setup (template feature `protoinput`); remind the user to press End to lock input. |
| Mouse cursor jumps or escapes the window | Game sets or clips the real cursor | Proto Input `SetCursorPosHook`, `GetCursorPosHook`, `ClipCursorHook`, `MouseMoveFilter` (CPU heavy; only if needed). |
| Instances don't find each other in multiplayer | No LAN between instances | Native LAN settings; `Game.UseGoldberg = true;` for Steam networking; Epic/GOG emulators; check firewall prompts. |
| All players share one save/config, or settings overwrite each other | The file is shared (symlinked game folder, or one Documents/AppData) | `Game.UseNucleusEnvironment = true;`; for files in the game folder, `Game.FileSymlinkExclusions` / `Game.FileSymlinkCopyInstead` and edit the instance copy. |
| Edits in `Game.Play` affect the original game install | Edited a symlinked file | Exclude it from symlinking (see above) before editing. |
| Steam opens or the game says "launch through Steam" | Steam DRM / API check | `Game.UseGoldberg = true;`; for Steam Stub DRM `Game.UseSteamless = true;`. |
| Crash on start of instance 2+ only | Conflicting shared file, anti-cheat, or startup hooks | Check debug-log.txt; `Game.UseEACBypass` for EasyAntiCheat (offline only); try without Proto Input startup injection. |

## Getting evidence

- Ask for `debug-log.txt` from the Nucleus folder (enable debug logging in Nucleus settings first).
- Add `Context.Log("width=" + Context.Width + " path=" + somePath);` in `Game.Play` to confirm values.
- `Game.KeepSymLinkOnExit = true;` keeps `content/<GUID>/Instance*` after closing, so the user can check which files were copied or edited.
