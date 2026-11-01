# Recipes for `Game.Play` and common setups

All snippets are ES5 and lint-clean. Paths use `\\` (escaped backslash). Code using `Context` must be inside `Game.Play = function () { ... };` or another callback.

## Launch arguments per instance

```js
Game.Play = function () {
  Context.StartArguments = "-windowed -ResX=" + Context.Width + " -ResY=" + Context.Height;
};
```

## INI file (key=value with [sections])

```js
var ini = Context.GetFolder(Nucleus.Folder.InstancedGameFolder) + "\\Config\\settings.ini";
Context.ModifySaveFile(ini, ini, Nucleus.SaveType.INI, [
  new Nucleus.IniSaveInfo("Display", "Width", Context.Width),
  new Nucleus.IniSaveInfo("Display", "Height", Context.Height),
  new Nucleus.IniSaveInfo("Display", "Fullscreen", "0")
]);
```

The file must be per-instance, not a symlink to the original: add it to `Game.FileSymlinkExclusions` or `Game.FileSymlinkCopyInstead`, or keep it in a per-player environment.

## Config in Documents / AppData (per player)

```js
Game.UseNucleusEnvironment = true;   // each player gets their own Documents/AppData
Game.Play = function () {
  var cfg = Context.DocumentsPlayer + "My Games\\Game\\config.ini";   // DocumentsPlayer ends with "\\"
  Context.ModifySaveFile(cfg, cfg, Nucleus.SaveType.INI, [
    new Nucleus.IniSaveInfo("Video", "ResX", Context.Width)
  ]);
};
```

Also available: `Context.EnvironmentPlayer` (the player's user-profile root), `Context.NucleusUserRoot`. Check with `nucleus api --search environment`.

## Text file lines (find, then replace)

```js
var cfg = Context.GetFolder(Nucleus.Folder.InstancedGameFolder) + "\\settings.cfg";
Context.ReplaceLinesInTextFile(cfg, [
  Context.FindLineNumberInTextFile(cfg, "ScreenWidth", Nucleus.SearchType.StartsWith) + "|ScreenWidth " + Context.Width,
  Context.FindLineNumberInTextFile(cfg, "ScreenHeight", Nucleus.SearchType.StartsWith) + "|ScreenHeight " + Context.Height
]);
```

Each entry is `"<lineNumber>|<new line>"`. `ReplacePartialLinesInTextFile` takes `"<line>|<regex>|<replacement>"`.

## Write a whole file

```js
var path = Context.GetFolder(Nucleus.Folder.InstancedGameFolder) + "\\autoexec.cfg";
Context.WriteTextFile(path, [
  "name \"" + Context.Nickname + "\"",
  "fps_max 60"
]);
```

## XML attribute or node

```js
var xml = Context.GetFolder(Nucleus.Folder.InstancedGameFolder) + "\\settings.xml";
Context.ChangeXmlAttributeValue(xml, "//resolution", "width", Context.Width);
Context.ChangeXmlAttributeValue(xml, "//resolution", "height", Context.Height);
Context.ChangeXmlNodeValue(xml, "//fullscreen", "false");
```

## JSON (no JSON helper exists, so write it as text)

```js
var json = Context.GetFolder(Nucleus.Folder.InstancedGameFolder) + "\\settings.json";
Context.WriteTextFile(json, [
  "{",
  "  \"width\": " + Context.Width + ",",
  "  \"height\": " + Context.Height + ",",
  "  \"fullscreen\": false",
  "}"
]);
```

## Copy a file shipped with the handler

Put the file in the handler's asset folder `handlers/<Name>/` (`Game.Folder`). Exclude the target from symlinking.

```js
Game.FileSymlinkExclusions = ["steam_api64.dll"];
Game.Play = function () {
  System.IO.File.Copy(
    System.IO.Path.Combine(Game.Folder, "steam_api64.dll"),
    System.IO.Path.Combine(Context.GetFolder(Nucleus.Folder.InstancedGameFolder), "steam_api64.dll"),
    true
  );
};
```

## Per-player values

```js
var port = 7777 + Context.PlayerID;          // 0-based instance index
var isHost = Context.PlayerID === 0;
var name = Context.Nickname;
if (Context.IsKeyboardPlayer) { /* KB/M player */ }
```

## Options the user picks before launch

```js
Game.AddOption("Graphics", "Lower settings help when running several instances.", "gfx", ["Low", "Medium", "High"]);
Game.Play = function () {
  var gfx = Context.Options["gfx"];
  if (gfx == "Low") { Context.StartArguments += " -lowgfx"; }
};
```

## Registry value (restored when Nucleus closes)

```js
Context.EditRegKey("HKEY_CURRENT_USER", "SOFTWARE\\Company\\Game", "Fullscreen", 0, Nucleus.RegType.DWord);
```

## Goldberg (Steam LAN between instances)

```js
Game.SteamID = "123456";        // Steam app ID
Game.UseGoldberg = true;
Game.GoldbergNeedSteamInterface = false;   // set true if the game crashes with older steam_api versions
Game.GoldbergLobbyConnect = false;
```

## Proto Input (multiple keyboards and mice)

Generate the full block with `nucleus new --features protoinput` (or the `nc-protoinput` snippet). It includes `Game.ProtoInput.OnInputLocked` / `OnInputUnlocked` callbacks that loop over `PlayerList` and use `player.ProtoInputInstanceHandle`. Reference: https://www.splitscreen.me/docs/protoinput

## Loop over all players (inside a callback)

```js
for (var i = 0; i < PlayerList.Count; i++) {
  var player = PlayerList[i];
  // player.Nickname, player.IsKeyboardPlayer, player.ProtoInputInstanceHandle, ...
}
```
