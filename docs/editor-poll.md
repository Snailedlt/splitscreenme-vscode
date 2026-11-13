# Editor poll: what it means for the tools

Discord poll "Which editors do you use to write Nucleus Co-op handlers (or other code)? Pick all that apply", posted
2026-11-08 to Handler Authors and Beginner Handler Authors. Results as of 2026-11-13 (58 votes; several answers per
person, so the percentages are shares of votes, not of people):

| Editor | Votes | Share |
| --- | ---: | ---: |
| Notepad++ | 24 | 41% |
| VS Code | 18 | 31% |
| Windows Notepad or similar | 8 | 14% |
| Visual Studio | 4 | 7% |
| Zed | 2 | 3% |
| Cursor, Windsurf or another VS Code fork | 1 | 2% |
| Other | 1 | 2% |
| JetBrains, Sublime Text, Vim / Neovim | 0 | 0% |

## Priorities after the 0.6.0 release (decided 2026-11-13; nothing started yet)

1. **Notepad++ first.** The most used editor. List the plugin in Plugins Admin right after the release (see AGENTS.md,
   *Store listings*), so it installs from inside Notepad++; test its first install and setup the most.
2. **Windows Notepad users → the workbench.** Our tools can't help inside Notepad. The workbench needs no install and
   has every check; the tools page and Learn should lead these (likely beginner) authors to it.
3. **VS Code and its forks.** Covered by the extension. Forks (Cursor, Windsurf) install from Open VSX, so the prepared
   Open VSX listing matters.
4. **Visual Studio: test, then a short guide.** It should read the same `jsconfig.json` + `nucleus.d.ts` that
   *Nucleus: Set Up Type Definitions* writes (completion, hovers). Check that first, then document it. A full Visual
   Studio extension isn't worth it at 7%.
5. **Zed: wait.** It needs a small Rust extension (PORTING.md has the outline). Revisit if demand grows.
6. **JetBrains, Sublime Text, Vim/Neovim: no new work.** `ncdev lsp` and PORTING.md already cover them.

Re-check when the poll closes, and run it again before deciding on big editor work.
