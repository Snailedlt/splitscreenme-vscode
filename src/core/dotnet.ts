// The parts of .NET's `System` namespace that handlers use, by hand: the generator only reads the
// Nucleus sources, so `System` was a name with nothing under it. Picked from the Hub handlers
// (Path.Combine, File.Copy/Exists/Delete, Directory.CreateDirectory/Exists, Thread.Sleep are in
// most of them). Signatures are .NET Framework's (Nucleus targets it); Jint 2.11.58 matches an
// overload only by its exact parameter count (probe 118), so list each count that exists.
//
// These objects are `open`: a member that isn't listed is still allowed (it may well exist in
// .NET), unless it looks like a typo of one that is.
import type { ApiObject, Member, Overload, Param } from './api';

const p = (name: string, type = 'string', csType = 'string'): Param => ({ name, type, csType });
const fn = (doc: string, ...overloads: [returns: string, params: Param[]][]): Member => ({
  kind: 'method',
  doc,
  overloads: overloads.map(([returns, params]): Overload => ({ returns, params })),
});
const ns = (ref: string, doc: string): Member => ({ kind: 'object', type: 'any', ts: ref, ref, doc });
const prop = (type: 'string' | 'number', doc: string): Member => ({ kind: 'property', type, ts: type, readonly: true, doc });

const PATHS = 'Paths are Windows paths: write `\\\\` in a string, or build them with `System.IO.Path.Combine`.';

export const DOTNET_OBJECTS: Record<string, ApiObject & { open: true }> = {
  System: {
    open: true,
    doc: "The .NET `System` namespace. Handlers mostly use `System.IO` for files and folders.",
    members: {
      IO: ns('System.IO', 'Files, folders and paths.'),
      Environment: ns('System.Environment', 'The current user and computer.'),
      Threading: ns('System.Threading', 'Waiting (`System.Threading.Thread.Sleep`).'),
    },
  },
  'System.IO': {
    open: true,
    doc: 'Files, folders and paths (.NET `System.IO`).',
    members: {
      File: ns('System.IO.File', 'Copy, delete, check, read and write files.'),
      Directory: ns('System.IO.Directory', 'Create, delete, check and list folders.'),
      Path: ns('System.IO.Path', 'Build and take apart paths.'),
    },
  },
  'System.IO.File': {
    open: true,
    doc: `Copy, delete, check, read and write files. ${PATHS}`,
    members: {
      Exists: fn('Whether the file exists. `false` for a folder.', ['boolean', [p('path')]]),
      Copy: fn(
        'Copies a file. With `overwrite` false (or left out) it throws if the destination exists, which ends the session inside `Game.Play`.',
        ['void', [p('sourceFileName'), p('destFileName')]],
        ['void', [p('sourceFileName'), p('destFileName'), p('overwrite', 'boolean', 'bool')]],
      ),
      Delete: fn("Deletes a file. No error if the file doesn't exist (its folder must); throws if it's in use or read-only.", ['void', [p('path')]]),
      Move: fn('Moves or renames a file. Throws if the destination exists.', ['void', [p('sourceFileName'), p('destFileName')]]),
      ReadAllText: fn('The whole file as one string.', ['string', [p('path')]]),
      ReadAllLines: fn('The file as a list of lines.', ['string[]', [p('path')]]),
      WriteAllText: fn('Writes the string to the file, replacing what was there (creates the file if needed).', ['void', [p('path'), p('contents')]]),
      WriteAllLines: fn('Writes the lines to the file, replacing what was there.', ['void', [p('path'), p('contents', 'string[]', 'string[]')]]),
      AppendAllText: fn('Adds the string to the end of the file (creates the file if needed).', ['void', [p('path'), p('contents')]]),
      GetAttributes: fn('The file\'s attributes, e.g. `System.IO.FileAttributes.ReadOnly`.', ['number', [p('path')]]),
      SetAttributes: fn('Sets the file\'s attributes, e.g. `System.IO.FileAttributes.Normal` to clear read-only.', ['void', [p('path'), p('fileAttributes', 'number', 'FileAttributes')]]),
    },
  },
  'System.IO.Directory': {
    open: true,
    doc: `Create, delete, check and list folders. ${PATHS} .NET has no Directory.Copy: copy the files one by one (\`GetFiles\` and \`System.IO.File.Copy\`).`,
    members: {
      Exists: fn('Whether the folder exists.', ['boolean', [p('path')]]),
      CreateDirectory: fn('Creates the folder and any missing parent folders. Nothing happens if it already exists.', ['any', [p('path')]]),
      Delete: fn(
        'Deletes a folder. Without `recursive` (or with false) the folder must be empty.',
        ['void', [p('path')]],
        ['void', [p('path'), p('recursive', 'boolean', 'bool')]],
      ),
      Move: fn('Moves or renames a folder.', ['void', [p('sourceDirName'), p('destDirName')]]),
      GetFiles: fn(
        'Full paths of the files in a folder, optionally matching a pattern like `"*.ini"`.',
        ['string[]', [p('path')]],
        ['string[]', [p('path'), p('searchPattern')]],
      ),
      GetDirectories: fn(
        'Full paths of the folders in a folder, optionally matching a pattern.',
        ['string[]', [p('path')]],
        ['string[]', [p('path'), p('searchPattern')]],
      ),
    },
  },
  'System.IO.Path': {
    open: true,
    doc: 'Build and take apart paths, without touching the disk.',
    members: {
      Combine: fn(
        'Joins path parts with `\\`, e.g. `System.IO.Path.Combine(Game.Folder, "config.ini")`.',
        ['string', [p('path1'), p('path2')]],
        ['string', [p('path1'), p('path2'), p('path3')]],
        ['string', [p('path1'), p('path2'), p('path3'), p('path4')]],
        // .NET also has Combine(params string[]), and Jint 2.11 expands it: 1 or 5 parts work (testbench probes 114, 115).
        ['string', [{ name: 'paths', type: 'string', csType: 'string[]', rest: true }]],
      ),
      GetFileName: fn('The file name with its extension: `C:\\a\\b.ini` → `b.ini`.', ['string', [p('path')]]),
      GetFileNameWithoutExtension: fn('The file name without its extension: `C:\\a\\b.ini` → `b`.', ['string', [p('path')]]),
      GetExtension: fn('The extension with its dot: `C:\\a\\b.ini` → `.ini`.', ['string', [p('path')]]),
      GetDirectoryName: fn('The folder part: `C:\\a\\b.ini` → `C:\\a`.', ['string', [p('path')]]),
      ChangeExtension: fn('The path with another extension, e.g. `".bak"`.', ['string', [p('path'), p('extension')]]),
    },
  },
  'System.Environment': {
    open: true,
    doc: "The current user and computer: the Windows account's, not a player's (that's `Context.Nickname`).",
    members: {
      UserName: prop('string', 'The Windows user name of whoever runs Nucleus.'),
      MachineName: prop('string', "The computer's name."),
      GetEnvironmentVariable: fn('An environment variable, e.g. `"APPDATA"`, or null if it is not set.', ['string', [p('variable')]]),
    },
  },
  'System.Threading': {
    open: true,
    doc: 'Threads (`System.Threading.Thread.Sleep`).',
    members: {
      Thread: ns('System.Threading.Thread', 'The current thread.'),
    },
  },
  'System.Threading.Thread': {
    open: true,
    doc: 'The current thread.',
    members: {
      Sleep: fn('Waits this many milliseconds. Nucleus waits with it, so keep it short.', ['void', [p('millisecondsTimeout', 'number', 'int')]]),
    },
  },
};

// Topics for the workbench's Lines and the API reference.
for (const [owner, o] of Object.entries(DOTNET_OBJECTS)) {
  const category = owner.startsWith('System.IO') ? 'Files and folders (System.IO)' : 'Other .NET (System)';
  for (const m of Object.values(o.members)) if (m.kind !== 'object') m.category = category;
}
