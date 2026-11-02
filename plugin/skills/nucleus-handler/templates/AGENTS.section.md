## Nucleus Co-op handlers

This folder contains Nucleus Co-op (SplitScreen.Me) game handlers: JavaScript files that Nucleus loads to run several instances of a game for split-screen play.

Before writing or changing a handler, read `.claude/skills/nucleus-handler/SKILL.md`. It has the rules, the workflow and links to the reference material. Then use the bundled tool:

```bash
node .claude/skills/nucleus-handler/scripts/nucleus.js lint --fix <handler.js>  # apply the safe automatic fixes
node .claude/skills/nucleus-handler/scripts/nucleus.js lint <handler.js>        # run after every edit
node .claude/skills/nucleus-handler/scripts/nucleus.js api <Game.Option>        # check an option exists and its type
node .claude/skills/nucleus-handler/scripts/nucleus.js api --search <words>     # find the right option
node .claude/skills/nucleus-handler/scripts/nucleus.js hub search <game>        # find similar handlers to learn from
```

Non-negotiable:
- ES5 JavaScript only (Jint 2.11): no arrow functions, template strings, classes, spread or destructuring. Use `var`. No ES2015+ built-ins either (`.includes()`, `.startsWith()`, `.find()`, `Object.assign`, `Map`): use `indexOf` and loops.
- Only use options that exist (`api` / lint). Misspelled options are silently ignored.
- `Context`, `Player`, `PlayerList`, `ProtoInput` only inside `Game.Play` or other callbacks.
- Keep `Game.GameName = "...";` and `Game.ExecutableName = "...";` unindented, double-quoted, and alone on their lines.
- Nucleus can't run here. Finish with a concrete test plan, and ask the user for `debug-log.txt` from the Nucleus folder.
