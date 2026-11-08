// Ready-made pieces of handler code for things most handlers do, offered as suggestions only where a statement starts
// and only once part of their name is typed (or on Ctrl+Space): nothing on screen for anyone who didn't ask. Written
// the way Hub handlers do them, ES5 and lint-clean (a test lints every body). `$1`, `${1:text}`, `${1|a,b|}`, `$0`:
// the snippet syntax VS Code and LSP share (a backslash is written `\\\\` there); editors without snippets get the plain text.

export interface Snippet {
  prefix: string;
  label: string;
  /** Markdown: what it does and what to change. */
  doc: string;
  body: string;
  /** Where it makes sense: in a callback such as `Game.Play` (Context, PlayerList), or at the top level. */
  where: 'callback' | 'top';
}

export const SNIPPETS: Snippet[] = [
  {
    prefix: 'startargs',
    label: 'Launch arguments with the window size',
    doc: 'Sets `Context.StartArguments` for this player, with the size Nucleus gives the window. Change the argument names to the game\'s own.',
    body: 'Context.StartArguments = "${1:-windowed} ${2:-width} " + Context.Width + " ${3:-height} " + Context.Height;',
    where: 'callback',
  },
  {
    prefix: 'iniset',
    label: 'Set keys in an INI file',
    doc: 'Changes keys in this player\'s copy of an INI file with `Context.ModifySaveFile`. Point the path at the game\'s config file.',
    body: 'var ini = Context.GetFolder(Nucleus.Folder.${1|InstancedGameFolder,Documents|}) + "${2:\\\\\\\\config.ini}";\nContext.ModifySaveFile(ini, ini, Nucleus.SaveType.INI, [\n\tnew Nucleus.IniSaveInfo("${3:Section}", "${4:Width}", Context.Width),\n\tnew Nucleus.IniSaveInfo("${3:Section}", "${5:Height}", Context.Height)\n]);\n$0',
    where: 'callback',
  },
  {
    prefix: 'replacelines',
    label: 'Replace lines in a text file (found by how they start)',
    doc: 'Finds each line by its start with `Context.FindLineNumberInTextFile` and replaces it with `Context.ReplaceLinesInTextFile`: each entry is `line number + "|" + new line`. The usual way Hub handlers edit .cfg and .txt files.',
    body: 'var txtPath = Context.GetFolder(Nucleus.Folder.InstancedGameFolder) + "${1:\\\\\\\\config.cfg}";\nvar dict = [\n\tContext.FindLineNumberInTextFile(txtPath, "${2:Width}", Nucleus.SearchType.StartsWith) + "|${2:Width}=" + Context.Width,\n\tContext.FindLineNumberInTextFile(txtPath, "${3:Height}", Nucleus.SearchType.StartsWith) + "|${3:Height}=" + Context.Height\n];\nContext.ReplaceLinesInTextFile(txtPath, dict);\n$0',
    where: 'callback',
  },
  {
    prefix: 'regkey',
    label: 'Set a registry value',
    doc: 'Sets a value under the game\'s registry key with `Context.EditRegKey`, e.g. its window size. Write the key path with double backslashes.',
    body: 'Context.EditRegKey("${1|HKEY_CURRENT_USER,HKEY_LOCAL_MACHINE|}", "${2:SOFTWARE}", "${3:Name}", ${4:Context.Width}, Nucleus.RegType.${5|DWord,String|});',
    where: 'callback',
  },
  {
    prefix: 'ifoption',
    label: 'Do something when an option is chosen',
    doc: 'Runs code when the player picked a value of an option added with `Game.AddOption`. Options come back as text, so compare with the text.',
    body: 'if (Context.Options["${1:key}"] == "${2:Yes}") {\n\t$0\n}',
    where: 'callback',
  },
  {
    prefix: 'firstplayer',
    label: 'Only for the first player',
    doc: 'Runs code for the first player\'s instance only (`Context.PlayerID` counts from 0).',
    body: 'if (Context.PlayerID == 0) {\n\t$0\n}',
    where: 'callback',
  },
  {
    prefix: 'eachplayer',
    label: 'Each player',
    doc: 'Goes through every player of the session (`PlayerList`), e.g. in a Proto Input lock callback.',
    body: 'for (var i = 0; i < PlayerList.Count; i++) {\n\tvar player = PlayerList[i];\n\t$0\n}',
    where: 'callback',
  },
  {
    prefix: 'option',
    label: 'An option players choose before starting',
    doc: 'Adds an option to the game\'s setup with `Game.AddOption(name, description, key, values)`. Read it in `Game.Play` with `Context.Options["key"]` (the `ifoption` snippet).',
    body: 'Game.AddOption("${1:Option name}", "${2:What it changes}", "${3:key}", ["${4:Yes}", "${5:No}"]);',
    where: 'top',
  },
];
