# Nucleus Co-op handler API reference

Generated from the Nucleus Co-op sources (SplitScreen-Me/splitscreenme-nucleus@3d22c0e) and the splitscreen.me docs. Do not edit by hand.

Each entry: `### Path`, then the type, then notes. Types use TypeScript notation. A `string` parameter also accepts numbers and booleans (Jint converts them). A `.NET params T[]` parameter accepts either separate arguments or one JS array.

Globals: `Game`, `Hub`, `Nucleus`, `System` (.NET), `importNamespace` are available everywhere. `Context`, `Player`, `PlayerList`, `Handler` and `ProtoInput` are ONLY available inside callbacks such as `Game.Play`.

## Game

Handler definition (`GenericGameInfo`).

### Game.AddOption
`AddOption(name: string | number | boolean, desc: string | number | boolean, key: string | number | boolean, value: any, defaultValue: any): void` / `Game.AddOption(name: string | number | boolean, desc: string | number | boolean, key: string | number | boolean, value: any): void`
Adds a user-selectable option to the game profile. Read it back in `Game.Play` with `Context.Options["key"]`.

### Game.AltEpicEmuArgs
`AltEpicEmuArgs: boolean`
Nemirtingas Epic Emulator
Optional. When using Nemirtinga's Epic Emulator, use pre-defined parameters + Set NickName as epic id, only to use with games that do not use epic id to start or connect(Set clever save names if the game use the epic id to name saves ex: Tiny Tina's Assault On Dragon Keep)" -AUTH_LOGIN=unused -AUTH_PASSWORD=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb -AUTH_TYPE=exchangecode -epicapp=CrabTest -epicenv=Prod -EpicPortal -epicusername=" + \<Player Nickname here\> + " -epicuserid="+ \<Player Nickname here\> + "-epiclocale=" + EpicLang".
Example: `Game.AltEpicEmuArgs = false;`

### Game.BackupFiles
`BackupFiles: string[]`

### Game.BackupFolders
`BackupFolders: string[]`

### Game.BinariesFolder
`BinariesFolder: string`
In which folder the game exe is located? Relative path to where Nucleus should start the game's working folder to.
Example: `Game.BinariesFolder = "Bin";`

### Game.BinariesFolderPathFix
`BinariesFolderPathFix: boolean`

### Game.BlockRawInput
`BlockRawInput: boolean`
Input
Disable raw input devices in game | default: false.
Example: `Game.BlockRawInput = false;`

### Game.ChangeExe
`ChangeExe: boolean`
File System
Will rename the game's executable to "\<exe name\> - Player X", x being the instance/player #.
Example: `Game.ChangeExe = true;`

### Game.ChangeIPPerInstance
`ChangeIPPerInstance: boolean`
Network
Highly experimental feature, will change your existing network to a static IP for each instance | option in settings to choose your network.
Example: `Game.ChangeIPPerInstance = false;`

### Game.ChangeIPPerInstanceAlt
`ChangeIPPerInstanceAlt: boolean`

### Game.CMDBatchAfter
`CMDBatchAfter: string[]`
Extra
When using CMDLaunch (or UseForceBindIP), specify command lines to run AFTER the game launches in same cmd session, syntax is instance and | symbol as a delimiter and the line you want that instance to run. If you want same line to run all instances, leave out the # and | (only write the line in quotes).
Example: `Game.CMDBatchAfter = [ "0|ops1", "1|ops2" ];`

### Game.CMDBatchBefore
`CMDBatchBefore: string[]`
Extra
When using CMDLaunch (or UseForceBindIP), specify command lines to run BEFORE the game launches in same cmd session, syntax is instance and | symbol as a delimiter and the line you want that instance to run. If you want same line to run all instances, leave out the # and | (only write the line in quotes).
Example: `Game.CMDBatchBefore = [ "0|ops1", "1|ops2" ];`

### Game.CMDBatchClose
`CMDBatchClose: string[]`

### Game.CMDLaunch
`CMDLaunch: boolean`
Extra
Launch a game using command prompt.
Example: `Game.CMDLaunch = false;`

### Game.CMDOptions
`CMDOptions: string[]`
Extra
Specify command line options if game is launched using command prompt | requires CMDLaunch to be true, each element is for a different instance.
Example: `Game.CMDOptions = ["ops1","ops2"];`

### Game.CMDStartArgsInside
`CMDStartArgsInside: boolean`
Extra
Game.CMDBatchClose ["cmd1", "cmd2"];			//Run command lines upon exiting Nucleus.
When using CMDLaunch, should the game's starting arguments be inside the same quotations as the game path?
Example: `Game.CMDStartArgsInside = false;`

### Game.CopyCustomUtils
`CopyCustomUtils: string[]`
File System
Copy a file or folder you specify between the quotes to each instance folder, if the file/folder is located in Nucleus folder\utils\User. This function also accepts two additional parameters, a relative path from the game root folder if the file needs to be placed somewhere else within instance folder and one parameter to indicate which instances to copy the file to if it only needs to be in some. Use of parameters is separated by a | character. So it would look something like this [ "filename.ini|\\bin|1,2" ]. This example would copy filename.ini from Nucleus\utils\User to Instance0\bin and Instance1\bin. If you don't specify which instances, it will do them all by default. If you don't specify a path then root instance folder is used. If you want instances but root folder you would just do [ "filename.ini||1,2" ] | If copying multiple files, use comma seperated strings
Example: `Game.CopyCustomUtils = [ "d3d9.dll" ];`

### Game.CopyEnvFoldersToNucleusAccounts
`CopyEnvFoldersToNucleusAccounts: string[]`

### Game.CopyFiles
`CopyFiles: string[]`
File System
Copy files from the game directory to the instanced folder.
Example: `Game.CopyFiles = ["game.exe","settings.cfg"];`

### Game.CopyFoldersTo
`CopyFoldersTo: string[]`
File System
Game.CopyEnvFoldersToNucleusAccounts = ["Documents", "AppData"]; //Copy subfolders of current user profile to Nucleus user accounts.
Copy folders in game root folder to another spot in game folder | Relative paths from root of game folder.
Example: `Game.CopyFoldersTo = ["folderToMove|whereToMoveIt"];`

### Game.CreateSingleDeviceFile
`CreateSingleDeviceFile: boolean`
Input
Create only one file for HID devices per instance (the assigned HID device).
Example: `Game.CreateSingleDeviceFile = false;`

### Game.CreateSteamAppIdByExe
`CreateSteamAppIdByExe: boolean`
File System
Create a steam_appid.txt file where the game executable is.
Example: `Game.CreateSteamAppIdByExe = false;`

### Game.CustomHotkeys
`CustomHotkeys: string[]`

### Game.CustomSteamApiDllPath
`CustomSteamApiDllPath: string[]`

### Game.CustomUserGeneralPrompts
`CustomUserGeneralPrompts: string[]`
Custom prompts
This prompts user one time and applies to ALL players, unless a value text file already exists and saving is on.
Example: `Game.CustomUserGeneralPrompts = ["Enter ROM name", "Enter filename"];`

### Game.CustomUserInstancePrompts
`CustomUserInstancePrompts: string[]`
Custom prompts
This will prompt each instance, unless a value text file already exists for that instance and save is on. In case it is not player specific but different values are needed for instances.
Example: `Game.CustomUserInstancePrompts = ["Enter network Adapter name"];`

### Game.CustomUserPlayerPrompts
`CustomUserPlayerPrompts: string[]`
Custom prompts
This will prompt each player, unless a value text file already exists for that player and saving for players is on.
Example: `Game.CustomUserPlayerPrompts = ["Enter network Adapter name", "Enter character name"];`

### Game.Debug
`Debug: boolean`
Writes a detailed debug log while the handler runs.

### Game.DeleteFiles
`DeleteFiles: string[]`
File System
Game.RenameAndOrMoveFiles = [ "1|before.dat|after.dat" ];//Specify files to either rename or move | can accept relative path from root | optional first parameter to specify a specific instance to apply to, omit to do them all.
Specify files to be deleted from instanced folder | can accept relative path from root | optional first parameter to specify a specific instance to apply to, omit to do them all.
Example: `Game.DeleteFiles = [ "1|delete.dis" ];`

### Game.DeleteFilesInConfigPath
`DeleteFilesInConfigPath: string[]`
Nucleus Co-op Environment
Specify files to delete in Nucleus environment config path (UserProfileConfigPath).
Example: `Game.DeleteFilesInConfigPath = [ "file.del", "me.too" ];`

### Game.DeleteFilesInSavePath
`DeleteFilesInSavePath: string[]`
Nucleus Co-op Environment
Specify files to delete in Nucleus environment save path (UserProfileSavePath).
Example: `Game.DeleteFilesInSavePath = [ "file.del", "me.too" ];`

### Game.DeleteOnClose
`DeleteOnClose: string[]`
Extra
Delete a file upon ending game session | Relative paths from root of game folder.
Example: `Game.DeleteOnClose = ["DeleteThis.exe"];`

### Game.Description
`Description: string`
Extra
Display a message to the end-user, that will appear when user selects the game of a handler| useful if there is anything the end-user needs to know before-hand | Only first two or three sentences will appear in UI, but full message can be viewed if user right clicks on the game in the list.
Example: `Game.Description = "Hello World";`

### Game.DesktopScale
`DesktopScale: number[]`

### Game.DirExclusions
`DirExclusions: string[]`
File System
Folders (+ all its contents) listed here will not be linked or copied over to Nucleus game content folder, the instance folders.
Example: `Game.DirExclusions = ["dir1"];`

### Game.DirSymlinkCopyInstead
`DirSymlinkCopyInstead: string[]`
File System
Copy (not symlink) all files within a given folder | Folder name is relative from root game folder.
Example: `Game.DirSymlinkCopyInstead = [ "folder1", "folder2" ];`

### Game.DirSymlinkCopyInsteadIncludeSubFolders
`DirSymlinkCopyInsteadIncludeSubFolders: boolean`
File System
When specifying folder(s) to copy all its contents instead of linking, should subfolders and files be included as well?
Example: `Game.DirSymlinkCopyInsteadIncludeSubFolders = false;`

### Game.DirSymlinkExclusions
`DirSymlinkExclusions: string[]`
File System
Array with the name of the folders you don't want Nucleus Co-op to symlink, only the folders placed here get hardcopied not the files.
Example: `Game.DirSymlinkExclusions = ["folder1", "folder2"];`

### Game.DocumentsConfigPath
`DocumentsConfigPath: string`
Nucleus Co-op Environment
Similar to UserProfileConfigPath, use this when the game uses Documents to store game files.
Example: `Game.DocumentsConfigPath = "Path\\Here";`

### Game.DocumentsConfigPathNoCopy
`DocumentsConfigPathNoCopy: boolean`
Nucleus Co-op Environment
When using DocumentsConfigPath, do not let Nucleus copy from original location to Nucleus Documents.
Example: `Game.DocumentsConfigPathNoCopy = false;`

### Game.DocumentsSavePath
`DocumentsSavePath: string`
Nucleus Co-op Environment
Similar to UserProfileSavePath, use this when the game uses Documents to store game files.
Example: `Game.DocumentsSavePath = "Path\\Here";`

### Game.DocumentsSavePathNoCopy
`DocumentsSavePathNoCopy: boolean`
Nucleus Co-op Environment
When using DocumentsSavePath, do not let Nucleus copy from original location to Nucleus Documents.
Example: `Game.DocumentsSavePathNoCopy = false;`

### Game.DontRemoveBorders
`DontRemoveBorders: boolean`
Window manipulation
Prevents Nucleus from removing game window borders.
Example: `Game.DontRemoveBorders = false;`

### Game.DontReposition
`DontReposition: boolean`
Window manipulation
Should Nucleus not reposition the game windows?.
Example: `Game.DontReposition = false;`

### Game.DontResize
`DontResize: boolean`
Window manipulation
Should Nucleus not resize the game windows?.
Example: `Game.DontResize = false;`

### Game.DpiAwarenessMode
`DpiAwarenessMode: Nucleus.DpiAwarenessMode | number | boolean`
default `DpiAwarenessMode.HighDpiAware`

### Game.DPIHandling
`DPIHandling: Nucleus.DPIHandling | number | boolean`
default `DPIHandling.True`
The way the games handles DPI scaling. Modify this if the game is presenting different sizing behaviour after the Windows 10 Creators Update. Values: True: True tries to send the correct width and height to the game's window. Nucleus.DPIHandling.Scaled: Scaled will scale the width and height by the DPI of the system (see that it's not per-monitor). Nucleus.DPIHandling.InvScaled: InvScaled will scale the width and height by 1 / DPI of the system (see that it's not per-monitor).

### Game.DrawFakeMouseCursor
`DrawFakeMouseCursor: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
This enables the fake mouse cursor to be drawn over the game by Nucleus Coop. 
 If the game uses a custom cursor, you will probably not need this option. (This will be obvious if you see the games custom cursor and a fake cursor drawn over it). 
 Be aware this is a 'fake' mouse cursor in the sense that Nucleus Coop will fake mouse input to the game via the other options and then the fake mouse cursor is drawn where the game should be responding to mouse input. 
 The fake cursor is drawn by creating a large transparent window over the game. This may prevent the game from receiving mouse input from the 'real' Windows cursor. It is sometimes useful to disable this while testing.
Example: `Game.DrawFakeMouseCursor = true;`

### Game.DrawFakeMouseCursorForControllers
`DrawFakeMouseCursorForControllers: boolean`
default `false`
If you are using controllers and need a fake mouse cursor, try these options
Example: `Game.DrawFakeMouseCursorForControllers = true; <br /> Game.UpdateFakeMouseWithInternalInput = true;`

### Game.EnableWindows
`EnableWindows: boolean`
Focus
Enable each game window at the end (useful if became disabled, or for some games that require this Window function to be called to display properly, after Nucleus setup).
Example: `Game.EnableWindows = false;`

### Game.EpicEmuArgs
`EpicEmuArgs: boolean`
Nemirtingas Epic Emulator
When using Nemirtinga's Epic Emulator, use pre-defined parameters -AUTH_LOGIN=unused -AUTH_PASSWORD=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb -AUTH_TYPE=exchangecode -epicapp=CrabTest -epicenv=Prod -EpicPortal -epicusername=\"" + \<Player Nickname here\> + "\" -epicuserid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA -epiclocale=en"
Example: `Game.EpicEmuArgs = false;`

### Game.EpicLang
`(read-only) EpicLang: string`
read-only

### Game.ExecutableContext
`ExecutableContext: string[]`
Array with the name of other files found in the executable's folder (so we don't confuse different games with similar file names). Example: Borderlands and Tales of the Borderlands share their executable name (borderlands.exe). We include 1 folder and a file that's unique to Borderlands to make sure the application doesn't confuse itself.

### Game.ExecutableName
`ExecutableName: string`
**required** · Game Info
The name of the game executable with the extension. This will be used by Nucleus to add games, to run the game and as process to follow for positioning and resizing.
Example: `Game.ExecutableName = "Game.exe";`

### Game.ExecutableNames
`ExecutableNames: string[]`
Alternative executable names this handler matches (e.g. different store versions).

### Game.ExecutableToLaunch
`ExecutableToLaunch: string`
Game Info
If the game is to launch a different executable, other than what Game.ExecutableName is.
Example: `Game.ExecutableToLaunch = "Game.exe";`

### Game.ExtWindowStyleEndChanges
`ExtWindowStyleEndChanges: string[]`
Window manipulation
docs.microsoft.com/en-us/windows/win32/winmsg/window-styles for values that can be used.
Example: `Game.ExtWindowStyleEndChanges = [ "~0xC00000", "0x8000000" ];`

### Game.ExtWindowStyleValues
`ExtWindowStyleValues: string[]`
Window manipulation
docs.microsoft.com/en-us/windows/win32/winmsg/window-styles for values that can be used.
Example: `Game.ExtWindowStyleValues = [ "~0x200", "0x200000" ];`

### Game.FakeFocus
`FakeFocus: boolean`
Focus
Enable or disable the sending of focus messages to each game window at a regular interval | default: false.
Example: `Game.FakeFocus = true;`

### Game.FakeFocusInstances
`FakeFocusInstances: string`
Focus
If you only want specific instances to have fake focus messages sent to, specify them in a comma seperated string.
Example: `Game.FakeFocusInstances = "1,2,3,4";`

### Game.FakeFocusInterval
`FakeFocusInterval: number`
default `1000` · Focus
The milliseconds between sending fake focus messages. Default at 1000, some rare games need this to be very low.
Example: `Game.FakeFocusInterval = 1000;`

### Game.FakeFocusSendActivate
`FakeFocusSendActivate: boolean`
default `true` · Focus
Should WM_ACTIVATE message be sent to each instance? | default: true.
Example: `Game.FakeFocusSendActivate = true;`

### Game.FakeFocusSendActivateIgnoreKB
`FakeFocusSendActivateIgnoreKB: boolean`

### Game.FileSymlinkCopyInstead
`FileSymlinkCopyInstead: string[]`
File System
Array with the name of the files you want Nucleus Co-op to make full copies of, in some cases games need certain files to be full copies or they won't run.
Example: `Game.FileSymlinkCopyInstead = ["file1.txt", "file2.txt"];`

### Game.FileSymlinkExclusions
`FileSymlinkExclusions: string[]`
File System
Array with the name of the files you don't want Nucleus Co-op to symlink, useful if you want to replace files or add external files.
Example: `Game.FileSymlinkExclusions = ["file1.txt", "file2.txt"];`

### Game.FlawlessWidescreen
`FlawlessWidescreen: string`
Additional Tools
Use Flawless Widescreen application | value must be the name of the game plugin folder in PluginCache\FWS_Plugins\Modules.
Example: `Game.FlawlessWidescreen = "FWGameName";`

### Game.FlawlessWidescreenOverrideDisplay
`FlawlessWidescreenOverrideDisplay: boolean`
Additional Tools
Example: `Game.FlawlessWidescreenOverrideDisplay = false;`

### Game.FlawlessWidescreenPluginPath
`FlawlessWidescreenPluginPath: string`

### Game.Folder
`(read-only) Folder: string`
read-only · Path variables
Path to the game handler folder (Nucleus-Coop\handlers\handler_folder).
Example: `Game.Folder`

### Game.ForceBindIPDelay
`ForceBindIPDelay: boolean`

### Game.ForceBindIPNoDummy
`ForceBindIPNoDummy: boolean`
default `false`

### Game.ForceDocumentsConfigCopy
`ForceDocumentsConfigCopy: boolean`
Nucleus Co-op Environment
When using DocumentsConfigPath, forces a file copy from original location to Nucleus Documents.
Example: `Game.ForceDocumentsConfigCopy = false;`

### Game.ForceDocumentsSaveCopy
`ForceDocumentsSaveCopy: boolean`
Nucleus Co-op Environment
When using DocumentsSavePath, forces a file copy from original location to Nucleus Documents.
Example: `Game.ForceDocumentsSaveCopy = false;`

### Game.ForceEnvironmentUse
`ForceEnvironmentUse: boolean`
Nucleus Co-op Environment
Forces use of custom environment variable when Game.ThirdPartyLaunch = true;
Example: `Game.ForceEnvironmentUse = true;`

### Game.ForceGameArch
`ForceGameArch: string`
Extra
Force Nucleus to treat the game as 32 or 64-bit architecture.
Example: `Game.ForceGameArch = "x86" (or "x64");`

### Game.ForceLauncherExeIgnoreFileCheck
`ForceLauncherExeIgnoreFileCheck: boolean`
File System
Forces LauncherExeIgnoreFileCheck when game isn't symlinked.
Example: `Game.ForceLauncherExeIgnoreFileCheck = false;`

### Game.ForceProcessPick
`ForceProcessPick: boolean`
Extra
Manually select the process that will be used for process manipulation, such as resizing, repositioning and used for post-launch hooks.
Example: `Game.ForceProcessPick = false;`

### Game.ForceProcessSearch
`ForceProcessSearch: boolean`
Extra
Force Nucleus to search for the game process.
Example: `Game.ForceProcessSearch = false;`

### Game.ForceSymlink
`ForceSymlink: boolean`
File System
Force game to be symlinked each time it is ran.
Example: `Game.ForceSymlink = false;`

### Game.ForceUserProfileConfigCopy
`ForceUserProfileConfigCopy: boolean`
Nucleus Co-op Environment
Force the games config files in UserProfileConfigPath to copy over from system user profile to Nucleus environment.
Example: `Game.ForceUserProfileConfigCopy = false;`

### Game.ForceUserProfileSaveCopy
`ForceUserProfileSaveCopy: boolean`
Nucleus Co-op Environment
Force the games save files in UserProfileSavePath to copy over from system user profile to Nucleus environment.
Example: `Game.ForceUserProfileSaveCopy = false;`

### Game.ForceWindowTitle
`ForceWindowTitle: boolean`
Focus
Forces the game window title to be whatever is specified in Game.Hook.ForceFocusWindowName (triggers once, after all instances have started) | default: false.
Example: `Game.ForceWindowTitle = false;`

### Game.ForwardRawKeyboardInput
`ForwardRawKeyboardInput: boolean`
default `false` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
The same as ForwardRawMouseInput, but for keyboards. Again, this should almost never be used instead of re-register raw input.
Example: `Game.ForwardRawKeyboardInput = false;`

### Game.ForwardRawMouseInput
`ForwardRawMouseInput: boolean`
default `false` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
In some cases, you may need to forward raw mouse input. This is almost never needed as re-register raw input has the same effect with a much more efficient method. Forwarding input forwards raw input from Nucleus Coop to the game. This has a high CPU usage and many input events will not pass, resulting in choppy movement.
Example: `Game.ForwardRawMouseInput = false;`

### Game.ForwardWindowToProtoInput
`ForwardWindowToProtoInput: boolean`

### Game.GameName
`GameName: string`
**required** · Game Info
Title of the game that will be shown in Nucleus.
Example: `Game.GameName = "Game Name";`

### Game.GamepadGuid
`GamepadGuid: string`

### Game.GamePlayAfterLaunch
`GamePlayAfterLaunch: boolean`

### Game.GamePlayBeforeGameSetup
`GamePlayBeforeGameSetup: boolean`
Extra
Game.GamePlayAfterLaunch;				//Call the Game.Play function after the call has launched.
Execute Game.Play function (context) before the majority of the game is setup.
Example: `Game.GamePlayBeforeGameSetup = false;`

### Game.GogLang
`(read-only) GogLang: string`
read-only

### Game.GoldbergExperimental
`GoldbergExperimental: boolean`
Goldberg Emulator
Use the experimental branch of Goldberg | Requires `Game.UseGoldberg = true` | default: false.
Example: `Game.GoldbergExperimental = false;`

### Game.GoldbergExperimentalRename
`GoldbergExperimentalRename: boolean`
Goldberg Emulator
Set to true to have Goldberg Experimental rename instanced steam_api(64).dll to cracksteam_api(64).dll.
Example: `Game.GoldbergExperimentalRename = false;`

### Game.GoldbergExperimentalSteamClient
`GoldbergExperimentalSteamClient: boolean`
Goldberg Emulator
Automatically setup Goldberg's Experimental Steam Client | Requires Game.UseGoldberg and the original steam_api.dll.
Example: `Game.GoldbergExperimentalSteamClient = false;`

### Game.GoldbergIgnoreSteamAppId
`GoldbergIgnoreSteamAppId: boolean`
Goldberg Emulator
When set to true, Goldberg will not create a steam_appid.txt file.
Example: `Game.GoldbergIgnoreSteamAppId = false;`

### Game.GoldbergLanguage
`GoldbergLanguage: string`
Goldberg Emulator
Manually specify what language you want Goldberg to use for the game | by default, Goldberg will use the language you chose in Steam.
Example: `Game.GoldbergLanguage = "english";`

### Game.GoldbergLobbyConnect
`GoldbergLobbyConnect: boolean`
Goldberg Emulator
Should Goldberg Lobby Connect be used to connect the instances.
Example: `Game.GoldbergLobbyConnect = false;`

### Game.GoldbergNeedSteamInterface
`GoldbergNeedSteamInterface: boolean`
Goldberg Emulator
Some older games require a steam_interfaces.txt file for Goldberg to work | Will first search orig game path and nucleus games path, if not found then tries to create one with the GoldbergNeedSteamInterface command.
Example: `Game.GoldbergNeedSteamInterface = false;`

### Game.GoldbergNoLocalSave
`GoldbergNoLocalSave: boolean`
Goldberg Emulator
Do not create a local_save.txt file for Goldberg, saves are to use default game save location.
Example: `Game.GoldbergNoLocalSave = false;`

### Game.GoldbergNoWarning
`GoldbergNoWarning: boolean`
default `false`

### Game.GoldbergWriteSteamIDAndAccount
`GoldbergWriteSteamIDAndAccount: boolean`
Goldberg Emulator
Force Goldberg to write account_name.txt and user_steam_id.txt | Requires Game.UseGoldberg;
Example: `Game.GoldbergWriteSteamIDAndAccount = false;`

### Game.GUID
`GUID: string`
**required** · Game Info
The name of the folder that will be created inside the Nucleus content folder (just use letters not symbols). In this folder Nucleus will store the symlinked or copied game files for each instance of the game.
Example: `Game.GUID = "Game Name";`

### Game.HandlerInterval
`HandlerInterval: number`
The interval in milliseconds the Handler should be updated at. Set it to 0 to disable updating (will lose all functionality that depends on ticks).
Example: `Game.HandlerInterval = 100;`

### Game.HardcopyGame
`HardcopyGame: boolean`
File System
Instead of Symlinking, create hard copies of the games files (copy/paste) | Be careful of storage, takes a LONG time to start a game when copying.
Example: `Game.HardcopyGame = true;`

### Game.HardlinkFoldersTo
`HardlinkFoldersTo: string[]`
File System
Hardlink folders in game root folder to another spot in game folder | Relative paths from root of game folder.
Example: `Game.HardlinkFoldersTo = ["folderToMove|whereToMoveIt"];`

### Game.HardlinkGame
`HardlinkGame: boolean`
File System
Hardlink files instead of Symlink (or hard copy) | Directories will still be symlinked but files will be hardlinked.
Example: `Game.HardlinkGame = false;`

### Game.HasDynamicWindowTitle
`HasDynamicWindowTitle: boolean`
Focus
Work-around for ForceFocusWindowName having to match 1:1 with game window title for resizing, positioning and focus | default: false.
Example: `Game.HasDynamicWindowTitle = false;`

### Game.HexEditAllExes
`HexEditAllExes: string[]`
File System
Will do a text value replacement in a file for every instance, accepts two parameters, one on what to look for, and what it should be replaced with (seperated with a "|") | Works with multiple values | Works in conjunction with HexEditExe (this will trigger first).
Example: `Game.HexEditAllExes = [ "before|afters" ];`

### Game.HexEditAllFiles
`HexEditAllFiles: string[]`
File System
Works same as HexEditAllExes function but with a file you specify as an extra parameter (first one) | filePath is relative path from the game root folder.
Example: `Game.HexEditAllFiles = [ "filePath|before|afters" ];`

### Game.HexEditExe
`HexEditExe: string[]`
File System
Will do a text value replacement in a file for a specific instance, accepts two parameters, one on what to look for, and what it should be replaced with (seperated with a "|") | Works with multiple values, each comma seperated string is the order of the instances | Works in conjunction with HexEditAllExe (this will trigger second).
Example: `Game.HexEditExe = [ "before|afters" ];`

### Game.HexEditExeAddress
`HexEditExeAddress: string[]`
File System
Use this to replace bytes in a file at a specified address, can be for specific instances with optional 3rd argument | 1st arg: instance # (optional), 2nd arg: hex address offset, 3rd arg: new bytes.
Example: `Game.HexEditExeAddress = [ "1|address|bytes" ];`

### Game.HexEditFile
`HexEditFile: string[]`
File System
Works same as HexEditExe function but with a file you specify as an extra parameter (first one) | filePath is relative path from the game root folder.
Example: `Game.HexEditFile = [ "filePath|before|afters" ];`

### Game.HexEditFileAddress
`HexEditFileAddress: string[]`

### Game.HideCursor
`HideCursor: boolean`
Extra
Hide the mouse cursor in game instances.
Example: `Game.HideCursor = true;`

### Game.HideDesktop
`HideDesktop: boolean`
Extra
Hide the desktop background with a solid black background.
Example: `Game.HideDesktop = false;`

### Game.HideTaskbar
`HideTaskbar: boolean`
Extra
Most games hide the taskbar when placed on-top but for games that don't you can use this.
Example: `Game.HideTaskbar = true;`

### Game.Hook
`(read-only) Hook: GameHook`
read-only · default `new GameHookInfo()`
Settings for Nucleus' custom xinput/x360ce hook DLL.

### Game.HookDontUpdateLegacyInMouseMsg
`HookDontUpdateLegacyInMouseMsg: boolean`
Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
****Nucleus Co-op will hook mouse movement messages and the GetCursorPos function to work around legacy input. Some games only need the GetCursorPos hook and conflict when mouse movement messages are edited. If this is the case, enable this option***
Example: `Game.HookDontUpdateLegacyInMouseMsg = false;`

### Game.HookFilterMouseMessages
`HookFilterMouseMessages: boolean`
Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
This hook filters many mouse messages to position the mouse cursor and other necessary changes from within the game itself. 
 This should almost always be enabled unless it causes some conflict.
Example: `Game.HookFilterMouseMessages = false;`

### Game.HookFilterRawInput
`HookFilterRawInput: boolean`
Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
This filters raw input messages inside the application. This makes sure each instance only receives input for its designated input device.
Example: `Game.HookFilterRawInput = false;`

### Game.HookFocus
`HookFocus: boolean`
Focus
Enable or disable hooks to trick the game into thinking it has focus | default: false.
Example: `Game.HookFocus = true;`

### Game.HookFocusInstances
`HookFocusInstances: string`

### Game.HookGetAsyncKeyState
`HookGetAsyncKeyState: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
HookGetAsyncKeyState is usually the only one that's needed, but leave the others enabled if there are no problems.
Example: `Game.HookGetAsyncKeyState = true;`

### Game.HookGetCursorPos
`HookGetCursorPos: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
This will hook the GetCursorPos Windows function which the game may use to get the mouse position.
Example: `Game.HookGetCursorPos = true;`

### Game.HookGetKeyboardState
`HookGetKeyboardState: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
Some games may conflict with these hooks, so try toggling some of them if keyboard input isn't working properly.
Example: `Game.HookGetKeyboardState = false;`

### Game.HookGetKeyState
`HookGetKeyState: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
These options hook Windows functions that can be used by the game to detect if keys are down.
Example: `Game.HookGetKeyState = false;`

### Game.HookInit
`HookInit: boolean`
Focus
Enable or disable hooks of functions some games may try and use to prevent multiple instances from running | default: false.
Example: `Game.HookInit = true;`

### Game.HookInitDelay
`HookInitDelay: boolean`

### Game.HookMouseVisibility
`HookMouseVisibility: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
Used for games that toggle the mouse visibility, e.g. hidden in first person movement and visible in menus. 
 This shows/hides the fake mouse cursor when the game tries to show/hide the 'real' mouse cursor. 
 ***!!!!Most of the time this one is the cause of crashes.!!!!***
Example: `Game.HookMouseVisibility = false;`

### Game.HookReRegisterRawInput
`HookReRegisterRawInput: boolean`
default `false` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
Re-register raw input from directly within game process | Recommended to disable forwarding input while using this
Example: `Game.HookReRegisterRawInput = false;`

### Game.HookReRegisterRawInputKeyboard
`HookReRegisterRawInputKeyboard: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
Example: `Game.HookReRegisterRawInputKeyboard = true;`

### Game.HookReRegisterRawInputMouse
`HookReRegisterRawInputMouse: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
Example: `Game.HookReRegisterRawInputMouse = true;`

### Game.HookSetCursorPos
`HookSetCursorPos: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
This will hook the SetCursorPos Windows function which the game may use to set the mouse position. 
 This is useful to have on to prevent the game from moving the 'real' Windows mouse cursor around the screen.
Example: `Game.HookSetCursorPos = true;`

### Game.HookUseLegacyInput
`HookUseLegacyInput: boolean`
Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
This is the main switch for legacy input.
Example: `Game.HookUseLegacyInput = false;`

### Game.Hub
`(read-only) Hub: Hub`
read-only · default `new Hub()`
Hub metadata, filled in by hub.splitscreen.me when the handler is published.

### Game.IdealProcessor
`IdealProcessor: number`
Extra
Sets the preferred processor for the game's threads, used when the system schedules threads, to determine which processor to run the thread on | default: system delegation.
Example: `Game.IdealProcessor = 2;`

### Game.IdInWindowTitle
`IdInWindowTitle: boolean`
Focus
Adds the process ID to the end of the window title.
Example: `Game.IdInWindowTitle = true;`

### Game.IgnoreDeleteFilesPrompt
`IgnoreDeleteFilesPrompt: boolean`
File System
Game.HexEditFileAddress = [ "1|relativePath|address|bytes" ]; //Same as HexEditExeAddress but for a file other than exe | Need to provide relative path (from game root folder) + filename as 1st or 2nd arg if not specifying an instance.
Do not display the warning message about a file being deleted .
Example: `Game.IgnoreDeleteFilesPrompt = false;`

### Game.IgnoreThirdPartyPrompt
`IgnoreThirdPartyPrompt: boolean`
Extra
Ignore the prompt that appears when using Game.ThirdPartyLaunch;
Example: `Game.IgnoreThirdPartyPrompt = false;`

### Game.IgnoreWindowBorderCheck
`IgnoreWindowBorderCheck: boolean`

### Game.InjectDinputToXinputTranslation
`InjectDinputToXinputTranslation: boolean`
default `false`
If you want to translate XInput to Dinput when using this restriction method + Game.Hook.XInputReroute = true;
Example: `Game.InjectDinputToXinputTranslation = true;`

### Game.InjectHookXinput
`InjectHookXinput: boolean`
default `false`
This method is the same used by Universal Split Screen (Hook Xinput for gamepads). It will make the instance redirect the controllers' input to a specific controller index. This restriction method doesn't create any files.
Example: `Game.InjectHookXinput = true;`

### Game.KeepAspectRatio
`KeepAspectRatio: boolean`
Window manipulation
Should the game window try and keep it's aspect ratio when being resized? | default: false.
Example: `Game.KeepAspectRatio = false;`

### Game.KeepMonitorAspectRatio
`KeepMonitorAspectRatio: boolean`
Window manipulation
Try and resize game window within player bounds to the aspect ratio of the monitor.
Example: `Game.KeepMonitorAspectRatio = false;`

### Game.KeepSymLinkOnExit
`KeepSymLinkOnExit: boolean`
File System
Enable or disable symlink files from being deleted when Nucleus is closed | default: false.
Example: `Game.KeepSymLinkOnExit = true;`

### Game.KeyboardPlayerFirst
`KeyboardPlayerFirst: boolean`
Input
If the keyboard player should be processed first.
Example: `Game.KeyboardPlayerFirst = true;`

### Game.KeyboardPlayerSkipFakeFocus
`KeyboardPlayerSkipFakeFocus: boolean`
Focus
Should the keyboard player instance be skipped when fake focus messages are being sent to.
Example: `Game.KeyboardPlayerSkipFakeFocus = false;`

### Game.KeyboardPlayerSkipPreventWindowDeactivate
`KeyboardPlayerSkipPreventWindowDeactivate: boolean`
Focus
Ignore PreventWindowDeactivation if player is using keyboard.
Example: `Game.KeyboardPlayerSkipPreventWindowDeactivate = false;`

### Game.KillLastInstanceMutex
`KillLastInstanceMutex: boolean`
Mutex
Kill the handles, specified in Game.KillMutex, in the last instance (normally last is ignored).
Example: `Game.KillLastInstanceMutex = false;`

### Game.KillMutex
`KillMutex: string[]`
Array of mutexes to kill before starting the next game process. A 'Mutex/Mutant' is a mutually exclusive flag, which basically tells the game not to allow multiple instances of its program.

### Game.KillMutexAtEnd
`KillMutexAtEnd: boolean`
Mutex
When using ProcessChangesAtEnd, should handles also be killed at the end?.
Example: `Game.KillMutexAtEnd = false;`

### Game.KillMutexDelay
`KillMutexDelay: number`
Mutex
\# of seconds to wait before killing the mutex | Only works with killing not renaming | default: 0.
Example: `Game.KillMutexDelay = 10;`

### Game.KillMutexDelayLauncher
`KillMutexDelayLauncher: number`

### Game.KillMutexDelayProcess
`KillMutexDelayProcess: number`
Mutex
When using Game.MutexProcessExe, wait for X number of seconds before beginning its mutex killing.
Example: `Game.KillMutexDelayProcess = 1000;`

### Game.KillMutexLauncher
`KillMutexLauncher: string[]`

### Game.KillMutexProcess
`KillMutexProcess: string[]`
Mutex
When using Game.MutexProcessExe, here you can specify the handles that need to be killed.
Example: `Game.KillMutexProcess = ["Mutexes","To","Close"];`

### Game.KillMutexType
`KillMutexType: string`
default `"Mutant"` · Mutex
Specify the type of mutex/handle to kill, for example "Mutant", "Event" or "Semaphore" | default: "Mutant".
Example: `Game.KillMutexType = "Mutant";`

### Game.KillMutexTypeLauncher
`KillMutexTypeLauncher: string`
default `"Mutant"`

### Game.KillMutexTypeProcess
`KillMutexTypeProcess: string`
default `"Mutant"` · Mutex
When using Game.MutexProcessExe, here you can specify the type of handles to kill.
Example: `Game.KillMutexTypeProcess = "Mutant";`

### Game.KillProcessesOnClose
`KillProcessesOnClose: string[]`
Extra
List of additional processes that need to be killed (other than executable and launcher).
Example: `Game.KillProcessesOnClose = [ "kill", "me" ];`

### Game.LaunchAsDifferentUsers
`LaunchAsDifferentUsers: boolean`
Extra
Launch each instance from a different user account | must run Nucleus as admin | will temporary create user accounts "nucleusplayerx" and delete them when closing Nucleus.
Example: `Game.LaunchAsDifferentUsers = false;`

### Game.LaunchAsDifferentUsersAlt
`LaunchAsDifferentUsersAlt: boolean`
Extra
An alternative method to launch each instance from a different user account | must run Nucleus as admin | will temporary create user accounts "nucleusplayerx" and delete them when closing Nucleus.
Example: `Game.LaunchAsDifferentUsersAlt = false;`

### Game.LauncherExe
`LauncherExe: string`
Game Info
If the game needs to go through a launcher before opening Nucleus will use this exe to start the game and it will still use the Game.ExecutableName process for positioning and resizing.
Example: `Game.LauncherExe = "Launcher.exe";`

### Game.LauncherExeIgnoreFileCheck
`LauncherExeIgnoreFileCheck: boolean`
File System
Do not check if Launcher Exe exists in game folder | you will need to provide a relative filepath from game root folder.
Example: `Game.LauncherExeIgnoreFileCheck = false;`

### Game.LauncherTitle
`LauncherTitle: string`
Game Info
The name of the launcher's window title. Some games need to go through a launcher to open. This is needed or else the application will lose the game's window.
Example: `Game.LauncherTitle = "Launcher Window Title";`

### Game.LockInputAtStart
`LockInputAtStart: boolean`
default `false` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
Once you have finished setting up the input options, enable this to automatically lock input (equivalent to pressing End) once all of the instances have been set up. 
 This is usually convenient to leave disabled whilst testing.
Example: `Game.LockInputAtStart = true;`

### Game.LockInputSuspendsExplorer
`LockInputSuspendsExplorer: boolean`
default `false`

### Game.LockInputToggleKey
`LockInputToggleKey: number`
default `0x23` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
See https://docs.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
Example: `Game.LockInputToggleKey = 0x23;`

### Game.LockMouse
`LockMouse: boolean`
If we should lock the mouse, requires Game.Hook.CustomDllEnabled = true;.

### Game.MaxPlayers
`MaxPlayers: number`
Game Info
This is just the max players info that shows under the handler name in Nucleus UI. Usually we write the max number of players the game supports. (PC, should support 16 max connected input devices).
Example: `Game.MaxPlayers = 16;`

### Game.MaxPlayersOneMonitor
`MaxPlayersOneMonitor: number`
Game Info
This is just info. It will not limit the players number.
Example: `Game.MaxPlayersOneMonitor = 4;`

### Game.MutexProcessExe
`MutexProcessExe: string`
Mutex
Specify another executable to kill handles for.
Example: `Game.MutexProcessExe = "Process.exe";`

### Game.NeedsSteamEmulation
`NeedsSteamEmulation: boolean`
Smart Steam Emulator
If the game needs a fake Steam wrapper (SSE) to run multiple instances (this is not needed if you are using the new use Goldberg emulator line).
Example: `Game.NeedsSteamEmulation = false;`

### Game.NeedSteamClient
`NeedSteamClient: boolean`

### Game.NotTopMost
`NotTopMost: boolean`
Window manipulation
Should Nucleus not make the game windows top most (appear above everything else).
Example: `Game.NotTopMost = false;`

### Game.OnCustomHotKey_1
`OnCustomHotKey_1: () => void`
Called when the first custom hotkey from `Game.CustomHotkeys` is pressed.

### Game.OnCustomHotKey_2
`OnCustomHotKey_2: () => void`
Called when the second custom hotkey from `Game.CustomHotkeys` is pressed.

### Game.OnCustomHotKey_3
`OnCustomHotKey_3: () => void`
Called when the third custom hotkey from `Game.CustomHotkeys` is pressed.

### Game.OnFinishedSetup
`OnFinishedSetup: () => void`
Called once all instances have been set up.

### Game.OnStop
`OnStop: () => void`
Called when the session is stopped.

### Game.OrigSteamDllPath
`OrigSteamDllPath: string`
Goldberg Emulator
If steam_interface.txt is required, provide full path here to the original steam_api(64).dll and Nucleus will create one if it can't find an existing copy.
Example: `Game.OrigSteamDllPath = "C:\full path\steam_api.dll";`

### Game.PartialMutexSearch
`PartialMutexSearch: boolean`
Mutex
When killing handles, should a partial search be done with the handle name? | Renaming handles requires an exact match | default: false.
Example: `Game.PartialMutexSearch = false;`

### Game.PartialMutexSearchLauncher
`PartialMutexSearchLauncher: boolean`

### Game.PartialMutexSearchProcess
`PartialMutexSearchProcess: boolean`
Mutex
When using Game.MutexProcessExe, here you can specify if you want to do a partial search for handles.
Example: `Game.PartialMutexSearchProcess = false;`

### Game.PauseBeforeMutexKilling
`PauseBeforeMutexKilling: number`
Mutex
Wait for X number of seconds before proceeding with mutex killing.
Example: `Game.PauseBeforeMutexKilling = 1000;`

### Game.PauseBetweenContextAndLaunch
`PauseBetweenContextAndLaunch: number`
Extra
Number of seconds to wait after running additional files but before continuing with player setup.
Example: `Game.PauseBetweenContextAndLaunch = 0;`

### Game.PauseBetweenProcessGrab
`PauseBetweenProcessGrab: number`
Extra
How many seconds to wait after launching game (or launcher) but before grabbing game process.
Example: `Game.PauseBetweenProcessGrab = 30;`

### Game.PauseBetweenStarts
`PauseBetweenStarts: number`
Pause between game intances starts in milliseconds.
Example: `Game.PauseBetweenStarts = 20;`

### Game.PauseCMDBatchAfter
`PauseCMDBatchAfter: number`
Extra
Wait for X number of seconds before proceeding with CMDBatchAfter.
Example: `Game.PauseCMDBatchAfter = 10;`

### Game.PauseCMDBatchBefore
`PauseCMDBatchBefore: number`
Extra
Wait for X number of seconds before proceeding with CMDBatchBefore.
Example: `Game.PauseCMDBatchBefore = 10;`

### Game.Play
`Play: () => void`
Called once per instance, right before the game process is started. `Context`, `Player`, `PlayerList` and `Handler` are available inside this function.

### Game.PlayersPerInstance
`PlayersPerInstance: number`
Input
If using XInputPlus or X360ce and there are multiple players playing the same instance, set the # per instance here.
Example: `Game.PlayersPerInstance = 2;`

### Game.PlayerSteamIDs
`PlayerSteamIDs: string[]`
Goldberg Emulator
A list of steam IDs to be used instead of the pre-defined ones Nucleuses uses | IDs will be used in order they are placed, i.e. instance 1 will be first non-empty string in array.
Example: `Game.PlayerSteamIDs = ["76561198134585131","76561198134585132"];`

### Game.PostHookInstances
`PostHookInstances: string`
Focus
If you only want specific instances to have post launch hooks, specify them in a comma seperated string.
Example: `Game.PostHookInstances = "1,2,3,4";`

### Game.PreventGameFocus
`PreventGameFocus: boolean`
default `false` · Focus
Makes sure all the game windows are unfocused so nothing received double input from Windows.
Example: `Game.PreventGameFocus = false;`

### Game.PreventWindowDeactivation
`PreventWindowDeactivation: boolean`
Focus
Blocks the processing of all the windows messages that get sent when the window loses focus.
Example: `Game.PreventWindowDeactivation = false;`

### Game.ProcessChangesAtEnd
`ProcessChangesAtEnd: boolean`
Focus
Do the resizing, repositioning and post-launch hooking of all game instances at the very end | will not work with every option ran normally.
Example: `Game.ProcessChangesAtEnd = false;`

### Game.ProcessorPriorityClass
`ProcessorPriorityClass: string`
Extra
Game.WriteToProcessMemory 				//(undocumented)
Sets the overall priority category for the associated process. Can be "AboveNormal", "High" or "RealTime" | default: "Normal".
Example: `Game.ProcessorPriorityClass = "Normal";`

### Game.PromptAfterFirstInstance
`PromptAfterFirstInstance: boolean`
Extra
Show a prompt that user must click on ok to continue, after the first instance is setup.
Example: `Game.PromptAfterFirstInstance = false;`

### Game.PromptBeforeProcessGrab
`PromptBeforeProcessGrab: boolean`

### Game.PromptBetweenInstances
`PromptBetweenInstances: boolean`
Extra
Prompt the user with a messagebox to let the user decide when to open the next instance | default: false, PauseBetweenStarts STILL required.
Example: `Game.PromptBetweenInstances = true;`

### Game.PromptBetweenInstancesEnd
`PromptBetweenInstancesEnd: boolean`
Focus
If ProcessChangesAtEnd = true, show a prompt between each instance being changed.
Example: `Game.PromptBetweenInstancesEnd = false;`

### Game.PromptProcessChangesAtEnd
`PromptProcessChangesAtEnd: boolean`
Focus
If ProcessChangesAtEnd = true, pause and show a prompt, before making changes to processes.
Example: `Game.PromptProcessChangesAtEnd = false;`

### Game.ProtoInput
`(read-only) ProtoInput: GameProtoInput`
read-only · default `new ProtoInputOptions()`
Proto Input options (multiple mice/keyboards, focus hooks, input redirection). See https://www.splitscreen.me/docs/protoinput

### Game.RefreshWindowAfterStart
`RefreshWindowAfterStart: boolean`
default `false` · Window manipulation
Should each game window be minimized and restored once all instances are opened?.
Example: `Game.RefreshWindowAfterStart = false;`

### Game.RenameAndOrMoveFiles
`RenameAndOrMoveFiles: string[]`

### Game.RenameNotKillMutex
`RenameNotKillMutex: boolean`
Mutex
Instead of killing the mutex or handle, rename it on startup to something else | Requires Game.KillMutex to contain the EXACT name of the handles for this to work (no partial).
Example: `Game.RenameNotKillMutex = true;`

### Game.RequiresAdmin
`RequiresAdmin: boolean`
Extra
Game requires Nucleus to be run as administrator (this option will check and advise if detected not running Nucleus as admin).
Example: `Game.RequiresAdmin = false;`

### Game.ResetWindows
`ResetWindows: boolean`
Window manipulation
After each new instance opens, resize, reposition and remove borders of the previous instance.
Example: `Game.ResetWindows = false;`

### Game.RunLauncherAndExe
`RunLauncherAndExe: boolean`
File System
When using Game.LauncherExe, should ExecutableName also be launched?
Forces LauncherExeIgnoreFileCheck when game isn't symlinked.
Example: `Game.RunLauncherAndExe = false;`

### Game.SaveAndEditCustomUserGeneralValues
`SaveAndEditCustomUserGeneralValues: boolean`
Custom prompts
Example: `Game.SaveAndEditCustomUserGeneralValues = false;`

### Game.SaveAndEditCustomUserInstanceValues
`SaveAndEditCustomUserInstanceValues: boolean`
Custom prompts
Example: `Game.SaveAndEditCustomUserInstanceValues = false;`

### Game.SaveAndEditCustomUserPlayerValues
`SaveAndEditCustomUserPlayerValues: boolean`
Custom prompts
Example: `Game.SaveAndEditCustomUserPlayerValues = false;`

### Game.SaveCustomUserGeneralValues
`SaveCustomUserGeneralValues: boolean`
Custom prompts
Example: `Game.SaveCustomUserGeneralValues = false;`

### Game.SaveCustomUserInstanceValues
`SaveCustomUserInstanceValues: boolean`
Custom prompts
Example: `Game.SaveCustomUserInstanceValues = false;`

### Game.SaveCustomUserPlayerValues
`SaveCustomUserPlayerValues: boolean`
Custom prompts
Example: `Game.SaveCustomUserPlayerValues = false;`

### Game.SDLPaths
`SDLPaths: string[]`
Relative to instanced game directory root

### Game.SendFakeFocusMsg
`SendFakeFocusMsg: boolean`

### Game.SendNormalKeyboardInput
`SendNormalKeyboardInput: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
This sends keyboard input via Windows messages. This is usually all that's needed to get keyboard input working.
Example: `Game.SendNormalKeyboardInput = true;`

### Game.SendNormalMouseInput
`SendNormalMouseInput: boolean`
default `true` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
This will send the game mouse input via Windows messages.
Example: `Game.SendNormalMouseInput = true;`

### Game.SendScrollWheel
`SendScrollWheel: boolean`
default `false` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
Use this to send scroll wheel events to the game. 
 Some games don't need this, if for example they receive scroll wheel data from raw input.
Example: `Game.SendScrollWheel = false;`

### Game.SetForegroundWindowElsewhere
`SetForegroundWindowElsewhere: boolean`
Focus
Set the foreground window to be something other than game windows.
Example: `Game.SetForegroundWindowElsewhere = false;`

### Game.SetTopMostAtEnd
`SetTopMostAtEnd: boolean`
Window manipulation
Set the game windows to top most at the very end.
Example: `Game.SetTopMostAtEnd = true;`

### Game.SetupSse
`SetupSse: () => void`
Called to set up Smart Steam Emulator.

### Game.SetWindowHook
`SetWindowHook: boolean`
Window manipulation
Prevent games from resizing their windows on their own | Hooks after all instances have been opened (see Game.SetWindowHookStart for an alternative).
Example: `Game.SetWindowHook = true;`

### Game.SetWindowHookStart
`SetWindowHookStart: boolean`
Window manipulation
Prevent games from resizing window their windows on their own | Hooks upon game starting up (see Game.SetWindowHook for an alternative).
Example: `Game.SetWindowHookStart = false;`

### Game.ShowOptionAsStep
`ShowOptionAsStep(optionKey: string | number | boolean, required: boolean, title: string | number | boolean): CustomStep`
Shows a previously added option as its own setup step before launching.

### Game.SplitDivCompatibility
`SplitDivCompatibility: boolean`
default `true` · Extra
Explicitly disable splitscreen divisons if the game is known to be imcompatible with it.(Does not require to be true for compatible game)Default = true.
Example: `Game.SplitDivCompatibility = false;`

### Game.SSEAdditionalLines
`SSEAdditionalLines: string[]`
Smart Steam Emulator
When using Game.NeedsSteamEmulation, here you can provide additional lines to write to the SSE ini file.
Example: `Game.SSEAdditionalLines = ["Section|Key=Value"];`

### Game.StartArguments
`StartArguments: string`
Adds whatever you put into the field as starting parameters for the game's executable. For example, in most cases '-windowed' will force windowed mode. Parameters can be chained. Necessary for some games.

### Game.StartHookInstances
`StartHookInstances: string`
Focus
If you only want specific instances to have starting hooks, specify them in a comma seperated string.
Example: `Game.StartHookInstances = "1,2,3,4";`

### Game.SteamID
`SteamID: string`
Here the SteamID of the game. You can find it on https://steamdb.info/ . Add only if the game is available on Steam.
Example: `Game.SteamID = "1234";`

### Game.SteamLang
`(read-only) SteamLang: string`
read-only

### Game.SteamlessArgs
`SteamlessArgs: string`
Additional Tools
Use this when using Game.UseSteamless = true; always, the command line version of Steamless allows for different launch arguments to be used.
Example: `Game.SteamlessArgs = "--quiet --keepbind";`

### Game.SteamlessPatch
`SteamlessPatch: string[]`
bool apply to launcher,string Steamless Args,int wait for exe patching finished.

### Game.SteamlessTiming
`SteamlessTiming: number`
default `2500` · Additional Tools
The time in milliseconds to give Steamless to patch the game .exe. 2500 is the default value and will be applied even if the timing line has not been added in a handler.
Example: `Game.SteamlessTiming = 2500;`

### Game.SteamStubDRMPatcherArch
`SteamStubDRMPatcherArch: string`
Additional Tools
Force Steam Stub DRM Patcher to use either the x64 or x86 dll | Values: "64" or "86".
Example: `Game.SteamStubDRMPatcherArch = "64";`

### Game.SupportsKeyboard
`SupportsKeyboard: boolean`
Input
Enable/disable use of one keyboard/mouse player.
Example: `Game.SupportsKeyboard = true;`

### Game.SupportsMultipleKeyboardsAndMice
`SupportsMultipleKeyboardsAndMice: boolean`
Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
If enabled, it will allow multiple Keyboards and Mice to be used as a device input in Nucleus. Before enabling it by default, be sure that all works without problems.
Example: `Game.SupportsMultipleKeyboardsAndMice = true;`

### Game.SupportsPositioning
`SupportsPositioning: boolean`
Chooses whether or not to automatically move the windows around to fit in the right spaces.

### Game.SymlinkExe
`SymlinkExe: boolean`
File System
If SymlinkGame is enabled, if we should copy or symlink the game executable.
Example: `Game.SymlinkExe = false;`

### Game.SymlinkFiles
`SymlinkFiles: string[]`
File System
Symlink individual files from the game directory to the instanced folder.
Example: `Game.SymlinkFiles = ["game.exe","settings.cfg"];`

### Game.SymlinkFolders
`SymlinkFolders: boolean`
File System
Folders by default are hardcopied, with this enabled, folders will be symlinked instead | warning files placed in symlink folders will appear in the original game files too.
Example: `Game.SymlinkFolders = false;`

### Game.SymlinkFoldersTo
`SymlinkFoldersTo: string[]`
File System
Symlink folders in game root folder to another spot in game folder | Relative paths from root of game folder.
Example: `Game.SymlinkFoldersTo = ["folderToMove|whereToMoveIt"];`

### Game.SymlinkGame
`SymlinkGame: boolean`
File System
If we should symbolic link the game's files to a temporary directory (Nucleus instances folders in its content folder). If not will launch straight from the installation directory.
Example: `Game.SymlinkGame = true;`

### Game.ThirdPartyLaunch
`ThirdPartyLaunch: boolean`
Extra
Use if the game is launched outside of Nucleus | NOTE: You will not be able to use start up hooks or CMDLaunch with this option.
Example: `Game.ThirdPartyLaunch = false;`

### Game.ToggleUnfocusOnInputsLock
`ToggleUnfocusOnInputsLock: boolean`
default `false`
v.2.1.2 see RawInputProcessor & GenericGameHandler

### Game.TransferNucleusUserAccountProfiles
`TransferNucleusUserAccountProfiles: boolean`
Extra
Will backup and restore Nucleus user account user profile's on windows between sessions (when user accounts are not kept).
Example: `Game.TransferNucleusUserAccountProfiles = false;`

### Game.UpdateFakeMouseWithInternalInput
`UpdateFakeMouseWithInternalInput: boolean`
default `false` · Support for multiple mice and keyboards
**Deprecated: use Proto Input instead (see https://www.splitscreen.me/docs/protoinput).**
Example: `Game.UpdateFakeMouseWithInternalInput = false;`

### Game.UseCurrentUserEnvironment
`UseCurrentUserEnvironment: boolean`
default `false` · Nucleus Co-op Environment
Force the game to use the current user's environment (useful for some games that may require different Window user accounts).
Example: `Game.UseCurrentUserEnvironment = false;`

### Game.UseDevReorder
`UseDevReorder: boolean`
Input
Set up Devreorder.
Example: `Game.UseDevReorder = true;`

### Game.UseDI8CoopLvlUnlocker
`UseDI8CoopLvlUnlocker: boolean`

### Game.UseDInputBlocker
`UseDInputBlocker: boolean`
Input
Setup wizark952's dinput blocker (block dinput for the game).
Example: `Game.UseDInputBlocker = false;`

### Game.UseDirectX9Wrapper
`UseDirectX9Wrapper: boolean`
Extra
Use a Direct X wrapper to try and force DirectX 9 games to run windowed.
Example: `Game.UseDirectX9Wrapper = false;`

### Game.UseEACBypass
`UseEACBypass: boolean`
Additional Tools
Replace any EasyAntiCheat_(x86)(x64).dll with a bypass dll.
Example: `Game.UseEACBypass = false;`

### Game.UseForceBindIP
`UseForceBindIP: boolean`
Network
Set up game instances with ForceBindIP; each instance having their own IP.
Example: `Game.UseForceBindIP = false;`

### Game.UseGoldberg
`UseGoldberg: boolean`
Goldberg Emulator
Use the built-in Goldberg features in Nucleus | default: false.
Example: `Game.UseGoldberg = false;`

### Game.UseGoldbergNoOGSteamDlls
`UseGoldbergNoOGSteamDlls: boolean`

### Game.UseHandlerSteamIds
`UseHandlerSteamIds: boolean`

### Game.UseManualProtoControllersSetup
`UseManualProtoControllersSetup: boolean`
default `false`

### Game.UseNemirtingasEpicEmu
`UseNemirtingasEpicEmu: boolean`
Nemirtingas Epic Emulator
Automatically set up Nemirtinga's Epic Emulator in Nucleus
Example: `Game.UseNemirtingasEpicEmu = false;`

### Game.UseNemirtingasGalaxyEmu
`UseNemirtingasGalaxyEmu: boolean`
Nemirtingas Galaxy GoG Emulator
Nemirtinga's Galaxy Emulator works by substituting the game's Galaxy64.dll file with its own custom dll.

First, set up Nemirtinga's Galaxy Emulator in Nucleus.
Example: `Game.UseNemirtingasGalaxyEmu = true;`

### Game.UseNucleusEnvironment
`UseNucleusEnvironment: boolean`
Nucleus Co-op Environment
Use custom environment variables for games that use them, replaces some common paths (e.g. AppData) with C:\Users\\<your username\>\NucleusCoop.
Example: `Game.UseNucleusEnvironment = false;`

### Game.UseProcessor
`UseProcessor: string`
Extra
Sets the processors on which the game's threads can run on (provide the # of the cores in a comma-seperated list in quotations) | default: system delegation.
Example: `Game.UseProcessor = "1,2,3,4";`

### Game.UseProcessorsPerInstance
`UseProcessorsPerInstance: string[]`
Extra
Sets the processors on which an instances game's threads can run on (provide the # of the cores in a comma-seperated list in quotations) | default: system delegation.
Example: `Game.UseProcessorsPerInstance = [ "1,2","3,4" ];`

### Game.UserProfileConfigPath
`UserProfileConfigPath: string`
Nucleus Co-op Environment
Relative path from user profile (e.g. C:\Users\ZeroFox) to game's config path | Used to provide some extra functionality (open/delete/copy over to Nucleus Environment).
Example: `Game.UserProfileConfigPath = "AppData\\Local\\Game\\Config";`

### Game.UserProfileConfigPathNoCopy
`UserProfileConfigPathNoCopy: boolean`
Nucleus Co-op Environment
Do not copy files from original UserProfileConfigPath if using Nucleus Environment.
Example: `Game.UserProfileConfigPathNoCopy = false;`

### Game.UserProfileSavePath
`UserProfileSavePath: string`
Nucleus Co-op Environment
Relative path from user profile (e.g. C:\Users\ZeroFox) to game's save path | Used to provide some extra functionality (open/delete/copy over to Nucleus Environment).
Example: `Game.UserProfileSavePath = "AppData\\Local\\Game\\Saves";`

### Game.UserProfileSavePathNoCopy
`UserProfileSavePathNoCopy: boolean`
Nucleus Co-op Environment
Do not copy files from original UserProfileSavePath if using Nucleus Environment.
Example: `Game.UserProfileSavePathNoCopy = false;`

### Game.UseSteamless
`UseSteamless: boolean`
default `false` · Additional Tools
Use atom0s' Steamless app to remove Steam Stub DRM from a protected executable.
Example: `Game.UseSteamless = true;`

### Game.UseSteamStubDRMPatcher
`UseSteamStubDRMPatcher: boolean`
Additional Tools
Use UberPsyX's Steam Stub DRM Patcher to remove Steam Stub DRM from a protected executable.
Example: `Game.UseSteamStubDRMPatcher = false;`

### Game.UseX360ce
`UseX360ce: boolean`
Input
Before launching any games, Nucleus Co-op will open x360ce and let the user set up their controllers before continuing | close x360ce to continue | Don't use with custom dlls.
Example: `Game.UseX360ce = true;`

### Game.WindowStyleEndChanges
`WindowStyleEndChanges: string[]`
Window manipulation
docs.microsoft.com/en-us/windows/win32/winmsg/window-styles for values that can be used.
Example: `Game.WindowStyleEndChanges = [ "~0xC00000", "0x8000000" ];`

### Game.WindowStyleValues
`WindowStyleValues: string[]`
Window manipulation
docs.microsoft.com/en-us/windows/win32/winmsg/window-styles for values that can be used.
Example: `Game.WindowStyleValues = [ "~0xC00000", "0x8000000" ];`

### Game.WorkingFolder
`WorkingFolder: string`
Relative path to where Nucleus should start the game's working folder to. Example: The main executable is on the root directory (left4dead2.exe), but the game expects to be started with a working folder of 'bin' (all the game's libraries are there).

### Game.WriteToProcessMemory
`WriteToProcessMemory: string`

### Game.X360ceDll
`X360ceDll: string[]`
Input
If x360ce dll should be named something OTHER than xinput1_3.dll | requires Game.Usex360ce to be set to true.
Example: `Game.X360ceDll = [ "xinput1_3.dll" ];`

### Game.XboxOneControllerFix
`XboxOneControllerFix: boolean`
Input
When using x360ce, this will set certain hooktype that may work for xbox one controllers if the normal method does not work.
Example: `Game.XboxOneControllerFix = false;`

### Game.XInputPlusDll
`XInputPlusDll: string[]`
Input
Set up XInputPlus | If multiple dlls required, use comma seperated strings.
Example: `Game.XInputPlusDll = ["xinput1_3.dll"];`

### Game.XInputPlusNoIni
`XInputPlusNoIni: boolean`
Input
Do not copy XInputPlus' ini when using Game.XInputPlusDll.
Example: `Game.XInputPlusNoIni = false;`

### Game.XInputPlusOldDll
`XInputPlusOldDll: boolean`
Input
When using Game.XInputPlusDll, you can specify to use the previous version instead of latest (needed for some games).
Example: `Game.XInputPlusOldDll = false;`

## Game.Hook

Custom xinput/x360ce hook settings (`Game.Hook`).

### Game.Hook.BlockInputEvents
`BlockInputEvents: boolean`
default `true`
If force focus is enabled, this blocks all input events but gamepad.

### Game.Hook.BlockKeyboardEvents
`BlockKeyboardEvents: boolean`
default `true`
If force focus is enabled, this blocks all keyboard input.

### Game.Hook.BlockMouseEvents
`BlockMouseEvents: boolean`
default `true`
If force focus is enabled, this blocks all mouse input.

### Game.Hook.CustomDllEnabled
`CustomDllEnabled: boolean`
default `true`
Game.Hook.XInputNames = [ "xinput1_3.dll"]; //This line specify which DLLS CustomDll will use. DInput dlls are not supported.
Example: `Game.Hook.CustomDllEnabled = false;`

### Game.Hook.DInputEnabled
`DInputEnabled: boolean`
If enabled, will allow DInput devices to be used as a device input in Nucleus. This doesn't mean that it will work with the game if not supported.
Example: `Game.Hook.DInputEnabled = false;`

### Game.Hook.DInputForceDisable
`DInputForceDisable: boolean`
If we should completely remove support for DirectInput input from the game
Example: `Game.Hook.DInputForceDisable = true;`

### Game.Hook.EnableMKBInput
`EnableMKBInput: boolean`
default `false` · Input
Enable Mouse/Keyboard input for instances when using Alpha 10 custom xinput dll (normally MKB is restricted).
Example: `Game.Hook.EnableMKBInput = false;`

### Game.Hook.FixPosition
`FixPosition: boolean`
default `false` · Window manipulation
Should the custom dll do the repositioning? | Only works with Alpha 10 custom dll | default: false.
Example: `Game.Hook.FixPosition = false;`

### Game.Hook.FixResolution
`FixResolution: boolean`
default `false` · Window manipulation
Should the custom dll do the resizing? | Only works with Alpha 10 custom dll | default: false.
Example: `Game.Hook.FixResolution = false;`

### Game.Hook.ForceFocus
`ForceFocus: boolean`
If our custom x360ce xinput DLL should hook into the game's window and fake Window's events so we never leave focus.
Example: `Game.Hook.ForceFocus = true;`

### Game.Hook.ForceFocusWindowName
`ForceFocusWindowName: string`
default `""`
If force focus is enabled, this is the window we are attaching ourselves to and the window we are going to keep on top. Needs the exact name of the window. If force focus is disabled you still need to set the game window name for resizing and positioning.
Example: `Game.Hook.ForceFocusWindowName = "Game window title";`

### Game.Hook.ResHeight
`ResHeight: number`
default `0` · Window manipulation
If manual resizing, what is the window's height | If both ResWidth and ResHeight value > 0, window will be positioned manually.
Example: `Game.Hook.ResHeight = 720;`

### Game.Hook.ResWidth
`ResWidth: number`
default `0` · Window manipulation
If manual resizing, what is the window's width | If both ResWidth and ResHeight value > 0, window will be positioned manually.
Example: `Game.Hook.ResWidth = 1280;`

### Game.Hook.SDL2Enabled
`SDL2Enabled: boolean`
If the game supports sdl2 joysticks(not a hook)

### Game.Hook.SetWindowSize
`SetWindowSize: boolean`
If our custom dll should set the window size and position locally, instead of the handler (inconsistent with some window sizes, look at Borderlands2.js for an example usage)

### Game.Hook.UseAlpha8CustomDll
`UseAlpha8CustomDll: boolean`
default `false` · Input
Use the xinput custom dll from Alpha 8 instead of Alpha 10 | Will still force alpha 10 custom dll if game is x64.
Example: `Game.Hook.UseAlpha8CustomDll = false;`

### Game.Hook.WindowX
`WindowX: number`
default `0` · Window manipulation
If manual positioning, what is the window's X coordinate | If both X and Y value > 0, window will be positioned manually.
Example: `Game.Hook.WindowX = 0;`

### Game.Hook.WindowY
`WindowY: number`
default `0` · Window manipulation
If manual positioning, what is the window's Y coordinate | If both X and Y value > 0, window will be positioned manually.
Example: `Game.Hook.WindowY = 0;`

### Game.Hook.XInputCopies
`XInputCopies: string[]`
default `new string[]`

### Game.Hook.XInputEnabled
`XInputEnabled: boolean`
If enabled, will allow XInput devices to be used as a device input in Nucleus. This doesn't mean that it will work with the game if not supported.
Example: `Game.Hook.XInputEnabled = true;`

### Game.Hook.XInputNames
`XInputNames: string[]`
default `new string[]`
The name of our custom DLL for gamepad control, some games need other names like xinput1_4.dll, xinput1_2.dll, xinput1_1.dll and xinput9_1_0.dll.

### Game.Hook.XInputReroute
`XInputReroute: boolean`
default `false`
If enabled, will allow XInput devices to act like DInput devices. This allows using more than 4 controllers. You can use only ONE XboxOne controller and you can't use at the same time the keyboard. You must click/alt+tab on the corresponding instance to make it work. In alternative, you can try to fix the problem by doing this [workaround](http://www.snes9x.com/phpbb3/viewtopic.php?t=27510) or try Xoutput.
Example: `Game.Hook.XInputReroute = false;`

## Game.ProtoInput

Proto Input options (`Game.ProtoInput`).

### Game.ProtoInput.AdjustWindowRectHook
`AdjustWindowRectHook: boolean`

### Game.ProtoInput.AllowFakeCursorOutOfBounds
`AllowFakeCursorOutOfBounds: boolean`
Proto Input
Example: `Game.ProtoInput.AllowFakeCursorOutOfBounds = true;`

### Game.ProtoInput.AutoHideTaskbar
`AutoHideTaskbar: boolean`
Proto Input
Example: `Game.ProtoInput.AutoHideTaskbar = true;`

### Game.ProtoInput.BlockedMessages
`BlockedMessages: number[]`
Proto Input
Blocks calls to GetRegisteredRawInputDevices and GetRawInputDeviceList to prevent the game from detecting raw input devices. You will usually need to use startup injection with this hook. If you enable this hook, you should **disable** the raw input filter, and add a block to WM_INPUT, like so: `Game.ProtoInput.BlockedMessages = [ 0x00FF ];`
Example: `Game.ProtoInput.BlockedMessages = [ 0x00FF ];`

### Game.ProtoInput.BlockRawInputHook
`BlockRawInputHook: boolean`
Proto Input
Blocks calls to GetRegisteredRawInputDevices and GetRawInputDeviceList to prevent the game from detecting raw input devices. You will usually need to use startup injection with this hook. If you enable this hook, you should **disable** the raw input filter, and add a block to WM_INPUT, like so: `Game.ProtoInput.BlockedMessages = [ 0x00FF ];`
Example: `Game.ProtoInput.BlockRawInputHook = true;`

### Game.ProtoInput.ClipCursorHook
`ClipCursorHook: boolean`
Proto Input
Prevents the game from setting a bounding region about the mouse cursor. Some games will repeatedly clip the cursor when they receive the fake focus, so this should almost always be enabled. Fake clip means that if the game tries to clip (i.e. bound) the real cursor, it will bound the fake cursor instead.
Example: `Game.ProtoInput.ClipCursorHook = true;`

### Game.ProtoInput.ClipCursorHookCreatesFakeClip
`ClipCursorHookCreatesFakeClip: boolean`
Proto Input
Prevents the game from setting a bounding region about the mouse cursor. Some games will repeatedly clip the cursor when they receive the fake focus, so this should almost always be enabled. Fake clip means that if the game tries to clip (i.e. bound) the real cursor, it will bound the fake cursor instead.
Example: `Game.ProtoInput.ClipCursorHookCreatesFakeClip = true;`

### Game.ProtoInput.CreateSingleHIDHook
`CreateSingleHIDHook: boolean`
Proto Input
Hooks CreateFile so the game can only open the HID for the selected device (in Nucleus). This will usually require using startup injection.
Example: `Game.ProtoInput.CreateSingleHIDHook = true;`

### Game.ProtoInput.CursorVisibilityHook
`CursorVisibilityHook: boolean`
Proto Input
Monitors when the game tries to hide the cursor (e.g. when you close the menu in a first person game), and sets the visibility of the fake cursor instead. Should be almost always be enabled, except sometimes during debugging when you want to see where the fake mouse cursor is at all times. This hook also monitors calls to set the cursor image, so Proto Input will change the fake cursor to match the game's cursor image. Some games (notably Unity engine games) need DontShowCursorWhenImageUpdated enabled or the cursors will show when they shouldn't.
Example: `Game.ProtoInput.CursorVisibilityHook = true;`

### Game.ProtoInput.DinputDeviceHook
`DinputDeviceHook: boolean`
Proto Input
Some (few) games will use Direct Input instead of Xinput to get controller input. The Direct Input API involves creating an "interface" to receive input from a controller. Typically a game will create this interface at startup for the first or all controllers. This hook will redirect the interface to the GUID of the selected controller. Note that the controller GUID can only be set automatically through Nucleus (not at runtime).
If this method doesn't work, you can also try with DinputHookAlsoHooksGetDeviceState. This will additionally hook the GetDeviceState function, which is called whenever the game polls input. This method is highly un-recommended since there's no guarantee the game expects the data to be formatted in the same way that Proto Input does, which can lead to completely mesesed up input.
Example: `Game.ProtoInput.DinputDeviceHook = true;`

### Game.ProtoInput.DinputHookAlsoHooksGetDeviceState
`DinputHookAlsoHooksGetDeviceState: boolean`
Proto Input
Some (few) games will use Direct Input instead of Xinput to get controller input. The Direct Input API involves creating an "interface" to receive input from a controller. Typically a game will create this interface at startup for the first or all controllers. This hook will redirect the interface to the GUID of the selected controller. Note that the controller GUID can only be set automatically through Nucleus (not at runtime).
If this method doesn't work, you can also try with DinputHookAlsoHooksGetDeviceState. This will additionally hook the GetDeviceState function, which is called whenever the game polls input. This method is highly un-recommended since there's no guarantee the game expects the data to be formatted in the same way that Proto Input does, which can lead to completely mesesed up input.
Example: `Game.ProtoInput.DinputHookAlsoHooksGetDeviceState = false;`

### Game.ProtoInput.DontShowCursorWhenImageUpdated
`DontShowCursorWhenImageUpdated: boolean`
Proto Input
Monitors when the game tries to hide the cursor (e.g. when you close the menu in a first person game), and sets the visibility of the fake cursor instead. Should be almost always be enabled, except sometimes during debugging when you want to see where the fake mouse cursor is at all times. This hook also monitors calls to set the cursor image, so Proto Input will change the fake cursor to match the game's cursor image. Some games (notably Unity engine games) need DontShowCursorWhenImageUpdated enabled or the cursors will show when they shouldn't.
Example: `Game.ProtoInput.DontShowCursorWhenImageUpdated = false;`

### Game.ProtoInput.DrawFakeCursor
`DrawFakeCursor: number | boolean`
Proto Input
This is set in the input locking
Example: `Game.ProtoInput.DrawFakeCursor = false;`

### Game.ProtoInput.EnableFocusMessageLoop
`EnableFocusMessageLoop: boolean`
Proto Input
Game.ProtoInput.FocusLoopIntervalMilliseconds = 5;
Example: `Game.ProtoInput.EnableFocusMessageLoop = true;`

### Game.ProtoInput.EnableToggleFakeCursorVisibilityShortcut
`EnableToggleFakeCursorVisibilityShortcut: boolean`

### Game.ProtoInput.ExtendFakeCursorBounds
`ExtendFakeCursorBounds: boolean`
Proto Input
Example: `Game.ProtoInput.ExtendFakeCursorBounds = true;`

### Game.ProtoInput.FindWindowHook
`FindWindowHook: boolean`
Proto Input
Blocks calls to FindWindow and EnumWindow so the game cannot detect any windows. This is required for opening multiple instances of some games. You will usually need to use startup injection with this hook.
Example: `Game.ProtoInput.FindWindowHook = true;`

### Game.ProtoInput.FocusHooks
`FocusHooks: boolean`
Proto Input
Hooks many functions (see the Details tab of the hook) related to the game checking if it's in the foreground or focused. Should always be enabled. Proto Input will repeatedly scan to find the main window, in case it changes.
Example: `Game.ProtoInput.FocusHooks = true;`

### Game.ProtoInput.FocusLoop_WM_ACTIVATE
`FocusLoop_WM_ACTIVATE: boolean`
Proto Input
Example: `Game.ProtoInput.FocusLoop_WM_ACTIVATE = true;`

### Game.ProtoInput.FocusLoop_WM_ACTIVATEAPP
`FocusLoop_WM_ACTIVATEAPP: boolean`
Proto Input
Example: `Game.ProtoInput.FocusLoop_WM_ACTIVATEAPP = false;`

### Game.ProtoInput.FocusLoop_WM_MOUSEACTIVATE
`FocusLoop_WM_MOUSEACTIVATE: boolean`
Proto Input
Example: `Game.ProtoInput.FocusLoop_WM_MOUSEACTIVATE = true;`

### Game.ProtoInput.FocusLoop_WM_NCACTIVATE
`FocusLoop_WM_NCACTIVATE: boolean`
Proto Input
Example: `Game.ProtoInput.FocusLoop_WM_NCACTIVATE = false;`

### Game.ProtoInput.FocusLoop_WM_SETFOCUS
`FocusLoop_WM_SETFOCUS: boolean`
Proto Input
Example: `Game.ProtoInput.FocusLoop_WM_SETFOCUS = true;`

### Game.ProtoInput.FocusLoopIntervalMilliseconds
`FocusLoopIntervalMilliseconds: number`
default `5` · Proto Input
Example: `Game.ProtoInput.FocusLoopIntervalMilliseconds = 5;`

### Game.ProtoInput.FreezeExternalInputWhenInputNotLocked
`FreezeExternalInputWhenInputNotLocked: boolean`
Proto Input
Sets the virtual keycode for locking input (End key by default)
Example: `Game.ProtoInput.FreezeExternalInputWhenInputNotLocked = true;`

### Game.ProtoInput.GetAsyncKeyStateHook
`GetAsyncKeyStateHook: boolean`
Proto Input
Similar to Get Key State. Async also tells the caller whether the key was pressed since the last call, so this can resolve issues where keys are pressed or release when they shouldn't. Should almost always be enabled.
Example: `Game.ProtoInput.GetAsyncKeyStateHook = true;`

### Game.ProtoInput.GetCursorInfoHook
`GetCursorInfoHook: boolean`

### Game.ProtoInput.GetCursorPosHook
`GetCursorPosHook: boolean`
Proto Input
The GetCursorPos is one way of obtaining the cursor position, so this hook redirects it to the "fake" cursor position. Should always be enabled.
Example: `Game.ProtoInput.GetCursorPosHook = true;`

### Game.ProtoInput.GetKeyboardStateHook
`GetKeyboardStateHook: boolean`
Proto Input
Basically the same as Get Key State, except it returns the state of the entire keyboard. Should almost always be enabled.
Example: `Game.ProtoInput.GetKeyboardStateHook = true;`

### Game.ProtoInput.GetKeyStateHook
`GetKeyStateHook: boolean`
Proto Input
Hooks GetKeyState to return the "fake" keyboard state. You should almost always have this enabled even if it appears to have no effect: when using multiple keyboards at the game time, they may interfere without this hook.
Example: `Game.ProtoInput.GetKeyStateHook = true;`

### Game.ProtoInput.GetRawInputDataHook
`GetRawInputDataHook: boolean`
Proto Input
When forwarding the input back to the game, you need to create a handle to the input data. However these handles can only be created by Windows. To get around this, Proto Input will send a dummy WM_INPUT message to the game (from the Register Raw Input hook). The game then calls GetRawInputData using the dummy handle. This hook intercepts the call and passes in the saved data. This hook is required to make forwarding raw input work, so it should always be enabled.
Example: `Game.ProtoInput.GetRawInputDataHook = true;`

### Game.ProtoInput.InjectRuntime_EasyHookMethod
`InjectRuntime_EasyHookMethod: boolean`
Proto Input
Example: `Game.ProtoInput.InjectRuntime_EasyHookMethod = true;`

### Game.ProtoInput.InjectRuntime_EasyHookStealthMethod
`InjectRuntime_EasyHookStealthMethod: boolean`
Proto Input
Automatically locks input once the instances are set up
Example: `Game.ProtoInput.InjectRuntime_EasyHookStealthMethod = false;`

### Game.ProtoInput.InjectRuntime_RemoteLoadMethod
`InjectRuntime_RemoteLoadMethod: boolean`
Proto Input
Example: `Game.ProtoInput.InjectRuntime_RemoteLoadMethod = false;`

### Game.ProtoInput.InjectStartup
`InjectStartup: boolean`
Proto Input
Example: `Game.ProtoInput.InjectStartup = false;`

### Game.ProtoInput.KeyboardButtonFilter
`KeyboardButtonFilter: boolean`
Proto Input
Same as the Mouse Buttons filter, for keyboard buttons. Should always be enabled.
Example: `Game.ProtoInput.KeyboardButtonFilter = true;`

### Game.ProtoInput.MessageFilterHook
`MessageFilterHook: boolean`
Proto Input
Hooks the GetMessage and PeekMessage functions to intercept every windows message for every window owned by the process. (Note this method is superior to changing WndProc since it works for all windows without knowing what they are, and is less fragile). This hook is used to make the message filters and blocks work. This should always be enabled.
Example: `Game.ProtoInput.MessageFilterHook = true;`

### Game.ProtoInput.MessageSubWindows
`MessageSubWindows: boolean`

### Game.ProtoInput.MouseActivateFilter
`MouseActivateFilter: boolean`
Proto Input
WM_MOUSEACTIVATE, WM_ACTIVATE and WM_ACTIVATEAPP all tell a window when it's activated or deactivated. These filters modify the messages to make the window think it's in the foreground and activated. Should always be enabled.
Example: `Game.ProtoInput.MouseActivateFilter = true;`

### Game.ProtoInput.MouseButtonFilter
`MouseButtonFilter: boolean`
Proto Input
Filters the mouse buttons messages to only pass "fake" input. This prevents any interaction from the "real" mouse cursor with our input. Should always be enabled.
Example: `Game.ProtoInput.MouseButtonFilter = true;`

### Game.ProtoInput.MouseMoveFilter
`MouseMoveFilter: boolean`
Proto Input
One method of getting the mouse position/state is through the WM_MOUSEMOVE message, so this modifies the data to return the "fake" mouse state. ****This filter is not recommended as it can be very CPU intensive (with multiple mice polling at hundreds of Hz), however it is required for input to work in some games.**** Test with it enabled and disabled to check if you require it.
Example: `Game.ProtoInput.MouseMoveFilter = true;`

### Game.ProtoInput.MouseWheelFilter
`MouseWheelFilter: boolean`
Proto Input
Filters the WM_MOUSEWHEEL messages to only pass "fake" input. This fixes the issue of the foreground window receiving two scrolls for each scroll. Should always be enabled.
Example: `Game.ProtoInput.MouseWheelFilter = true;`

### Game.ProtoInput.MoveWindowHook
`MoveWindowHook: number | boolean`

### Game.ProtoInput.MultipleProtoControllers
`MultipleProtoControllers: boolean`
Proto Input
The number of controller icons dragged onto the screens
Example: `Game.ProtoInput.MultipleProtoControllers = false;`

### Game.ProtoInput.OnInputLocked
`OnInputLocked: () => void`

### Game.ProtoInput.OnInputUnlocked
`OnInputUnlocked: () => void`

### Game.ProtoInput.PointerInMouse
`PointerInMouse: boolean`

### Game.ProtoInput.PutMouseInsideWindow
`PutMouseInsideWindow: number | boolean`

### Game.ProtoInput.RawInputFilter
`RawInputFilter: boolean`
Proto Input
Filters the WM_INPUT messages (which send raw input data) to only allow the forwarded messages from the Register Raw Input hook. This will allow only input from the selected device(s). Also modifies the message to tell the game that input was received while the game was in the foreground. Should always be enabled.
Example: `Game.ProtoInput.RawInputFilter = true;`

### Game.ProtoInput.RegisterRawInputHook
`RegisterRawInputHook: boolean`
Proto Input
This hook will unsubscribe the game from Raw Input (if it has already subscribed to it), and then subscribes Proto Input to receive raw input instead. Raw input received is forwarded back to the game if it uses raw input. Proto Input receives all keyboard/mouse input from this hook so it always needs to be enabled.
Example: `Game.ProtoInput.RegisterRawInputHook = true;`

### Game.ProtoInput.RenameHandles
`RenameHandles: string[]`
Proto Input
Some games will use handles (of mutants, events or semaphores) or named pipes to prevent opening multiple instances. New instances will detect the handle opened by the previous instance, then refuse to open. Proto Input gets around this by renaming the handles to something random (e.g. "mutex" to "mutex2733894") so the new instances can't detect it. Since the handles are usually opened at startup, you will usually need startup injection. To get the names of these handles, use Process Explorer to browse the handles, then use some guesswork.
Example: `Game.ProtoInput.RenameHandles = [ "some mutex", "some other mutex" ];`

### Game.ProtoInput.RenameHandlesHook
`RenameHandlesHook: boolean`
Proto Input
Example: `Game.ProtoInput.RenameHandlesHook = false;`

### Game.ProtoInput.RenameNamedPipes
`RenameNamedPipes: string[]`
Proto Input
Some games will use handles (of mutants, events or semaphores) or named pipes to prevent opening multiple instances. New instances will detect the handle opened by the previous instance, then refuse to open. Proto Input gets around this by renaming the handles to something random (e.g. "mutex" to "mutex2733894") so the new instances can't detect it. Since the handles are usually opened at startup, you will usually need startup injection. To get the names of these handles, use Process Explorer to browse the handles, then use some guesswork.
Example: `Game.ProtoInput.RenameNamedPipes = [ "some named pipe", "some other named pipe" ];`

### Game.ProtoInput.ReRegisterInput
`ReRegisterInput: boolean`

### Game.ProtoInput.ScaleFromX
`ScaleFromX: number`

### Game.ProtoInput.ScaleFromY
`ScaleFromY: number`

### Game.ProtoInput.SendKeyboardButtonMessages
`SendKeyboardButtonMessages: boolean`
Proto Input
Handled on input lock/unlock, don't enable this by default
Example: `Game.ProtoInput.SendKeyboardButtonMessages = true;`

### Game.ProtoInput.SendMouseButtonMessages
`SendMouseButtonMessages: boolean`
Proto Input
Example: `Game.ProtoInput.SendMouseButtonMessages = true;`

### Game.ProtoInput.SendMouseDblClkMessages
`SendMouseDblClkMessages: boolean`

### Game.ProtoInput.SendMouseMovementMessages
`SendMouseMovementMessages: boolean`
Proto Input
Example: `Game.ProtoInput.SendMouseMovementMessages = true;`

### Game.ProtoInput.SendMouseWheelMessages
`SendMouseWheelMessages: boolean`
Proto Input
Example: `Game.ProtoInput.SendMouseWheelMessages = true;`

### Game.ProtoInput.SetCursorPosHook
`SetCursorPosHook: boolean`
Proto Input
SetCursorPos sets the cursor position. This hook causes it to set the "fake" cursor instead. This is important in some games that will set the mouse cursor to the centre of the screen each frame, then calculate the difference in movement each frame. This hook also prevents moving the "real" cursor, which can be problematic. Should always be enabled.
Example: `Game.ProtoInput.SetCursorPosHook = true;`

### Game.ProtoInput.SetRemoveBorderHook
`SetRemoveBorderHook: number | boolean`

### Game.ProtoInput.SetWindowPosHook
`SetWindowPosHook: number | boolean`
Proto Input
Prevents the game from calling SetWindowPos to resposition and resize the game window, instead forcing it to the resolution set by Nucleus. This will usually require using startup hooks.
Example: `Game.ProtoInput.SetWindowPosHook = true;`

### Game.ProtoInput.SetWindowsHookHook
`SetWindowsHookHook: boolean`

### Game.ProtoInput.SetWindowStyleHook
`SetWindowStyleHook: boolean`
Proto Input
Hooks SetWindowLong and SetWindowLongPtr to prevent the game from re-adding a title bar after Nucleus has stripped it.
Example: `Game.ProtoInput.SetWindowStyleHook = true;`

### Game.ProtoInput.ToggleFakeCursorVisibilityShortcutVkey
`ToggleFakeCursorVisibilityShortcutVkey: number`
default `0x24`
VK_HOME

### Game.ProtoInput.TranslateMKBtoXinput
`TranslateMKBtoXinput: boolean`

### Game.ProtoInput.TranslateXAccelration
`TranslateXAccelration: number`

### Game.ProtoInput.TranslateXAPointClick
`TranslateXAPointClick: boolean`

### Game.ProtoInput.TranslateXAPointMove
`TranslateXAPointMove: boolean`

### Game.ProtoInput.TranslateXAstatic
`TranslateXAstatic: boolean`

### Game.ProtoInput.TranslateXBPointClick
`TranslateXBPointClick: boolean`

### Game.ProtoInput.TranslateXBPointMove
`TranslateXBPointMove: boolean`

### Game.ProtoInput.TranslateXBstatic
`TranslateXBstatic: boolean`

### Game.ProtoInput.TranslateXButtonA
`TranslateXButtonA: number`

### Game.ProtoInput.TranslateXButtonB
`TranslateXButtonB: number`

### Game.ProtoInput.TranslateXButtonDown
`TranslateXButtonDown: number`

### Game.ProtoInput.TranslateXButtonLeft
`TranslateXButtonLeft: number`

### Game.ProtoInput.TranslateXButtonLS
`TranslateXButtonLS: number`

### Game.ProtoInput.TranslateXButtonOption
`TranslateXButtonOption: number`

### Game.ProtoInput.TranslateXButtonRight
`TranslateXButtonRight: number`

### Game.ProtoInput.TranslateXButtonRS
`TranslateXButtonRS: number`

### Game.ProtoInput.TranslateXButtonStart
`TranslateXButtonStart: number`

### Game.ProtoInput.TranslateXButtonUp
`TranslateXButtonUp: number`

### Game.ProtoInput.TranslateXButtonX
`TranslateXButtonX: number`

### Game.ProtoInput.TranslateXButtonY
`TranslateXButtonY: number`

### Game.ProtoInput.TranslateXDeadzone
`TranslateXDeadzone: number`

### Game.ProtoInput.TranslateXinputtoMKB
`TranslateXinputtoMKB: boolean`

### Game.ProtoInput.TranslateXScanner
`TranslateXScanner: boolean`

### Game.ProtoInput.TranslateXSensitivity
`TranslateXSensitivity: number`

### Game.ProtoInput.TranslateXShouldersNextPoint
`TranslateXShouldersNextPoint: boolean`

### Game.ProtoInput.TranslateXStickDown
`TranslateXStickDown: number`

### Game.ProtoInput.TranslateXStickL
`TranslateXStickL: number`

### Game.ProtoInput.TranslateXStickLeft
`TranslateXStickLeft: number`

### Game.ProtoInput.TranslateXStickR
`TranslateXStickR: number`

### Game.ProtoInput.TranslateXStickRight
`TranslateXStickRight: number`

### Game.ProtoInput.TranslateXStickUp
`TranslateXStickUp: number`

### Game.ProtoInput.TranslateXSwapSticks
`TranslateXSwapSticks: boolean`

### Game.ProtoInput.TranslateXXPointClick
`TranslateXXPointClick: boolean`

### Game.ProtoInput.TranslateXXPointMove
`TranslateXXPointMove: boolean`

### Game.ProtoInput.TranslateXXstatic
`TranslateXXstatic: boolean`

### Game.ProtoInput.TranslateXYPointClick
`TranslateXYPointClick: boolean`

### Game.ProtoInput.TranslateXYPointMove
`TranslateXYPointMove: boolean`

### Game.ProtoInput.TranslateXYstatic
`TranslateXYstatic: boolean`

### Game.ProtoInput.UseDinputRedirection
`UseDinputRedirection: boolean`
Proto Input
Xinput is used by most games for controller input. This hook changes the controller indexes so each instance can receive input from a different device. The controller index can be set from Nucleus or Proto Input Host, or it can be edited at runtime in the details tab. Xinput by default has a maximum of 4 controllers. This restriction can be removed if you enable use of the Openxinput library. However, this still will only let you use standard xinput controllers (no cheap PS1 controller adapters). If you want to use any device, enable the Dinput to Xinput redirection, which takes input from Direct Input (which supports any controller) and translates it to Xinput in the hook. Usually Openxinput is the best choice since it will work with vibration and using both triggers simultaneously.
Example: `Game.ProtoInput.UseDinputRedirection = false;`

### Game.ProtoInput.UseOpenXinput
`UseOpenXinput: boolean`
Proto Input
Xinput is used by most games for controller input. This hook changes the controller indexes so each instance can receive input from a different device. The controller index can be set from Nucleus or Proto Input Host, or it can be edited at runtime in the details tab. Xinput by default has a maximum of 4 controllers. This restriction can be removed if you enable use of the Openxinput library. However, this still will only let you use standard xinput controllers (no cheap PS1 controller adapters). If you want to use any device, enable the Dinput to Xinput redirection, which takes input from Direct Input (which supports any controller) and translates it to Xinput in the hook. Usually Openxinput is the best choice since it will work with vibration and using both triggers simultaneously.
Example: `Game.ProtoInput.UseOpenXinput = false;`

### Game.ProtoInput.WindowActivateFilter
`WindowActivateFilter: boolean`
Proto Input
WM_MOUSEACTIVATE, WM_ACTIVATE and WM_ACTIVATEAPP all tell a window when it's activated or deactivated. These filters modify the messages to make the window think it's in the foreground and activated. Should always be enabled.
Example: `Game.ProtoInput.WindowActivateFilter = true;`

### Game.ProtoInput.WindowActvateAppFilter
`WindowActvateAppFilter: boolean`
Proto Input
WM_MOUSEACTIVATE, WM_ACTIVATE and WM_ACTIVATEAPP all tell a window when it's activated or deactivated. These filters modify the messages to make the window think it's in the foreground and activated. Should always be enabled.
Example: `Game.ProtoInput.WindowActvateAppFilter = true;`

### Game.ProtoInput.XinputHook
`XinputHook: boolean`
Proto Input
Xinput is used by most games for controller input. This hook changes the controller indexes so each instance can receive input from a different device. The controller index can be set from Nucleus or Proto Input Host, or it can be edited at runtime in the details tab. Xinput by default has a maximum of 4 controllers. This restriction can be removed if you enable use of the Openxinput library. However, this still will only let you use standard xinput controllers (no cheap PS1 controller adapters). If you want to use any device, enable the Dinput to Xinput redirection, which takes input from Direct Input (which supports any controller) and translates it to Xinput in the hook. Usually Openxinput is the best choice since it will work with vibration and using both triggers simultaneously.
Example: `Game.ProtoInput.XinputHook = true;`

## Context

Per-instance context (`GenericContext`).

### Context.Arch
`(read-only) Arch: string`
read-only · Path variables
Architecture of the game executable ("x86" or "x64").
Example: `Context.Arch`

### Context.AspectRatio
`AspectRatio: string`
Path variables
Player's aspect ratio (e.g. 16:9).
Example: `Context.AspectRatio`

### Context.AspectRatioDecimal
`(read-only) AspectRatioDecimal: number`
read-only · Path variables
Player's aspect ratio in decimal (e.g. 1777777).
Example: `Context.AspectRatioDecimal`

### Context.BackupFile
`BackupFile(filePaths: string[], overwrite: boolean): boolean` / `Context.BackupFile(filePath: string | number | boolean, overwrite: boolean): boolean`

### Context.BackupFiles
`BackupFiles: string[]`
Copied from `Game.BackupFiles` for the current instance.

### Context.BackupFolders
`BackupFolders: string[]`
Copied from `Game.BackupFolders` for the current instance.

### Context.BinariesFolder
`BinariesFolder: string`
In which folder the game exe is located? Relative path to where Nucleus should start the game's working folder to.

Copied from `Game.BinariesFolder` for the current instance.

### Context.BlockRawInput
`BlockRawInput: boolean`
Disable raw input devices in game | default: false.

Copied from `Game.BlockRawInput` for the current instance.

### Context.ChangeExe
`ChangeExe: boolean`
Will rename the game's executable to "\<exe name\> - Player X", x being the instance/player #.

Copied from `Game.ChangeExe` for the current instance.

### Context.ChangeXmlAttributeValue
`ChangeXmlAttributeValue(path: string | number | boolean, xpath: string | number | boolean, attributeName: string | number | boolean, attributeValue: string | number | boolean): boolean`

### Context.ChangeXmlNodeInnerTextValue
`ChangeXmlNodeInnerTextValue(path: string | number | boolean, xpath: string | number | boolean, innerTextValue: string | number | boolean): boolean`
Path variables
Edit an XML element (previously only nodes and attributes).

### Context.ChangeXmlNodeValue
`ChangeXmlNodeValue(path: string | number | boolean, xpath: string | number | boolean, nodeValue: string | number | boolean): boolean`

### Context.CMDBatchAfter
`CMDBatchAfter: string[]`
When using CMDLaunch (or UseForceBindIP), specify command lines to run AFTER the game launches in same cmd session, syntax is instance and | symbol as a delimiter and the line you want that instance to run. If you want same line to run all instances, leave out the # and | (only write the line in quotes).

Copied from `Game.CMDBatchAfter` for the current instance.

### Context.CMDBatchBefore
`CMDBatchBefore: string[]`
When using CMDLaunch (or UseForceBindIP), specify command lines to run BEFORE the game launches in same cmd session, syntax is instance and | symbol as a delimiter and the line you want that instance to run. If you want same line to run all instances, leave out the # and | (only write the line in quotes).

Copied from `Game.CMDBatchBefore` for the current instance.

### Context.CMDBatchClose
`CMDBatchClose: string[]`
Copied from `Game.CMDBatchClose` for the current instance.

### Context.CMDLaunch
`CMDLaunch: boolean`
Launch a game using command prompt.

Copied from `Game.CMDLaunch` for the current instance.

### Context.CMDOptions
`CMDOptions: string[]`
Specify command line options if game is launched using command prompt | requires CMDLaunch to be true, each element is for a different instance.

Copied from `Game.CMDOptions` for the current instance.

### Context.CMDStartArgsInside
`CMDStartArgsInside: boolean`
Game.CMDBatchClose ["cmd1", "cmd2"];			//Run command lines upon exiting Nucleus.
When using CMDLaunch, should the game's starting arguments be inside the same quotations as the game path?

Copied from `Game.CMDStartArgsInside` for the current instance.

### Context.ConvertToBytes
`ConvertToBytes(num: number): number[]` / `Context.ConvertToBytes(num: number): number[]` / `Context.ConvertToBytes(str: string | number | boolean): number[]`
Path variables

### Context.ConvertToInt
`ConvertToInt(num: string | number | boolean): number` / `Context.ConvertToInt(num: any): number`
Path variables

### Context.ConvertToString
`ConvertToString(str: any): string`
Path variables

### Context.CopyCustomUtils
`CopyCustomUtils: string[]`
Copy a file or folder you specify between the quotes to each instance folder, if the file/folder is located in Nucleus folder\utils\User. This function also accepts two additional parameters, a relative path from the game root folder if the file needs to be placed somewhere else within instance folder and one parameter to indicate which instances to copy the file to if it only needs to be in some. Use of parameters is separated by a | character. So it would look something like this [ "filename.ini|\\bin|1,2" ]. This example would copy filename.ini from Nucleus\utils\User to Instance0\bin and Instance1\bin. If you don't specify which instances, it will do them all by default. If you don't specify a path then root instance folder is used. If you want instances but root folder you would just do [ "filename.ini||1,2" ] | If copying multiple files, use comma seperated strings

Copied from `Game.CopyCustomUtils` for the current instance.

### Context.CopyFiles
`CopyFiles: string[]`
Copy files from the game directory to the instanced folder.

Copied from `Game.CopyFiles` for the current instance.

### Context.CopyFolder
`CopyFolder(source: string | number | boolean, destination: string | number | boolean): boolean`

### Context.CopyScriptFolder
`CopyScriptFolder(DestinationPath: string | number | boolean): boolean`
Path variables
Copies the handler's folder (Game.Folder) to the given destination.

### Context.CreatedDate
`CreatedDate(file: string | number | boolean, year: number, month: number, day: number, hour: number, minute: number, second: number): void` / `Context.CreatedDate(file: string | number | boolean, year: number, month: number, day: number): void`
Path variables
Change the creation date of a file.

### Context.CreateRegKey
`CreateRegKey(baseKey: string | number | boolean, sKey: string | number | boolean, subKey: string | number | boolean): boolean`
Path variables
Create a registry key for current user, baseKey can either be "HKEY_LOCAL_MACHINE" or "HKEY_CURRENT_USER".

### Context.CustomUserGeneralValues
`CustomUserGeneralValues: string[]`
Answers to `Game.CustomUserGeneralPrompts`.

### Context.CustomUserInstanceValues
`CustomUserInstanceValues: string[]`
Answers to `Game.CustomUserInstancePrompts` for the current instance.

### Context.CustomUserPlayerValues
`CustomUserPlayerValues: string[]`
Answers to `Game.CustomUserPlayerPrompts` for the current player.

### Context.Debug
`Debug: boolean`
Writes a detailed debug log while the handler runs.

Copied from `Game.Debug` for the current instance.

### Context.DeleteRegKey
`DeleteRegKey(baseKey: string | number | boolean, sKey: string | number | boolean, subKey: string | number | boolean): void`
Path variables
Delete a registry key for current user, baseKey can either be "HKEY_LOCAL_MACHINE" or "HKEY_CURRENT_USER".

### Context.DeleteRegKeyValues
`DeleteRegKeyValues(baseKey: string | number | boolean, sKey: string | number | boolean, values: string[]): void`

### Context.DocumentsConfigPath
`DocumentsConfigPath: string`
Path variables
Relative path from user profile to game's config path | requires Game.DocumentsConfigPath be set.

Copied from `Game.DocumentsConfigPath` for the current instance.
Example: `Context.DocumentsConfigPath`

### Context.DocumentsPlayer
`(read-only) DocumentsPlayer: string`
read-only · Path variables
Path to current players Nucleus documents environment.
Example: `Context.DocumentsPlayer`

### Context.DocumentsRoot
`(read-only) DocumentsRoot: string`
read-only · Path variables
Path to Nucleus documents environment root folder.
Example: `Context.DocumentsRoot`

### Context.DocumentsSavePath
`DocumentsSavePath: string`
Path variables
Relative path from user profile to game's save path | requires Game.DocumentsSavePath be set.

Copied from `Game.DocumentsSavePath` for the current instance.
Example: `Context.DocumentsSavePath`

### Context.DPIHandling
`DPIHandling: Nucleus.DPIHandling | number | boolean`
default `DPIHandling.True`
<summary "DPIHandling" is deprecated since v2.3.3, keep it for old handlers using it but has no effect.

Copied from `Game.DPIHandling` for the current instance.

### Context.EditRegKey
`EditRegKey(baseKey: string | number | boolean, sKey: string | number | boolean, subKey: string | number | boolean, value: any, regType: Nucleus.RegType | number | boolean): void`
Path variables
Edit a registry key for current user, baseKey can either be "HKEY_LOCAL_MACHINE" or "HKEY_CURRENT_USER".
EditRegKey uses a custom registry data type to use, by using `Nucleus.RegType.DWord` for example. The last word can be of the same name of RegistryValueKind enum.

### Context.EditRegKeyNoBackup
`EditRegKeyNoBackup(baseKey: string | number | boolean, sKey: string | number | boolean, subKey: string | number | boolean, value: any, regType: Nucleus.RegType | number | boolean): void`
Path variables
Edit a registry key for current user without Nucleus creating a backup of the registry or before it creates one. Must be placed before any "Context.EditRegKey" line in handler for it to work.

### Context.EditTextFile
`EditTextFile(path: string | number | boolean, refLines: string[], newLines: string[], encoder: string | number | boolean): boolean`

### Context.EditZipFile
`EditZipFile(sourceZip: string | number | boolean, password: string | number | boolean, savePath: string | number | boolean, itemsToAdd: string[], entriesToRemove: string[]): boolean`

### Context.EnvironmentPlayer
`EnvironmentPlayer: string`
Path variables
Path to current players Nucleus environment.
Example: `Context.EnvironmentPlayer`

### Context.EnvironmentRoot
`EnvironmentRoot: string`
Path variables
Path to Nucleus environment root folder.
Example: `Context.EnvironmentRoot`

### Context.EpicLang
`(read-only) EpicLang: string`
read-only · Path variables
Can be use to edit NemirtingasEpicEmu.json
Can be use in start argument to setup user Epic language parameter
ex: Context.StartArguments = ' -AlwaysFocus -nosplash -nomoviestartup -nomouse' + Context.EpicLang; (if Epic Language is set to "en" return => "-epiclocale=en", Should not be necessary in most cases)

Copied from `Game.EpicLang` for the current instance.
Example: `Context.EpicLang`

### Context.ExecutableContext
`ExecutableContext: string[]`
Array with the name of other files found in the executable's folder (so we don't confuse different games with similar file names). Example: Borderlands and Tales of the Borderlands share their executable name (borderlands.exe). We include 1 folder and a file that's unique to Borderlands to make sure the application doesn't confuse itself.

Copied from `Game.ExecutableContext` for the current instance.

### Context.ExecutableName
`ExecutableName: string`
The name of the game executable with the extension. This will be used by Nucleus to add games, to run the game and as process to follow for positioning and resizing.

Copied from `Game.ExecutableName` for the current instance.

### Context.ExePath
`ExePath: string`
Full path of the executable being launched for this instance.

### Context.ExtractZip
`ExtractZip(sourceZip: string | number | boolean, contentDestination: string | number | boolean, password: string | number | boolean): boolean`

### Context.FakeFocus
`FakeFocus: boolean`
Enable or disable the sending of focus messages to each game window at a regular interval | default: false.

Copied from `Game.FakeFocus` for the current instance.

### Context.FakeFocusInstances
`FakeFocusInstances: string`
If you only want specific instances to have fake focus messages sent to, specify them in a comma seperated string.

Copied from `Game.FakeFocusInstances` for the current instance.

### Context.FindFilePartialName
`FindFilePartialName(rootFolder: string | number | boolean, partialFileNames: string[]): string[]`

### Context.FindFiles
`FindFiles(rootFolder: string | number | boolean, fileName: string | number | boolean): string[]` / `Context.FindFiles(rootFolder: string | number | boolean, fileName: string | number | boolean, searchAll: boolean): string[]`
Path variables
Return a string array of filenames (and their paths) found that match a pattern you specify.

### Context.FindLineNumberInTextFile
`FindLineNumberInTextFile(path: string | number | boolean, searchValue: string | number | boolean, type: Nucleus.SearchType | number | boolean): number`
Path variables
Returns a line number (int), utilizes a newly created enum SearchType.

### Context.ForceWindowTitle
`ForceWindowTitle: boolean`
Forces the game window title to be whatever is specified in Game.Hook.ForceFocusWindowName (triggers once, after all instances have started) | default: false.

Copied from `Game.ForceWindowTitle` for the current instance.

### Context.GameName
`GameName: string`
Title of the game that will be shown in Nucleus.

Copied from `Game.GameName` for the current instance.

### Context.GamepadGuid
`(read-only) GamepadGuid: string`
read-only · Path variables
Get the raw gamepad guid

Copied from `Game.GamepadGuid` for the current instance.
Example: `Context.GamepadGuid`

### Context.GamepadId
`(read-only) GamepadId: number`
read-only · Path variables
Useful to make sure that controllers are correctly assigned to the player they are meant to be assigned.
Example: `Context.GamepadId`

### Context.GetFileName
`GetFileName(fileFullPath: string | number | boolean): string`

### Context.GetFolder
`GetFolder(folder: Nucleus.Folder | number | boolean): string`
Path variables
Path to the Nucleus Co-op current instance root folder (Nucleus-Coop\content\GUID\Instance#).

### Context.GogLang
`(read-only) GogLang: string`
read-only · Path variables
Can be use to edit NemirtingasGalaxyEmu.json from handlers

Copied from `Game.GogLang` for the current instance.
Example: `Context.GogLang`

### Context.GoldbergNeedSteamInterface
`GoldbergNeedSteamInterface: boolean`
Some older games require a steam_interfaces.txt file for Goldberg to work | Will first search orig game path and nucleus games path, if not found then tries to create one with the GoldbergNeedSteamInterface command.

Copied from `Game.GoldbergNeedSteamInterface` for the current instance.

### Context.GUID
`GUID: string`
The name of the folder that will be created inside the Nucleus content folder (just use letters not symbols). In this folder Nucleus will store the symlinked or copied game files for each instance of the game.

Copied from `Game.GUID` for the current instance.

### Context.HandlerGUID
`(read-only) HandlerGUID: string`
read-only · Path variables
Example: `Context.HandlerGUID`

### Context.HandlerInterval
`HandlerInterval: number`
The interval in milliseconds the Handler should be updated at. Set it to 0 to disable updating (will lose all functionality that depends on ticks).

Copied from `Game.HandlerInterval` for the current instance.

### Context.HandlersFolder
`(read-only) HandlersFolder: string`
read-only · Path variables
return "NucleusCo-op\handlers" path.
Example: `Context.HandlersFolder`

### Context.HasDynamicWindowTitle
`HasDynamicWindowTitle: boolean`
Work-around for ForceFocusWindowName having to match 1:1 with game window title for resizing, positioning and focus | default: false.

Copied from `Game.HasDynamicWindowTitle` for the current instance.

### Context.HasKeyboardPlayer
`(read-only) HasKeyboardPlayer: boolean`
read-only · Path variables
True if any player in the session uses keyboard & mouse.
Example: `Context.HasKeyboardPlayer`

### Context.Height
`(read-only) Height: number`
read-only
Height in pixels of this instance's window.

### Context.HexEdit
`HexEdit(fileToEdit: string | number | boolean, address: string | number | boolean, newBytes: number[]): boolean`
Path variables
Writes bytes at an address in a file.

### Context.HideCursor
`HideCursor: boolean`
Hide the mouse cursor in game instances.

Copied from `Game.HideCursor` for the current instance.

### Context.HideDesktop
`HideDesktop(): void` / `Context.HideDesktop(hideTaskbar: boolean): void`

### Context.HideTaskbar
`HideTaskbar: boolean`
Most games hide the taskbar when placed on-top but for games that don't you can use this.

Copied from `Game.HideTaskbar` for the current instance.

### Context.HideTaskBar
`HideTaskBar(): void`

### Context.Hook
`Hook: GameHook`
default `new GameHookInfo()`
Settings for Nucleus' custom xinput/x360ce hook DLL.

Copied from `Game.Hook` for the current instance.

### Context.HookFocus
`HookFocus: boolean`
Enable or disable hooks to trick the game into thinking it has focus | default: false.

Copied from `Game.HookFocus` for the current instance.

### Context.HookFocusInstances
`HookFocusInstances: string`
Copied from `Game.HookFocusInstances` for the current instance.

### Context.HookInit
`HookInit: boolean`
Enable or disable hooks of functions some games may try and use to prevent multiple instances from running | default: false.

Copied from `Game.HookInit` for the current instance.

### Context.HookInitDelay
`HookInitDelay: boolean`
Copied from `Game.HookInitDelay` for the current instance.

### Context.IdealProcessor
`IdealProcessor: number`
Sets the preferred processor for the game's threads, used when the system schedules threads, to determine which processor to run the thread on | default: system delegation.

Copied from `Game.IdealProcessor` for the current instance.

### Context.IdInWindowTitle
`IdInWindowTitle: boolean`
Adds the process ID to the end of the window title.

Copied from `Game.IdInWindowTitle` for the current instance.

### Context.InjectDinputToXinputTranslation
`InjectDinputToXinputTranslation: boolean`
If you want to translate XInput to Dinput when using this restriction method + Game.Hook.XInputReroute = true;

Copied from `Game.InjectDinputToXinputTranslation` for the current instance.

### Context.InjectHookXinput
`InjectHookXinput: boolean`
This method is the same used by Universal Split Screen (Hook Xinput for gamepads). It will make the instance redirect the controllers' input to a specific controller index. This restriction method doesn't create any files.

Copied from `Game.InjectHookXinput` for the current instance.

### Context.IsFullscreen
`IsFullscreen: boolean`

### Context.IsKeyboardPlayer
`(read-only) IsKeyboardPlayer: boolean`
read-only · Path variables
True if current player is using keyboard, useful for logic that is needed for keyboard only player.
Example: `Context.IsKeyboardPlayer`

### Context.KeepAspectRatio
`KeepAspectRatio: boolean`
Should the game window try and keep it's aspect ratio when being resized? | default: false.

Copied from `Game.KeepAspectRatio` for the current instance.

### Context.KeepEditedRegKeys
`KeepEditedRegKeys: boolean`

### Context.KeepSymLinkOnExit
`KeepSymLinkOnExit: boolean`
Enable or disable symlink files from being deleted when Nucleus is closed | default: false.

Copied from `Game.KeepSymLinkOnExit` for the current instance.

### Context.KillMutex
`KillMutex: string[]`
Array of mutexes to kill before starting the next game process. A 'Mutex/Mutant' is a mutually exclusive flag, which basically tells the game not to allow multiple instances of its program.

Copied from `Game.KillMutex` for the current instance.

### Context.KillMutexDelay
`KillMutexDelay: number`
\# of seconds to wait before killing the mutex | Only works with killing not renaming | default: 0.

Copied from `Game.KillMutexDelay` for the current instance.

### Context.KillMutexType
`KillMutexType: string`
Specify the type of mutex/handle to kill, for example "Mutant", "Event" or "Semaphore" | default: "Mutant".

Copied from `Game.KillMutexType` for the current instance.

### Context.KillProcessesMatchingProcessName
`KillProcessesMatchingProcessName(name: string | number | boolean): boolean`
Path variables
Kill processes matching a given process name during preperation.

### Context.KillProcessesMatchingWindowName
`KillProcessesMatchingWindowName(name: string | number | boolean): boolean`
Path variables
Kill processes matching a given window name during preperation.

### Context.LauncherExe
`LauncherExe: string`
If the game needs to go through a launcher before opening Nucleus will use this exe to start the game and it will still use the Game.ExecutableName process for positioning and resizing.

Copied from `Game.LauncherExe` for the current instance.

### Context.LauncherFolder
`LauncherFolder: string`

### Context.LauncherTitle
`LauncherTitle: string`
The name of the launcher's window title. Some games need to go through a launcher to open. This is needed or else the application will lose the game's window.

Copied from `Game.LauncherTitle` for the current instance.

### Context.LocalIP
`(read-only) LocalIP: string`
read-only · Path variables
Local IP address of the computer.
Example: `Context.LocalIP`

### Context.Log
`Log(msg: string | number | boolean): void` / `Context.Log(msg: string | number | boolean, val: string | number | boolean): void` / `Context.Log(msg: string | number | boolean, val: number): void` / `Context.Log(msg: string | number | boolean, val: boolean): void` / `Context.Log(msg: string | number | boolean, val: number): void` / `Context.Log(msg: string | number | boolean, vals: string[]): void`
Path variables
Writes a line to the Nucleus debug log (requires `Game.Debug = true` or debug logging enabled).

### Context.MaxPlayers
`MaxPlayers: number`
This is just the max players info that shows under the handler name in Nucleus UI. Usually we write the max number of players the game supports. (PC, should support 16 max connected input devices).

Copied from `Game.MaxPlayers` for the current instance.

### Context.MaxPlayersOneMonitor
`MaxPlayersOneMonitor: number`
This is just info. It will not limit the players number.

Copied from `Game.MaxPlayersOneMonitor` for the current instance.

### Context.ModifiedDate
`ModifiedDate(file: string | number | boolean, year: number, month: number, day: number, hour: number, minute: number, second: number): void` / `Context.ModifiedDate(file: string | number | boolean, year: number, month: number, day: number): void`
Path variables
Change the last modified date of a file.

### Context.ModifySaveFile
`ModifySaveFile(installSavePath: string | number | boolean, saveFullPath: string | number | boolean, type: Nucleus.SaveType | number | boolean, ...info: Nucleus.SaveInfo): boolean`
Edits keys in an INI/CFG file. Example: `Context.ModifySaveFile(path, path, Nucleus.SaveType.INI, [new Nucleus.IniSaveInfo("Section", "Key", "Value")]);`

### Context.MonitorHeight
`(read-only) MonitorHeight: number`
read-only · Path variables
Height of the monitor this instance is on.
Example: `Context.MonitorHeight`

### Context.MonitorWidth
`(read-only) MonitorWidth: number`
read-only · Path variables
Width of the monitor this instance is on.
Example: `Context.MonitorWidth`

### Context.MoveFolder
`MoveFolder(sourceDirName: string | number | boolean, destDirName: string | number | boolean): boolean`
Path variables

### Context.NeedsSteamEmulation
`NeedsSteamEmulation: boolean`
If the game needs a fake Steam wrapper (SSE) to run multiple instances (this is not needed if you are using the new use Goldberg emulator line).

Copied from `Game.NeedsSteamEmulation` for the current instance.

### Context.NewSaveInfo
`NewSaveInfo(section: string | number | boolean, key: string | number | boolean, value: string | number | boolean): Nucleus.SaveInfo`

### Context.Nickname
`(read-only) Nickname: string`
read-only · Path variables
Use this in a game handler to get the player's nickname
Example: `Context.Nickname`

### Context.NucleusDocumentsRoot
`NucleusDocumentsRoot: string`
default `Globals.UserDocumentsRoot`

### Context.NucleusEnvironmentRoot
`NucleusEnvironmentRoot: string`
default `Globals.UserEnvironmentRoot`

### Context.NucleusFolder
`(read-only) NucleusFolder: string`
read-only · Path variables
Path to the Nucleus Co-op root folder (Nucleus-Coop\).
Example: `Context.NucleusFolder`

### Context.NucleusUserRoot
`NucleusUserRoot: string`
Path variables
Path to current players Nucleus environment Windows User root folder.
Example: `Context.NucleusUserRoot`

### Context.NumberOfPlayers
`(read-only) NumberOfPlayers: number`
read-only · Path variables
Total number of players in this session.
Example: `Context.NumberOfPlayers`

### Context.NumControllers
`NumControllers: number`
default `0`

### Context.NumKeyboards
`NumKeyboards: number`
default `0`

### Context.Options
`(read-only) Options: Record<string, any>`
read-only
Values chosen by the user for options added with `Game.AddOption`.

Copied from `Game.Options` for the current instance.

### Context.OrigAspectRatio
`OrigAspectRatio: string`
Path variables
Player monitor's aspect ratio (e.g. 16:9).
Example: `Context.OrigAspectRatio`

### Context.OrigAspectRatioDecimal
`(read-only) OrigAspectRatioDecimal: number`
read-only · Path variables
Player monitor's aspect ratio in decimal (e.g. 1.777777).
Example: `Context.OrigAspectRatioDecimal`

### Context.OrigRootFolder
`OrigRootFolder: string`

### Context.OrigSteamDllPath
`OrigSteamDllPath: string`
If steam_interface.txt is required, provide full path here to the original steam_api(64).dll and Nucleus will create one if it can't find an existing copy.

Copied from `Game.OrigSteamDllPath` for the current instance.

### Context.PatchFile
`PatchFile(originalFile: string | number | boolean, patchedFile: string | number | boolean, patchFind: number[], patchReplace: number[]): boolean` / `Context.PatchFile(originalFile: string | number | boolean, patchedFile: string | number | boolean, spatchFind: string | number | boolean, spatchReplace: string | number | boolean): boolean`
Patches bytes in a file (copy of the original). The file must be excluded from symlinking (e.g. via `Game.FileSymlinkExclusions`).

### Context.PatchFileFindAll
`PatchFileFindAll(originalFile: string | number | boolean, patchedFile: string | number | boolean, patchFind: number[], patchReplace: number[]): boolean`
Path variables

### Context.PatchFileFindPattern
`PatchFileFindPattern(originalFile: string | number | boolean, patchedFile: string | number | boolean, origPattern: string | number | boolean, patchPattern: string | number | boolean, patchall: boolean): boolean` / `Context.PatchFileFindPattern(originalFile: string | number | boolean, patchedFile: string | number | boolean, origPattern: string | number | boolean, insert: number, offset: number, patchall: boolean): boolean`

### Context.PlayerGameFilesBackupFolder
`(read-only) PlayerGameFilesBackupFolder: string`
read-only

### Context.PlayerID
`PlayerID: number`
Zero-based index of the player/instance being set up.

### Context.PlayersPerInstance
`PlayersPerInstance: number`
If using XInputPlus or X360ce and there are multiple players playing the same instance, set the # per instance here.

Copied from `Game.PlayersPerInstance` for the current instance.

### Context.PlayerSteamID
`(read-only) PlayerSteamID: string`
read-only
Steam ID assigned to the current player.

### Context.PlayerSteamIDs
`PlayerSteamIDs: string[]`
A list of steam IDs to be used instead of the pre-defined ones Nucleuses uses | IDs will be used in order they are placed, i.e. instance 1 will be first non-empty string in array.

Copied from `Game.PlayerSteamIDs` for the current instance.

### Context.PostHookInstances
`PostHookInstances: string`
If you only want specific instances to have post launch hooks, specify them in a comma seperated string.

Copied from `Game.PostHookInstances` for the current instance.

### Context.PosX
`(read-only) PosX: number`
read-only · Path variables
X position of this instance's window.
Example: `Context.PosX`

### Context.PosY
`(read-only) PosY: number`
read-only · Path variables
Y position of this instance's window.
Example: `Context.PosY`

### Context.PreventWindowDeactivation
`PreventWindowDeactivation: boolean`
Blocks the processing of all the windows messages that get sent when the window loses focus.

Copied from `Game.PreventWindowDeactivation` for the current instance.

### Context.ProceedSymlink
`ProceedSymlink(): boolean`

### Context.ProcessID
`(read-only) ProcessID: number`
read-only · Path variables
Example: `Context.ProcessID`

### Context.ProcessorPriorityClass
`ProcessorPriorityClass: string`
Game.WriteToProcessMemory 				//(undocumented)
Sets the overall priority category for the associated process. Can be "AboveNormal", "High" or "RealTime" | default: "Normal".

Copied from `Game.ProcessorPriorityClass` for the current instance.

### Context.PromptBetweenInstances
`PromptBetweenInstances: boolean`
Prompt the user with a messagebox to let the user decide when to open the next instance | default: false, PauseBetweenStarts STILL required.

Copied from `Game.PromptBetweenInstances` for the current instance.

### Context.RandomInt
`RandomInt(min: number, max: number): number`
Path variables
Returns a random integer between min and max.

### Context.RandomString
`RandomString(size: number, lowerCase?: boolean): string`
Path variables
Returns a random alphanumeric string of the given length.

### Context.RawHID
`(read-only) RawHID: string`
read-only

### Context.ReadRegKey
`ReadRegKey(baseKey: string | number | boolean, sKey: string | number | boolean, subKey: string | number | boolean): string`
Path variables
Return the value of a provided key as a string.

### Context.RemoveLineInTextFile
`RemoveLineInTextFile(path: string | number | boolean, lineNum: number): void` / `Context.RemoveLineInTextFile(path: string | number | boolean, lineNum: number, encoder: string | number | boolean): void` / `Context.RemoveLineInTextFile(path: string | number | boolean, searchValue: string | number | boolean, type: Nucleus.SearchType | number | boolean): boolean` / `Context.RemoveLineInTextFile(path: string | number | boolean, searchValue: string | number | boolean, type: Nucleus.SearchType | number | boolean, encoder: string | number | boolean): boolean`
Path variables
Removes a given line number completely.

### Context.RenameNotKillMutex
`RenameNotKillMutex: boolean`
Instead of killing the mutex or handle, rename it on startup to something else | Requires Game.KillMutex to contain the EXACT name of the handles for this to work (no partial).

Copied from `Game.RenameNotKillMutex` for the current instance.

### Context.ReplaceLinesInTextFile
`ReplaceLinesInTextFile(path: string | number | boolean, newLines: string[]): boolean` / `Context.ReplaceLinesInTextFile(path: string | number | boolean, newLines: string[], encoder: string | number | boolean): boolean`
Path variables
Replace an entire line; for string array use the format: "lineNum|newValue", the | is required.

### Context.ReplacePartialLinesInTextFile
`ReplacePartialLinesInTextFile(path: string | number | boolean, newLines: string[]): boolean` / `Context.ReplacePartialLinesInTextFile(path: string | number | boolean, newLines: string[], encoder: string | number | boolean): boolean`
Path variables
Partially replace a line; for string array use the format: "lineNum|Regex pattern|newValue", the | is required.

### Context.ResetWindows
`ResetWindows: boolean`
After each new instance opens, resize, reposition and remove borders of the previous instance.

Copied from `Game.ResetWindows` for the current instance.

### Context.RootFolder
`RootFolder: string`
Root of the current instance's game folder (Nucleus-Coop\content\<GUID>\Instance<N>).

### Context.RootInstallFolder
`RootInstallFolder: string`
Path variables
Path to the source game root folder.
Example: `Context.RootInstallFolder`

### Context.RunAdditionalFiles
`RunAdditionalFiles(filePaths: string[], changeWorkingDir: boolean, secondsToPauseInbetween: number): void` / `Context.RunAdditionalFiles(filePaths: string[], changeWorkingDir: boolean, secondsToPauseInbetween: number, runAsAdmin: boolean, promptBetween: boolean): void` / `Context.RunAdditionalFiles(filePaths: string[], changeWorkingDir: boolean, customText: string | number | boolean, secondsToPauseInbetween: number, showFilePath: boolean, runAsAdmin: boolean, promptBetween: boolean, confirm: boolean): void`
Path variables
Specify additional files to run before launching game. By default will run each additional file once but can specify to run during specific player's instances by prefixing the filepath with #|. Replace # with player number. Can also specify to run files for each player by prefixing filepath with "all|". "bool confirm" will only run the file after clicking "Ok" in the prompt.

### Context.SavePath
`SavePath: string`
Not used but could be present in some handlers

Copied from `Game.SavePath` for the current instance.

### Context.SaveType
`SaveType: Nucleus.SaveType | number | boolean`
Not used but could be present in some handlers

Copied from `Game.SaveType` for the current instance.

### Context.ScriptFolder
`(read-only) ScriptFolder: string`
read-only · Path variables
Path to the Nucleus Co-op handlers root folder (Nucleus-Coop\handlers).
Example: `Context.ScriptFolder`

### Context.SearchSubFolder
`SearchSubFolder(parentDirectory: string | number | boolean, searchPattern: string | number | boolean): string`

### Context.SearchSubFolders
`SearchSubFolders(parentDirectory: string | number | boolean, searchPattern: string | number | boolean): string[]`

### Context.SetProtoInputMultipleControllers
`SetProtoInputMultipleControllers(controller1: number, controller2: number, controller3: number, controller4: number): void`

### Context.SetWindowHook
`SetWindowHook: boolean`
Prevent games from resizing their windows on their own | Hooks after all instances have been opened (see Game.SetWindowHookStart for an alternative).

Copied from `Game.SetWindowHook` for the current instance.

### Context.StartArguments
`StartArguments: string`
Path variables
Set launch(start) arguments for the exe from within the Game.Play() function

Copied from `Game.StartArguments` for the current instance.
Example: `Context.StartArguments = "";`

### Context.StartHookInstances
`StartHookInstances: string`
If you only want specific instances to have starting hooks, specify them in a comma seperated string.

Copied from `Game.StartHookInstances` for the current instance.

### Context.StartProcess
`StartProcess(path: string | number | boolean, args: string | number | boolean, asAdmin: boolean): boolean`
Starts a process with arguments, optionally elevated.

### Context.SteamID
`SteamID: string`
Here the SteamID of the game. You can find it on https://steamdb.info/ . Add only if the game is available on Steam.

Copied from `Game.SteamID` for the current instance.

### Context.SteamLang
`(read-only) SteamLang: string`
read-only
Copied from `Game.SteamLang` for the current instance.

### Context.SupportsKeyboard
`SupportsKeyboard: boolean`
Enable/disable use of one keyboard/mouse player.

Copied from `Game.SupportsKeyboard` for the current instance.

### Context.SymlinkExe
`SymlinkExe: boolean`
If SymlinkGame is enabled, if we should copy or symlink the game executable.

Copied from `Game.SymlinkExe` for the current instance.

### Context.SymlinkFiles
`SymlinkFiles: string[]`
Symlink individual files from the game directory to the instanced folder.

Copied from `Game.SymlinkFiles` for the current instance.

### Context.ToLowerCase
`ToLowerCase(str: any): string`

### Context.ToUpperCase
`ToUpperCase(str: any): string`

### Context.UseDevReorder
`UseDevReorder: boolean`
Set up Devreorder.

Copied from `Game.UseDevReorder` for the current instance.

### Context.UseDInputBlocker
`UseDInputBlocker: boolean`
Setup wizark952's dinput blocker (block dinput for the game).

Copied from `Game.UseDInputBlocker` for the current instance.

### Context.UseForceBindIP
`UseForceBindIP: boolean`
Set up game instances with ForceBindIP; each instance having their own IP.

Copied from `Game.UseForceBindIP` for the current instance.

### Context.UseGoldberg
`UseGoldberg: boolean`
Use the built-in Goldberg features in Nucleus | default: false.

Copied from `Game.UseGoldberg` for the current instance.

### Context.UseProcessor
`UseProcessor: string`
Sets the processors on which the game's threads can run on (provide the # of the cores in a comma-seperated list in quotations) | default: system delegation.

Copied from `Game.UseProcessor` for the current instance.

### Context.User
`User: UserInfo`
default `new UserInfo()`

### Context.UserName
`(read-only) UserName: string`
read-only
Windows user name.

### Context.UserProfileConfigPath
`UserProfileConfigPath: string`
Path variables
Relative path from user profile to game's config path | requires Game.UserProfileConfigPath be set.

Copied from `Game.UserProfileConfigPath` for the current instance.
Example: `Context.UserProfileConfigPath`

### Context.UserProfileConvertedToDocuments
`UserProfileConvertedToDocuments: boolean`

### Context.UserProfileSavePath
`UserProfileSavePath: string`
Path variables
Relative path from user profile to game's save path | requires Game.UserProfileSavePath be set.

Copied from `Game.UserProfileSavePath` for the current instance.
Example: `Context.UserProfileSavePath`

### Context.UseX360ce
`UseX360ce: boolean`
Before launching any games, Nucleus Co-op will open x360ce and let the user set up their controllers before continuing | close x360ce to continue | Don't use with custom dlls.

Copied from `Game.UseX360ce` for the current instance.

### Context.UtilFolder
`UtilFolder: string`
default `Globals.NucleusInstallRoot + "\\utils"`

### Context.Wait
`Wait(wait: number): void`
Pauses the handler for the given number of milliseconds.

### Context.Width
`(read-only) Width: number`
read-only
Width in pixels of this instance's window.

### Context.WorkingFolder
`WorkingFolder: string`
Relative path to where Nucleus should start the game's working folder to. Example: The main executable is on the root directory (left4dead2.exe), but the game expects to be started with a working folder of 'bin' (all the game's libraries are there).

Copied from `Game.WorkingFolder` for the current instance.

### Context.WriteTextFile
`WriteTextFile(path: string | number | boolean, ...lines: string | number | boolean): boolean`
Nemirtingas Epic Emulator
NemirtingasEpicEmu.json edition from a handler example:

### Context.X360ceDll
`X360ceDll: string[]`
If x360ce dll should be named something OTHER than xinput1_3.dll | requires Game.Usex360ce to be set to true.

Copied from `Game.X360ceDll` for the current instance.

### Context.x360ceGamepadGuid
`(read-only) x360ceGamepadGuid: string`
read-only · Path variables
Get the x360ce formatted gamepad guid.
Example: `Context.x360ceGamepadGuid`

### Context.XboxOneControllerFix
`XboxOneControllerFix: boolean`
When using x360ce, this will set certain hooktype that may work for xbox one controllers if the normal method does not work.

Copied from `Game.XboxOneControllerFix` for the current instance.

### Context.XInputPlusDll
`XInputPlusDll: string[]`
Set up XInputPlus | If multiple dlls required, use comma seperated strings.

Copied from `Game.XInputPlusDll` for the current instance.

### Context.XInputPlusOldDll
`XInputPlusOldDll: boolean`
When using Game.XInputPlusDll, you can specify to use the previous version instead of latest (needed for some games).

Copied from `Game.XInputPlusOldDll` for the current instance.

## Player

A player (`PlayerInfo`).

### Player.Adapter
`Adapter: string`

### Player.Affinity
`Affinity: string`
default `""`

### Player.CurrentLayout
`CurrentLayout: number`
default `0`

### Player.CurrentMaxGuests
`CurrentMaxGuests: number`
default `0`

### Player.DefaultMonitorBounds
`DefaultMonitorBounds: Rectangle`

### Player.DInputJoystick
`DInputJoystick: any`

### Player.Display
`Display: any`

### Player.DisplayIndex
`DisplayIndex: number`
default `-1`

### Player.EditBounds
`EditBounds: Rectangle`
A temporary rectangle to show the user where the game screen is going to be located

### Player.FlashIcon
`FlashIcon(): void`

### Player.GamepadGuid
`GamepadGuid: any`

### Player.GamepadHandle
`GamepadHandle: number`

### Player.GamepadId
`GamepadId: number`
default `-1`

### Player.GamepadMask
`GamepadMask: number`

### Player.GamepadName
`GamepadName: string`

### Player.GamepadProductGuid
`GamepadProductGuid: any`

### Player.GotGame
`GotGame: boolean`

### Player.GotLauncher
`GotLauncher: boolean`

### Player.GuestBounds
`GuestBounds: Rectangle`
If the player is instance guest

### Player.GuestsGuid
`GuestsGuid: any[]`
default `new List<Guid>()`

### Player.HIDDeviceID
`HIDDeviceID: string[]`

### Player.IdealProcessor
`IdealProcessor: string`
default `"*"`

### Player.InputType
`InputType: any`

### Player.InstanceGuests
`InstanceGuests: PlayerInfo[]`
default `new List<PlayerInfo>()`

### Player.InstanceId
`InstanceId: string`

### Player.IsController
`IsController: boolean`
Good to do not have to loop both Xinput & DInput

### Player.IsDInput
`IsDInput: boolean`

### Player.IsFake
`IsFake: boolean`

### Player.IsInputUsed
`IsInputUsed: boolean`

### Player.IsKeyboardPlayer
`IsKeyboardPlayer: boolean`

### Player.IsMinimized
`IsMinimized: boolean`
"IsMinimzed" used to sync all players window state if the window is not minimized by Nucleus and some other cases.

### Player.IsRawKeyboard
`IsRawKeyboard: boolean`

### Player.IsRawMouse
`IsRawMouse: boolean`

### Player.IsSDL2
`IsSDL2: boolean`

### Player.IsXInput
`IsXInput: boolean`

### Player.MonitorBounds
`MonitorBounds: Rectangle`
The bounds of this player's game screen

### Player.Nickname
`Nickname: string`

### Player.OtherLayout
`OtherLayout: any[]`

### Player.Owner
`Owner: any`

### Player.OwnerDisplay
`OwnerDisplay: Rectangle`

### Player.OwnerType
`OwnerType: number`

### Player.OwnerUIBounds
`OwnerUIBounds: Rectangle`

### Player.PlayerID
`PlayerID: number`
default `-1`

### Player.Polling
`Polling: boolean`

### Player.PriorityClass
`PriorityClass: string`
default `"Normal"`

### Player.ProcessData
`ProcessData: any`
Information about the game's process, null if its not running

### Player.ProcessID
`ProcessID: number`

### Player.ProtoController1
`ProtoController1: number`

### Player.ProtoController2
`ProtoController2: number`

### Player.ProtoController3
`ProtoController3: number`

### Player.ProtoController4
`ProtoController4: number`

### Player.ProtoInputInstanceHandle
`ProtoInputInstanceHandle: number`
default `0`

### Player.RawHID
`RawHID: string`

### Player.RawInputWindow
`RawInputWindow: any`

### Player.RawKeyboardDeviceHandle
`RawKeyboardDeviceHandle: number`
default `(IntPtr)(-1)`

### Player.RawMouseDeviceHandle
`RawMouseDeviceHandle: number`
default `(IntPtr)(-1)`

### Player.ScreenIndex
`ScreenIndex: number`
The index of this player

### Player.ScreenPriority
`ScreenPriority: number`

### Player.SDL2Joystick
`SDL2Joystick: any`

### Player.SID
`SID: string`

### Player.SourceEditBounds
`SourceEditBounds: Rectangle`

### Player.SteamEmu
`SteamEmu: boolean`

### Player.SteamID
`SteamID: number`

### Player.Tag
`Tag: any`
A custom tag object for handlers to store data in

### Player.UserProfile
`UserProfile: string`

### Player.Vibrate
`Vibrate: boolean`

### Player.WaitGuests
`(read-only) WaitGuests: boolean`
read-only

### Player.XInputJoystick
`XInputJoystick: any`

## ProtoInput

Proto Input runtime API.

### ProtoInput.AddHandleToRename
`AddHandleToRename(instanceHandle: number, name: string | number | boolean): void`

### ProtoInput.AddNamedPipeToRename
`AddNamedPipeToRename(instanceHandle: number, name: string | number | boolean): void`

### ProtoInput.AddSelectedKeyboardHandle
`AddSelectedKeyboardHandle(instanceHandle: number, keyboardHandle: number): void`

### ProtoInput.AddSelectedMouseHandle
`AddSelectedMouseHandle(instanceHandle: number, mouseHandle: number): void`

### ProtoInput.AllowFakeCursorOutOfBounds
`AllowFakeCursorOutOfBounds(instanceHandle: number, allowOutOfBounds: boolean, extendBounds: boolean): void`

### ProtoInput.DisableMessageBlock
`DisableMessageBlock(instanceHandle: number, messageID: number): void`

### ProtoInput.DisableMessageFilter
`DisableMessageFilter(instanceHandle: number, filterID: number): void`

### ProtoInput.EasyHookInjectRuntime
`EasyHookInjectRuntime(pid: number, dllFolderPath: string | number | boolean): number`

### ProtoInput.EasyHookInjectStartup
`EasyHookInjectStartup(exePath: string | number | boolean, commandLine: string | number | boolean, processCreationFlags: number, dllFolderPath: string | number | boolean, environment: number): number` / `ProtoInput.EasyHookInjectStartup(exePath: string | number | boolean, commandLine: string | number | boolean, processCreationFlags: number, dllFolderPath: string | number | boolean): number`

### ProtoInput.EasyHookStealthInjectRuntime
`EasyHookStealthInjectRuntime(pid: number, dllFolderPath: string | number | boolean): number`

### ProtoInput.EnableMessageBlock
`EnableMessageBlock(instanceHandle: number, messageID: number): void`

### ProtoInput.EnableMessageFilter
`EnableMessageFilter(instanceHandle: number, filterID: number): void`

### ProtoInput.GetTaskbarAutohide
`GetTaskbarAutohide(): boolean`

### ProtoInput.InstallHook
`InstallHook(instanceHandle: number, hookID: number): void`

### ProtoInput.LockInput
`LockInput(lockInput: boolean): number`

### ProtoInput.RemoteLoadLibraryInjectRuntime
`RemoteLoadLibraryInjectRuntime(pid: number, dllFolderPath: string | number | boolean): number`

### ProtoInput.RestartExplorer
`RestartExplorer(): void`

### ProtoInput.SetAdjustWindowRectSettings
`SetAdjustWindowRectSettings(instanceHandle: number, posx: number, posy: number, width: number, height: number): void`

### ProtoInput.SetControllerIndex
`SetControllerIndex(instanceHandle: number, controllerIndex: number, controllerIndex2: number, controllerIndex3: number, controllerIndex4: number): void`

### ProtoInput.SetCreateSingleHIDName
`SetCreateSingleHIDName(instanceHandle: number, name: string | number | boolean): void`

### ProtoInput.SetCursorClipOptions
`SetCursorClipOptions(instanceHandle: number, useFakeClipCursor: boolean): void`

### ProtoInput.SetDefaultBottomRightMouseBounds
`SetDefaultBottomRightMouseBounds(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetDefaultTopLeftMouseBounds
`SetDefaultTopLeftMouseBounds(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetDinputDeviceGUID
`SetDinputDeviceGUID(instanceHandle: number, Data1: number, Data2: number, Data3: number, Data4a: number, Data4b: number, Data4c: number, Data4d: number, Data4e: number, Data4f: number, Data4g: number, Data4h: number): void` / `ProtoInput.SetDinputDeviceGUID(instanceHandle: number, guid: any): void`

### ProtoInput.SetDinputHookAlsoHooksGetDeviceState
`SetDinputHookAlsoHooksGetDeviceState(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetDontWaitWindowBorder
`SetDontWaitWindowBorder(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetDrawFakeCursor
`SetDrawFakeCursor(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetDrawFakeCursorFix
`SetDrawFakeCursorFix(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetExternalFreezeFakeInput
`SetExternalFreezeFakeInput(instanceHandle: number, enableFreeze: boolean): void`

### ProtoInput.SetManualScaling
`SetManualScaling(instanceHandle: number, oldX: number, oldY: number, newX: number, newY: number): void`

### ProtoInput.SetMoveWindowDontReposition
`SetMoveWindowDontReposition(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetMoveWindowDontResize
`SetMoveWindowDontResize(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetMoveWindowSettings
`SetMoveWindowSettings(instanceHandle: number, posx: number, posy: number, width: number, height: number): void`

### ProtoInput.SetPointerInMouse
`SetPointerInMouse(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetPutMouseInsideWindow
`SetPutMouseInsideWindow(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetRawInputBypass
`SetRawInputBypass(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetReregisterinput
`SetReregisterinput(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetSendMessagesToSubWindows
`SetSendMessagesToSubWindows(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetSetWindowPosDontReposition
`SetSetWindowPosDontReposition(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetSetWindowPosDontResize
`SetSetWindowPosDontResize(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetSetWindowPosSettings
`SetSetWindowPosSettings(instanceHandle: number, posx: number, posy: number, width: number, height: number): void`

### ProtoInput.SetShowCursorWhenImageUpdated
`SetShowCursorWhenImageUpdated(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetTaskbarAutohide
`SetTaskbarAutohide(autohide: boolean): void`

### ProtoInput.SetToggleFakeCursorVisibilityShortcut
`SetToggleFakeCursorVisibilityShortcut(instanceHandle: number, enabled: boolean, vkey: number): void`

### ProtoInput.SetTranslateMKBtoXinput
`SetTranslateMKBtoXinput(instanceHandle: number, TranslateMKBtoXinput: boolean): void`

### ProtoInput.SetTranslateXinputtoMKB
`SetTranslateXinputtoMKB(instanceHandle: number, enable: boolean): void`

### ProtoInput.SetupMessagesToSend
`SetupMessagesToSend(instanceHandle: number, sendMouseWheelMessages: boolean, sendMouseButtonMessages: boolean, sendMouseMoveMessages: boolean, sendKeyboardPressMessages: boolean, sendMouseDblClkMessages: boolean): void`

### ProtoInput.SetupState
`SetupState(instanceHandle: number, instanceIndex: number): void`

### ProtoInput.SetUseDinputRedirection
`SetUseDinputRedirection(instanceHandle: number, useRedirection: boolean): void`

### ProtoInput.SetUseOpenXinput
`SetUseOpenXinput(instanceHandle: number, useOpenXinput: boolean): void`

### ProtoInput.SetXinputtoMKBCFG
`SetXinputtoMKBCFG(instanceHandle: number, stickinvert: boolean, scanoption: boolean, shoulderswap: boolean, astatic: boolean, aclick: boolean, amove: boolean, bstatic: boolean, bclick: boolean, bmove: boolean, xstatic: boolean, xclick: boolean, xmove: boolean, ystatic: boolean, yclick: boolean, ymove: boolean): void`

### ProtoInput.SetXinputtoMKBkeys
`SetXinputtoMKBkeys(instanceHandle: number, XinputtoMKBAkey: number, XinputtoMKBBkey: number, XinputtoMKBXkey: number, XinputtoMKBYkey: number, XinputtoMKBRSkey: number, XinputtoMKBLSkey: number, XinputtoMKBrightkey: number, XinputtoMKBleftkey: number, XinputtoMKBupkey: number, XinputtoMKBdownkey: number, XinputtoMKBstickR: number, XinputtoMKBstickL: number, XinputtoMKBstickright: number, XinputtoMKBstickleft: number, XinputtoMKBstickup: number, XinputtoMKBstickdown: number, XinputtoMKBoption: number, XinputtoMKBstart: number, XinputtoMKBsens: number, XinputtoMKBsensmult: number, XinputtoMKBDeadzone: number): void`

### ProtoInput.StartFocusMessageLoop
`StartFocusMessageLoop(instanceHandle: number, milliseconds: number, wm_activate: boolean, wm_activateapp: boolean, wm_ncactivate: boolean, wm_setfocus: boolean, wm_mouseactivate: boolean): void`

### ProtoInput.StopFocusMessageLoop
`StopFocusMessageLoop(instanceHandle: number): void`

### ProtoInput.SuspendExplorer
`SuspendExplorer(): void`

### ProtoInput.UninstallHook
`UninstallHook(instanceHandle: number, hookID: number): void`

### ProtoInput.UpdateMainWindowHandle
`UpdateMainWindowHandle(instanceHandle: number, hwnd: number): void`

### ProtoInput.Values
`(read-only) Values: ProtoInputValues`
read-only
Hook and message filter IDs for `InstallHook`, `EnableMessageFilter`, ...

### ProtoInput.WakeUpProcess
`WakeUpProcess(instanceHandle: number): void`

## ProtoInput.Values

Proto Input hook/filter ids.

### ProtoInput.Values.AdjustWindowRectHookID
`AdjustWindowRectHookID: number`
default `(uint)ProtoHookIDs.AdjustWindowRectHookID`

### ProtoInput.Values.BlockRawInputHookID
`BlockRawInputHookID: number`
default `(uint)ProtoHookIDs.BlockRawInputHookID`

### ProtoInput.Values.ClipCursorHookID
`ClipCursorHookID: number`
default `(uint)ProtoHookIDs.ClipCursorHookID`

### ProtoInput.Values.CreateSingleHIDHookID
`CreateSingleHIDHookID: number`
default `(uint)ProtoHookIDs.CreateSingleHIDHookID`

### ProtoInput.Values.CursorVisibilityStateHookID
`CursorVisibilityStateHookID: number`
default `(uint)ProtoHookIDs.CursorVisibilityStateHookID`

### ProtoInput.Values.DinputOrderHookID
`DinputOrderHookID: number`
default `(uint)ProtoHookIDs.DinputOrderHookID`

### ProtoInput.Values.FindWindowHookID
`FindWindowHookID: number`
default `(uint)ProtoHookIDs.FindWindowHookID`

### ProtoInput.Values.FocusHooksHookID
`FocusHooksHookID: number`
default `(uint)ProtoHookIDs.FocusHooksHookID`

### ProtoInput.Values.GetAsyncKeyStateHookID
`GetAsyncKeyStateHookID: number`
default `(uint)ProtoHookIDs.GetAsyncKeyStateHookID`

### ProtoInput.Values.GetCursorInfoID
`GetCursorInfoID: number`
default `(uint)ProtoHookIDs.RemoveBorderHookID`

### ProtoInput.Values.GetCursorPosHookID
`GetCursorPosHookID: number`
default `(uint)ProtoHookIDs.GetCursorPosHookID`

### ProtoInput.Values.GetKeyboardStateHookID
`GetKeyboardStateHookID: number`
default `(uint)ProtoHookIDs.GetKeyboardStateHookID`

### ProtoInput.Values.GetKeyStateHookID
`GetKeyStateHookID: number`
default `(uint)ProtoHookIDs.GetKeyStateHookID`

### ProtoInput.Values.GetRawInputDataHookID
`GetRawInputDataHookID: number`
default `(uint)ProtoHookIDs.GetRawInputDataHookID`

### ProtoInput.Values.KeyboardButtonFilterID
`KeyboardButtonFilterID: number`
default `(uint)ProtoMessageFilterIDs.KeyboardButtonFilterID`

### ProtoInput.Values.MessageFilterHookID
`MessageFilterHookID: number`
default `(uint)ProtoHookIDs.MessageFilterHookID`

### ProtoInput.Values.MouseActivateFilterID
`MouseActivateFilterID: number`
default `(uint)ProtoMessageFilterIDs.MouseActivateFilterID`

### ProtoInput.Values.MouseButtonFilterID
`MouseButtonFilterID: number`
default `(uint)ProtoMessageFilterIDs.MouseButtonFilterID`

### ProtoInput.Values.MouseMoveFilterID
`MouseMoveFilterID: number`
default `(uint)ProtoMessageFilterIDs.MouseMoveFilterID`

### ProtoInput.Values.MouseWheelFilterID
`MouseWheelFilterID: number`
default `(uint)ProtoMessageFilterIDs.MouseWheelFilterID`

### ProtoInput.Values.MoveWindowHookID
`MoveWindowHookID: number`
default `(uint)ProtoHookIDs.MoveWindowHookID`

### ProtoInput.Values.RawInputFilterID
`RawInputFilterID: number`
default `(uint)ProtoMessageFilterIDs.RawInputFilterID`

### ProtoInput.Values.RegisterRawInputHookID
`RegisterRawInputHookID: number`
default `(uint)ProtoHookIDs.RegisterRawInputHookID`

### ProtoInput.Values.RemoveBorderHookID
`RemoveBorderHookID: number`
default `(uint)ProtoHookIDs.RemoveBorderHookID`

### ProtoInput.Values.RenameHandlesHookID
`RenameHandlesHookID: number`
default `(uint)ProtoHookIDs.RenameHandlesHookID`

### ProtoInput.Values.SetCursorPosHookID
`SetCursorPosHookID: number`
default `(uint)ProtoHookIDs.SetCursorPosHookID`

### ProtoInput.Values.SetWindowPosHookID
`SetWindowPosHookID: number`
default `(uint)ProtoHookIDs.SetWindowPosHookID`

### ProtoInput.Values.SetWindowsHookHookID
`SetWindowsHookHookID: number`
default `(uint)ProtoHookIDs.SetWindowsHookHookID`

### ProtoInput.Values.WindowActivateAppFilterID
`WindowActivateAppFilterID: number`
default `(uint)ProtoMessageFilterIDs.WindowActivateAppFilterID`

### ProtoInput.Values.WindowActivateFilterID
`WindowActivateFilterID: number`
default `(uint)ProtoMessageFilterIDs.WindowActivateFilterID`

### ProtoInput.Values.WindowStyleHookID
`WindowStyleHookID: number`
default `(uint)ProtoHookIDs.WindowStyleHookID`

### ProtoInput.Values.XinputHookID
`XinputHookID: number`
default `(uint)ProtoHookIDs.XinputHookID`

## Hub.Handler

Hub handler identity.

### Hub.Handler.Id
`Id: string`
Handler id on hub.splitscreen.me.

### Hub.Handler.Version
`Version: number`
Published version number. Nucleus compares it with the hub to offer updates.

## Hub.Maintainer

Hub maintainer.

### Hub.Maintainer.Id
`Id: string`
Maintainer user id on the hub.

### Hub.Maintainer.Name
`Name: string`
Maintainer display name.

## Nucleus enums

### Nucleus.Folder
Location of a folder used by `Context.GetFolder(...)`.
`Documents` = 0, `MainGameFolder` = 1, `InstancedGameFolder` = 2

### Nucleus.SaveType
Format of a save/config file for `Context.ModifySaveFile(...)`.
`None` = 0, `INI` = 1, `CFG` = 2, `SCR` = 3

### Nucleus.SearchType
How a text line is matched by the text-file helpers.
`Contains` = 0, `Full` = 1, `StartsWith` = 2

### Nucleus.RegType
Registry value kind for `Context.EditRegKey(...)`.
`Binary` = 3, `DWord` = 4, `ExpandString` = 2, `MultiString` = 7, `None` = -1, `QWord` = 11, `String` = 1, `Unknown` = 0

### Nucleus.DPIHandling
How Nucleus compensates for Windows DPI scaling when sizing windows.
`True` = 0, `Scaled` = 1, `InvScaled` = 2

### Nucleus.DpiAwarenessMode
DPI awareness compatibility flag applied to the game executable.
`HighDpiAware` = 0, `DpiUnaware` = 1, `DpiAware` = 2, `GdiDpiScaling_DpiUnaware` = 3, `GdiDpiScaling_DpiUnaware_GdiScale` = 4

## Nucleus classes

### Nucleus.IniSaveInfo
`new Nucleus.IniSaveInfo(section, key, value)`
A key in an INI file, for `Context.ModifySaveFile(..., Nucleus.SaveType.INI, [...])`.

### Nucleus.CfgSaveInfo
`new Nucleus.CfgSaveInfo(section, key, value)`
A key in a CFG file, for `Context.ModifySaveFile(..., Nucleus.SaveType.CFG, [...])`.

### Nucleus.SaveInfo
`new Nucleus.SaveInfo(section, key, value)`
Base class of save file entries.

