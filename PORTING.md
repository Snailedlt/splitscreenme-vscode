# Porting the handler tools to other editors

How to bring the SplitScreen.Me / Nucleus Co-op handler features (checks with quick fixes, hover docs, completion, signature help, Format Document, window-message hints, "Try it") to an editor other than VS Code. Written for people and for AI agents doing the port.

**Short version:** run `ncdev lsp` (`nucleus lsp` is the old name and still works) as a Language Server for JavaScript files. Every editor with an LSP client gets almost everything the VS Code extension has. Snippets for each editor are [below](#wiring-ncdev-lsp-into-an-editor).

## Architecture

```
src/core/          editor-agnostic logic, plain data, no vscode and no Node APIs
  lint.ts          the checks (RULES) -> Diagnostic { rule, severity, message, start, end, fixes, tags }
  fix.ts           "Fix all": every safe (preferred) fix, repeated until stable
  format.ts        Format Document: indentation, spacing, quotes, semicolons; refuses when unsure
  complete.ts      text-based resolution at a cursor (works on unfinished code)
  features.ts      the editor features, built on the above (hover, completion, ... see the table)
  api.ts, wm.ts    the API model, the window-message table
  sim.ts           "Try it" (run only through src/sandbox.ts)

adapters           convert core results to an editor's types, nothing more
  src/extension.ts VS Code
  src/lsp.ts       Language Server Protocol (`ncdev lsp`), for every other editor
  src/mcp.ts       MCP server (`ncdev mcp`), for AI agents
  src/cli.ts       the `ncdev` command line (old name `nucleus`)
  npp-plugin/      the Notepad++ plugin: a small client of `ncdev lsp` (C++)
```

Positions in core are offsets into the text, counted in UTF-16 code units (what JavaScript strings index, and LSP's default `positionEncoding`). An adapter converts them to its line/column type. A new feature goes into `src/core/features.ts` first, then every adapter converts it.

## The features and the core function behind each

| Feature | Core function | VS Code (`src/extension.ts`) | LSP (`src/lsp.ts`) |
|---|---|---|---|
| Problems, with rule id and link | `lint()` (`core/lint.ts`) | DiagnosticCollection | `textDocument/publishDiagnostics` (`code` = rule id, `codeDescription` = the README rule table, `tags` unnecessary/deprecated) |
| Quick fixes ("Change to `ForceFocus`", "Disable *rule* for this line", "Fix all N") | `quickFixes()` | CodeActionProvider | `textDocument/codeAction` (`quickfix`, `isPreferred` on safe fixes) |
| Fix all (also fix on save) | `fixAllCodeAction()`, `fixAllAction()` | `source.fixAll.nucleus`, **Nucleus: Fix All** | `source.fixAll.nucleus` code action, `nucleus.fixAll` command |
| Hover docs (members, enums, globals, window messages) | `hoverAt()` | HoverProvider | `textDocument/hover` (Markdown) |
| Completion (members, whole assignments as snippets, globals, window messages in `BlockedMessages`) | `completionsAt()` | CompletionItemProvider | `textDocument/completion` (snippets as `insertTextFormat: 2`, plain text for clients without snippet support) |
| Value suggestions after `=` (enum values, `true`/`false`, `function () {}`) | `completionsAt()` (via `valueContextAt()`) | same | same |
| Signature help (overloads, active parameter) | `signatureHelpAt()` | SignatureHelpProvider | `textDocument/signatureHelp` |
| Format Document | `formatEdits()` (`core/format.ts`) | DocumentFormattingEditProvider | `textDocument/formatting`; a refusal is a `window/showMessage` warning and no edits |
| Package (.nc), Install to Nucleus Co-op | `buildPackage()` (`core/pkg.ts`), `installHandler()` (`src/install.ts`) | **Nucleus: Package** / **Install** commands | source code actions `source.nucleus.package`, `source.nucleus.install` (Install once `nucleus.nucleusPath` is set), and `workspace/executeCommand` `nucleus.package` / `nucleus.install` with `{ uri }` |
| Test in Nucleus Co-op (Windows) | `testInNucleus()` (`src/nucleusrun.ts`) | **Nucleus: Test in Nucleus Co-op** | `nucleus.testInNucleus` with `{ uri, restart?, debugLog? }`; answers `{ started: false, running: true }` when Nucleus is open, so the editor can ask, then call again with `restart: true` |
| New handler | `renderHandler()` (`core/templates.ts`) | **Nucleus: New Handler** | `nucleus.newHandler` with `{ name, exe, dir }` (writes the file, then `window/showDocument`); in an empty file, the `handler` suggestion inserts the whole template |
| Format Selection, format on type | `rangeFormatEdits()` | DocumentRangeFormattingEditProvider, OnTypeFormattingEditProvider (`}` `;` Enter) | `textDocument/rangeFormatting`, `textDocument/onTypeFormatting`; style from settings `nucleus.format.quotes` (`double`/`single`/`keep`) and `nucleus.format.semicolons` (`add`/`keep`) |
| Outline, breadcrumbs, Go to Symbol (settings by object, callbacks with what they set, the handler's own names) | `documentSymbols()` | DocumentSymbolProvider | `textDocument/documentSymbol` (hierarchical) |
| Package checks (the files in `<Name>/`) | `checkPackage()` (`core/pkgcheck.ts`) + `packageFilesFor()` (`src/pkgfiles.ts`) | Problems on the handler and on those files | `publishDiagnostics` for the handler and for each of those files |
| Checks against the game's install folder | `checkAgainstFolder()` (`core/gamefolder.ts`) + `folderAt()` (`src/gamefolder-node.ts`) | **Link the Game's Folder…**, problems, quick fixes, file suggestions in the lists | the `gameFolders` setting; problems with the fix in `data`, `quickfix` code actions, completion inside the lists |
| Window-message names after `0x0008` | `inlayHints()` | InlayHintsProvider | `textDocument/inlayHint` |
| Go to definition, find references | `definitionAt()`, `referencesAt()` (`core/definition.ts`) | F12 (with VS Code's own JavaScript support) | `textDocument/definition`, `textDocument/references` |
| Rename the handler's own names | `renameTargetAt()`, `renameEdits()` (`core/definition.ts`) | VS Code's own JavaScript support | `textDocument/prepareRename`, `textDocument/rename` |
| Links from API names to their docs | `{ docsLink }` on `hoverAt`/`completionsAt`/`signatureHelpAt`; the pages: `docsPage()` (`core/docspage.ts`) | command links to the **Nucleus Docs** panel (`src/docspanel.ts`) | links to the workbench's `#docs-<name>` (`workbenchDocsUrl()`, `?ref=` the client's name) |
| The handler's own functions, variables and options | `visibleNames()`, `addedOptions()` (`core/ownsymbols.ts`), in completion, hover and signature help | `Context.Options` keys and values only (`{ own: false }`: VS Code's JavaScript support does the rest) | in `textDocument/completion` (names once a letter is typed, or on request), `hover`, `signatureHelp` |
| Open in the browser workbench | `workbenchLink()` (`core/sharelink.ts`), `workbenchLinkFor()` (`src/workbenchlink.ts`) | **Nucleus: Open in the Browser Workbench** | `workspace/executeCommand` `nucleus.workbenchLink` `{ uri, ref }`, returns `{ url, withHandler }` |
| Try it (what each player gets) | `simulateIsolated()` (`src/sandbox.ts`) + `formatSimulation()` (`src/simformat.ts`) | **Nucleus: Try It** panel | `workspace/executeCommand` `nucleus.tryIt`, returns the text |
| Is this file a handler? | `isHandlerFile()` | `isHandler()` | same, plus the `handlerGlobs` setting |

## Getting the server

`ncdev lsp` is a subcommand of the `ncdev` CLI. Any of these work:

- **Standalone, nothing to install (Windows):** `ncdev.exe` from the [newest release](https://github.com/Snailedlt/splitscreenme-vscode/releases), then `ncdev lsp` (`ncdev update` keeps it current). In the snippets, use `ncdev` in place of `node /path/to/nucleus.js`.
- **One file, with Node.js 18+:** [`plugin/skills/nucleus-handler/scripts/nucleus.js`](https://raw.githubusercontent.com/Snailedlt/splitscreenme-vscode/main/plugin/skills/nucleus-handler/scripts/nucleus.js) is the whole CLI bundled. Save it anywhere and run `node /path/to/nucleus.js lsp`.
- **From a clone:** `npm ci && npm run build`, then `node dist/cli.js lsp`.
- **With the VS Code extension installed:** its `dist/cli.js` (in `~/.vscode/extensions/splitscreenme.*/dist/`).

The snippets below write the command as `node /path/to/nucleus.js lsp`; replace the path. `--stdio` is accepted and ignored (stdio is the only transport), for clients that always add it.

### Settings

Send them as `initializationOptions`, or later as `workspace/didChangeConfiguration` with `{ "settings": { "nucleus": { ... } } }`. All are optional:

```json
{
  "detection": "auto",
  "handlerGlobs": ["**/my-handlers/*.js"],
  "lint": { "enable": true, "rules": { "unknown-member": "error" }, "compareWithHub": true, "workspace": true },
  "completion": { "enable": true },
  "gameFolders": { "MyGame.js": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\MyGame" }
}
```

- `detection`: `auto` (default; see [handler detection](#how-handler-files-are-detected)), `always` (every `.js` file) or `off`.
- `handlerGlobs`: paths that always count as handlers (`**` any folders, `*` any name part, matched against the end of the path).
- `lint.rules`: per-rule severity, `error`, `warning`, `info`, `hint` or `off` (`nucleus rules` lists them).
- `lint.compareWithHub`: for a handler with a `Hub.Handler.Id`, compare `Game.GUID` with the Hub's version (downloads it once, cached; the problem list updates when it arrives). `false` keeps the server offline.
- `lint.workspace`: check every handler in the workspace folders, opened or not (default `true`), and re-check files that change on disk (when the client supports watched files: the server asks to watch `**/*.js` and each handler's `<Name>/` folder, not the whole workspace, and ignores `node_modules` and dot folders).
- `gameFolders`: the game's install folder per handler file name. The handler is then checked against the real files (`ExecutableName`, `BinariesFolder`, the symlink and copy lists…), each problem's fix comes as a quick fix, and completion inside those lists offers the game's own files. Only names and sizes are read.
- `completion.enable`: hover, completion, signature help and inlay hints. Turn it off if TypeScript provides them (the `.d.ts` in `types/`).

The same names as the VS Code settings, without the `splitscreenme.` prefix; a `splitscreenme` key is accepted too.

## Wiring `ncdev lsp` into an editor

Handlers are JavaScript, so attach the server to JavaScript buffers. It ignores files that aren't handlers, so it can run next to your usual JavaScript/TypeScript server.

### Neovim (0.11+, built in)

```lua
vim.lsp.config('nucleus', {
  cmd = { 'node', '/path/to/nucleus.js', 'lsp' },
  filetypes = { 'javascript' },
  root_markers = { 'handlers', '.git' },
  init_options = { lint = { compareWithHub = true } },
})
vim.lsp.enable('nucleus')
-- Inlay hints (window-message names): vim.lsp.inlay_hint.enable(true)
-- Fix all: vim.lsp.buf.code_action({ context = { only = { 'source.fixAll' } }, apply = true })
-- Try it: vim.lsp.buf_request(0, 'workspace/executeCommand',
--   { command = 'nucleus.tryIt', arguments = { { uri = vim.uri_from_bufnr(0), players = 2 } } },
--   function(_, text) if text then print(text) end end)
```

On older Neovim with [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig):

```lua
local configs = require('lspconfig.configs')
if not configs.nucleus then
  configs.nucleus = { default_config = {
    cmd = { 'node', '/path/to/nucleus.js', 'lsp' },
    filetypes = { 'javascript' },
    root_dir = require('lspconfig.util').root_pattern('handlers', '.git'),
  } }
end
require('lspconfig').nucleus.setup({})
```

### Helix (`languages.toml`)

```toml
[language-server.nucleus]
command = "node"
args = ["/path/to/nucleus.js", "lsp"]

[[language]]
name = "javascript"
language-servers = ["typescript-language-server", "nucleus"]
```

Inlay hints need `[editor.lsp] display-inlay-hints = true` in `config.toml`.

### Zed (`settings.json`)

Zed starts language servers from extensions. Until there is a Nucleus extension, a small one is enough: an `extension.toml` with

```toml
[language_servers.nucleus]
name = "Nucleus"
languages = ["JavaScript"]
```

and a `language_server_command` (Rust, `zed_extension_api`) that returns `node /path/to/nucleus.js lsp` (see Zed's "Language Server extensions" docs). Then enable it next to the default servers:

```json
{
  "languages": { "JavaScript": { "language_servers": ["nucleus", "..."] } },
  "lsp": { "nucleus": { "initialization_options": { "lint": { "compareWithHub": true } } } }
}
```

### Sublime Text ([LSP](https://packagecontrol.io/packages/LSP) package; Preferences > Package Settings > LSP > Settings)

```json
{
  "clients": {
    "nucleus": {
      "enabled": true,
      "command": ["node", "/path/to/nucleus.js", "lsp"],
      "selector": "source.js",
      "initializationOptions": { "lint": { "compareWithHub": true } }
    }
  }
}
```

### Emacs (eglot, built in since Emacs 29)

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '((js-mode js-ts-mode) . ("node" "/path/to/nucleus.js" "lsp"))))
;; M-x eglot in a handler. Fix all: M-x eglot-code-action-quickfix, or
;; (eglot-code-actions nil nil "source.fixAll.nucleus" t)
```

eglot runs one server per mode; to keep a JavaScript server as well, use [lsp-mode](https://emacs-lsp.github.io/lsp-mode/) with `:add-on? t`:

```elisp
(lsp-register-client
 (make-lsp-client :new-connection (lsp-stdio-connection '("node" "/path/to/nucleus.js" "lsp"))
                  :major-modes '(js-mode js-ts-mode) :add-on? t :server-id 'nucleus))
```

### JetBrains IDEs ([LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij))

Settings > Languages & Frameworks > Language Servers > **+**:

- Name: `Nucleus`
- Command: `node /path/to/nucleus.js lsp`
- Mappings > File name patterns: `*.js` (or Language: JavaScript)
- Configuration > Initialization options: `{ "lint": { "compareWithHub": true } }`

### Kate (Settings > Configure Kate > LSP Client > User Server Settings)

```json
{
  "servers": {
    "nucleus": {
      "command": ["node", "/path/to/nucleus.js", "lsp"],
      "highlightingModeRegex": "^JavaScript$",
      "initializationOptions": { "lint": { "compareWithHub": true } }
    }
  }
}
```

Kate allows one server per language; this replaces its JavaScript server for `.js` files.

### Notepad++

Notepad++ has no general LSP client in Plugins Admin, so we ship our own small one: the **Nucleus Co-op handlers** plugin (`npp-plugin/`, C++ built with MinGW by `npp-plugin/build.sh`). It starts `ncdev lsp` and shows its answers the Notepad++ way: problems as Scintilla indicators (squiggles) and in a docked Problems panel, hover and parameter hints as call tips, completion as Scintilla's auto-completion list (filtered to the typed word, details in the status bar), quick fixes in a menu at the caret (Alt+Enter), Fix all, Format, Try it in a new tab, linked game folders in `plugins\Config\NcDev.ini` (sent as the `gameFolders` setting). All the logic stays in `ncdev`; the plugin should rarely change.

`ncdev setup notepad++` (the standalone ncdev, which carries the DLL) installs it into `plugins\NcDev\` and copies ncdev to `%LOCALAPPDATA%\ncdev\`; NcDev.ini says where. Without the standalone ncdev, the setup merges the API names and call tips into Notepad++'s own `autoCompletion/javascript.xml` instead (`core/notepadpp.ts`). If ncdev is missing, the plugin offers to download it (the newest release's `ncdev.exe`, checked against `SHA256SUMS.txt`). Tried in Notepad++ 8.9.9 (x64, under Wine). Set `NCDEV_PLUGIN_LOG` to a file path to log the LSP traffic.

### Anything else

Any LSP client: run `node /path/to/nucleus.js lsp` over stdio for JavaScript files. The server advertises what it supports in `initialize`.

## Debugging: `ncdev dap`

`ncdev dap` is a Debug Adapter (DAP, stdio) over the same debugger as VS Code's Run and Debug (`src/dap.ts`): breakpoints (conditional too), step over/into/out, step back, variables (Context, Player, the options set so far, what Nucleus would have done), hover and console evaluation. The handler runs simulated, as Try it runs it. Launch arguments: `program` (the handler), and optionally `players` (default 2), `keyboard` (a player number, `"all"` or `"none"`), `resolution` (`"1920x1080"`), `stopOnEntry`.

Neovim ([nvim-dap](https://github.com/mfussenegger/nvim-dap)):

```lua
local dap = require('dap')
dap.adapters.nucleus = { type = 'executable', command = 'node', args = { '/path/to/nucleus.js', 'dap' } }
dap.configurations.javascript = dap.configurations.javascript or {}
table.insert(dap.configurations.javascript, { type = 'nucleus', request = 'launch', name = 'Step through the handler', program = '${file}', players = 2 })
```

Other editors with DAP support (Helix `debugger` in `languages.toml`, Zed, JetBrains, Emacs [dape](https://github.com/svaante/dape)) take the same command and launch arguments.

## How handler files are detected

`isHandlerFile()` in `src/core/features.ts`, the same rule in every editor:

1. `detection: "off"`: never; `"always"`: every file it's given.
2. A path matching one of `handlerGlobs`.
3. Otherwise only `.js` files: one directly in a `handlers` folder (`…/handlers/Game.js`, where Nucleus keeps them), or text that looks like a handler (`looksLikeHandler()` in `core/lint.ts`: a line starting with `Game.GUID =`, `Game.GameName =`, `Game.ExecutableName =`, `Game.Play =`, `Game.SteamID =`, `Game.HandlerInterval =` or `Game.SymlinkGame =`).

Unsaved buffers (no `file:` URI) count when the client calls them `javascript` and the text looks like a handler. Files that aren't handlers get no diagnostics and no features.

## What's VS Code only today, and how to get it elsewhere

| VS Code | Elsewhere |
|---|---|
| **Try it** panel (players, keyboard, monitor size as links; "Test all combinations") | `nucleus.tryIt` command (`{ uri, players, width, height, keyboardPlayer }`; `keyboardPlayer` is 1-based, `"all"` or `"none"`), or `nucleus simulate MyGame.js --players 4 --keyboard none --resolution 2560x1440` in a terminal. Show the returned text in a split or a floating window. |
| **New Handler** wizard | `nucleus new --name "My Game" --exe game.exe --features …` (`nucleus --help` lists the features) |
| **Hub** browser (search, open, install) | `nucleus hub search <words>`, `nucleus hub fetch <id> --out dir` |
| **Package** / **Install** | `nucleus package MyGame.js` (a `.nc` for the Hub); to install, copy `MyGame.js` and its `MyGame/` folder into Nucleus' `handlers` folder |
| **Lint all handlers** | `nucleus lint path/to/handlers` (`--fix` applies the safe fixes) |
| **Set Up Type Definitions** | Point your TypeScript server at `types/nucleus.d.ts` |
| **Debugging** (Run and Debug) | `nucleus dap` in an editor with DAP support ([above](#debugging-ncdev-dap)), or `nucleus debug MyGame.js --break 14 --watch Context.PlayerID` in a terminal. |
| **What's New** | `CHANGELOG.md` |
| Agent tools for Copilot | `nucleus mcp` for any MCP client (README, "AI agents") |

## Testing a new adapter

- **The server itself:** `npm test` runs `src/test/lsp.test.ts`, which starts `node dist/cli.js lsp` and speaks LSP to it (open a buggy handler, diagnostics, hover, completion after `Game.`, a code action, formatting, Try it). Copy its small client if you write an adapter of your own.
- **By hand:** open a file in a `handlers` folder with

  ```js
  Game.GUID = "Test";
  Game.GameName = "Test";
  Game.ExecutableName = "test.exe";
  Game.Hook.ForceFocuss = true;
  Game.KillMutex = "M";
  Game.ProtoInput.BlockedMessages = [0x0008];
  ```

  and check: a warning on `ForceFocuss` with the quick fix "Change to `ForceFocus`"; fix all turns `"M"` into `["M"]`; typing `Game.` lists the options; hovering `KillMutex` shows its docs; `WM_KILLFOCUS` appears after `0x0008`; Format Document indents a `Game.Play` body.
- **The log:** the server writes errors to stderr (your editor's LSP log). It catches every failure per request, so broken or half-typed code never stops it.
- **An adapter in another language** (a JetBrains plugin, a Zed extension in Rust): don't port the logic; start `ncdev lsp`, or call the CLI with `--json`. Porting `src/core` means keeping two linters in step.

## If you're an AI porting this

1. Read `AGENTS.md` (commands, layout, the facts the code relies on) and this file.
2. Prefer wiring `ncdev lsp` over writing new code. Most editors need only the config snippet above.
3. If an editor needs something the server doesn't offer, add it to `src/core/features.ts` as a function returning plain data (offsets, strings, Markdown), then convert it in `src/lsp.ts` **and** `src/extension.ts`. Never put feature logic in an adapter, and keep `src/core` free of `vscode` and Node imports.
4. Never run handler code yourself: only through `simulateIsolated()` (`src/sandbox.ts`).
5. Don't change behaviour while porting: `src/test/extension.test.ts` and `src/test/lsp.test.ts` must keep passing. Add tests for anything new.
6. Run `npm run build`, `npm test` and `npm run typecheck`; commit the regenerated `plugin/skills/nucleus-handler/scripts/nucleus.js`.
7. Add a line under `## Unreleased` in `CHANGELOG.md` (format at the top of that file), and add the editor's snippet here.
