# Testing the handler tools

Thanks for helping. These tools are for people who write Nucleus Co-op handlers, and you know Nucleus far better than any linter does, so the most useful thing you can tell us is where they're **wrong**.

## Install

- **VS Code extension**: download the `.vsix` from the [latest release](https://github.com/Snailedlt/splitscreenme-vscode/releases), then in VS Code run **Extensions: Install from VSIX…**. Open your handlers folder; any handler `.js` gets checking, completion and hover docs.
- **Workbench** (nothing to install): https://snailedlt.github.io/nucleuscoop-handler-testbench/?ref=testing
- **Claude Code skill** (optional): `/plugin marketplace add Snailedlt/splitscreenme-vscode`, then `/plugin install nucleus-coop@splitscreenme`.

## What to try

1. Open a handler you know well, ideally one that works in Nucleus. Look at every warning: is it right?
2. Press the ▷ button in the editor title bar (**Nucleus: Try It**). It shows what Nucleus would set up for each player: window, launch arguments, files it changes. Does that match what really happens?
3. Run **Nucleus: Fix All Auto-fixable Problems** on a copy. Did it change anything it shouldn't have?
4. Write something new with **Nucleus: New Handler…** and see how far completion and hover get you.

## What we want to hear

- A warning or error on code that works in Nucleus (a false positive). These matter most.
- A real mistake it didn't catch.
- Try it saying something Nucleus doesn't do.
- Anything confusing, slow or missing.

Short intro to share: https://snailedlt.github.io/nucleuscoop-handler-testbench/start/?ref=testing

Report it with the [tester feedback form](https://github.com/Snailedlt/splitscreenme-vscode/issues/new?template=tester-feedback.yml). A workbench share link (**Copy link**) is the easiest way to include the handler.

## What it can't know

Try it runs the handler's script the way Nucleus' script engine does, but not the game: windows, focus, input and whether the game actually plays split-screen still need a real test in Nucleus. Nothing on your computer is touched, and the handler runs isolated from your files.
