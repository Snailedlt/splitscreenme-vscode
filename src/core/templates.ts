// Handler templates used by the "New Handler" command.

export interface HandlerInfo {
  gameName: string;
  executableName: string;
  steamId?: string;
  maxPlayers?: number;
  binariesFolder?: string;
  features: Feature[];
}

export type Feature = 'goldberg' | 'protoinput' | 'resolution-ini' | 'options';

export const FEATURES: { id: Feature; label: string; detail: string }[] = [
  { id: 'protoinput', label: 'Proto Input (multiple mice & keyboards)', detail: 'Startup hooks and input filters so each player can use their own keyboard/mouse.' },
  { id: 'goldberg', label: 'Goldberg Steam emulator (LAN)', detail: 'Use the built-in Goldberg emulator so instances find each other over LAN.' },
  { id: 'resolution-ini', label: 'Set resolution in an INI file', detail: 'Example Game.Play code writing each instance\'s window size to a config file.' },
  { id: 'options', label: 'User options', detail: 'Example Game.AddOption prompt read back with Context.Options.' },
];

/** Nucleus uses GUID as a folder name: keep letters, digits and spaces. */
export function toGuid(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || 'MyGame';
}

/** A name that is safe as one file or folder name on Windows and everywhere else: no path separators or characters
 *  Windows forbids, no control characters, no trailing dots or spaces, never "." or ".." (which would point at the
 *  folder itself or its parent) and never a reserved device name (CON, NUL, COM1…). Empty or unusable: the fallback. */
export function safeFileName(name: string, fallback = 'handler'): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/[. ]+$/, '');
  if (!s || /^\.+$/.test(s)) return fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s) ? `_${s}` : s;
}
/** Nucleus names the installed handler file after GameName with Windows' forbidden characters removed; made safe here too. */
export function toHandlerFileName(gameName: string): string {
  return safeFileName(gameName);
}

const q = (s: string) => JSON.stringify(s);

export function renderHandler(info: HandlerInfo): string {
  const has = (f: Feature) => info.features.includes(f);
  const L: string[] = [];
  const max = info.maxPlayers ?? 4;
  L.push(`// ${info.gameName} - Nucleus Co-op handler`);
  L.push('// Handler API: https://www.splitscreen.me/docs/handler-api');
  L.push('// Note: Nucleus runs handlers with Jint 2.x, which only supports ES5 JavaScript.');
  L.push('');
  // Game.GameName and Game.ExecutableName must start their line and use double
  // quotes: Nucleus reads them line by line when installing from the Hub.
  L.push(`Game.GameName = ${q(info.gameName)};`);
  L.push(`Game.GUID = ${q(toGuid(info.gameName))};`);
  L.push(`Game.ExecutableName = ${q(info.executableName)};`);
  if (info.steamId) L.push(`Game.SteamID = ${q(info.steamId)};`);
  L.push(`Game.MaxPlayers = ${max};`);
  L.push(`Game.MaxPlayersOneMonitor = ${Math.min(max, 4)};`);
  L.push('Game.Description = "Press the END key to lock/unlock input once all instances are running.";');
  if (info.binariesFolder) L.push(`Game.BinariesFolder = ${q(info.binariesFolder)};`);
  L.push('');
  L.push('// Instances');
  L.push('Game.SymlinkGame = true;');
  L.push('Game.SymlinkExe = false;');
  L.push('Game.SymlinkFolders = false;');
  L.push('Game.KillMutex = [];');
  L.push('Game.FileSymlinkExclusions = [];');
  L.push('Game.HandlerInterval = 100;');
  L.push('Game.PauseBetweenStarts = 10;');
  L.push('');
  L.push('// Windows');
  L.push('Game.SupportsPositioning = true;');
  L.push('Game.ResetWindows = true;');
  L.push('Game.DontResize = false;');
  L.push('Game.DontReposition = false;');
  L.push('Game.StartArguments = "-windowed";');
  L.push('');
  L.push('// Input');
  L.push('Game.SupportsKeyboard = true;');
  L.push('Game.Hook.CustomDllEnabled = false;');
  L.push('Game.Hook.ForceFocus = false;');
  L.push('Game.Hook.XInputEnabled = false;');
  L.push('Game.Hook.DInputEnabled = false;');
  if (!has('protoinput')) L.push('Game.XInputPlusDll = ["xinput1_3.dll"];');
  if (has('goldberg')) {
    L.push('');
    L.push('// Steam emulation (LAN between instances)');
    L.push('Game.UseGoldberg = true;');
    L.push('Game.GoldbergNeedSteamInterface = false;');
    L.push('Game.GoldbergLobbyConnect = false;');
    L.push('Game.UseNucleusEnvironment = true;');
  }
  if (has('protoinput')) {
    L.push('');
    L.push('// Proto Input: https://www.splitscreen.me/docs/protoinput');
    L.push('Game.SupportsMultipleKeyboardsAndMice = true;');
    L.push('// Legacy input options: must be off with Proto Input (several default to true)');
    for (const k of ['HookSetCursorPos', 'HookGetCursorPos', 'HookGetKeyState', 'HookGetAsyncKeyState', 'HookGetKeyboardState', 'HookFilterRawInput', 'HookFilterMouseMessages', 'HookUseLegacyInput', 'HookDontUpdateLegacyInMouseMsg', 'HookMouseVisibility', 'SendNormalMouseInput', 'SendNormalKeyboardInput', 'SendScrollWheel', 'ForwardRawKeyboardInput', 'ForwardRawMouseInput', 'HookReRegisterRawInput', 'HookReRegisterRawInputMouse', 'HookReRegisterRawInputKeyboard', 'DrawFakeMouseCursor']) {
      L.push(`Game.${k} = false;`);
    }
    L.push('Game.LockInputAtStart = false;');
    L.push('Game.LockInputToggleKey = 0x23; // END');
    L.push('Game.ProtoInput.InjectStartup = false;');
    L.push('Game.ProtoInput.InjectRuntime_RemoteLoadMethod = false;');
    L.push('Game.ProtoInput.InjectRuntime_EasyHookMethod = true;');
    L.push('Game.ProtoInput.InjectRuntime_EasyHookStealthMethod = false;');
    L.push('Game.ProtoInput.RegisterRawInputHook = true;');
    L.push('Game.ProtoInput.GetRawInputDataHook = false;');
    L.push('Game.ProtoInput.MessageFilterHook = true;');
    L.push('Game.ProtoInput.GetCursorPosHook = true;');
    L.push('Game.ProtoInput.SetCursorPosHook = true;');
    L.push('Game.ProtoInput.GetKeyStateHook = true;');
    L.push('Game.ProtoInput.GetAsyncKeyStateHook = true;');
    L.push('Game.ProtoInput.GetKeyboardStateHook = true;');
    L.push('Game.ProtoInput.CursorVisibilityHook = true;');
    L.push('Game.ProtoInput.ClipCursorHook = true;');
    L.push('Game.ProtoInput.FocusHooks = true;');
    L.push('Game.ProtoInput.XinputHook = true;');
    L.push('Game.ProtoInput.UseOpenXinput = true;');
    L.push('Game.ProtoInput.RawInputFilter = true;');
    L.push('Game.ProtoInput.MouseMoveFilter = false;');
    L.push('Game.ProtoInput.MouseActivateFilter = true;');
    L.push('Game.ProtoInput.WindowActivateFilter = true;');
    L.push('Game.ProtoInput.WindowActvateAppFilter = true;');
    L.push('Game.ProtoInput.MouseWheelFilter = true;');
    L.push('Game.ProtoInput.MouseButtonFilter = true;');
    L.push('Game.ProtoInput.KeyboardButtonFilter = true;');
    L.push('Game.ProtoInput.SendMouseWheelMessages = true;');
    L.push('Game.ProtoInput.SendMouseButtonMessages = true;');
    L.push('Game.ProtoInput.SendMouseMovementMessages = true;');
    L.push('Game.ProtoInput.SendKeyboardButtonMessages = true;');
    L.push('Game.ProtoInput.BlockedMessages = [0x0008]; // WM_KILLFOCUS');
    L.push('');
    L.push('Game.ProtoInput.OnInputLocked = function () {');
    L.push('  for (var i = 0; i < PlayerList.Count; i++) {');
    L.push('    var player = PlayerList[i];');
    L.push('    ProtoInput.SetDrawFakeCursor(player.ProtoInputInstanceHandle, true);');
    L.push('    ProtoInput.EnableMessageFilter(player.ProtoInputInstanceHandle, ProtoInput.Values.MouseButtonFilterID);');
    L.push('    ProtoInput.EnableMessageFilter(player.ProtoInputInstanceHandle, ProtoInput.Values.KeyboardButtonFilterID);');
    L.push('  }');
    L.push('};');
    L.push('');
    L.push('Game.ProtoInput.OnInputUnlocked = function () {');
    L.push('  for (var i = 0; i < PlayerList.Count; i++) {');
    L.push('    var player = PlayerList[i];');
    L.push('    ProtoInput.SetDrawFakeCursor(player.ProtoInputInstanceHandle, false);');
    L.push('    ProtoInput.DisableMessageFilter(player.ProtoInputInstanceHandle, ProtoInput.Values.MouseButtonFilterID);');
    L.push('    ProtoInput.DisableMessageFilter(player.ProtoInputInstanceHandle, ProtoInput.Values.KeyboardButtonFilterID);');
    L.push('  }');
    L.push('};');
  }
  if (has('options')) {
    L.push('');
    L.push('// Shown to the user before launching; read back with Context.Options["key"].');
    L.push('Game.AddOption("Window mode", "How each instance is displayed.", "windowMode", ["Borderless", "Windowed"]);');
  }
  L.push('');
  L.push('// Runs once per instance, before it starts. Context, Player and PlayerList are only available here.');
  L.push('Game.Play = function () {');
  if (has('resolution-ini')) {
    L.push('  var config = Context.GetFolder(Nucleus.Folder.InstancedGameFolder) + "\\\\config.ini";');
    L.push('  Context.ModifySaveFile(config, config, Nucleus.SaveType.INI, [');
    L.push('    new Nucleus.IniSaveInfo("Display", "Width", Context.Width),');
    L.push('    new Nucleus.IniSaveInfo("Display", "Height", Context.Height),');
    L.push('    new Nucleus.IniSaveInfo("Display", "Fullscreen", "0")');
    L.push('  ]);');
  }
  if (has('options')) {
    L.push('  if (Context.Options["windowMode"] == "Windowed") {');
    L.push('    Context.StartArguments = "-windowed";');
    L.push('  }');
  }
  if (!has('resolution-ini') && !has('options')) {
    L.push('  // e.g. Context.StartArguments = "-windowed -width " + Context.Width + " -height " + Context.Height;');
  }
  L.push('};');
  L.push('');
  return L.join('\n');
}
