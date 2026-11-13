# Contributing

Thanks for helping. Handler authors know Nucleus Co-op better than any linter, so most of the useful help needs no code at all.

This repository has the VS Code extension, the `ncdev` command line, the Notepad++ plugin, the language server for other editors and the agent kit for AI agents. The browser workbench, Learn and the docs pages live in [nucleuscoop-handler-testbench](https://github.com/Snailedlt/nucleuscoop-handler-testbench) ([its guide](https://github.com/Snailedlt/nucleuscoop-handler-testbench/blob/main/CONTRIBUTING.md)).

## Without code

- **Tell us what's wrong.** A warning on code that works, a real bug the checks missed, Try it saying something Nucleus doesn't do, a confusing hint: [the feedback form](https://github.com/Snailedlt/splitscreenme-vscode/issues/new?template=tester-feedback.yml). Name the handler if it's on the Hub.
- **Check the AI-written docs.** Many options had no docs, so an AI wrote them from the Nucleus source; each says so. If you know how one really works, mark it right or wrong (👍/👎 on its docs page) or [send a correction](https://github.com/Snailedlt/splitscreenme-vscode/issues/new?template=doc-review.yml). A checked doc gets your name on it.
- **Suggest a check.** A mistake you keep seeing in handlers is a check waiting to be written: describe it in the feedback form, with a handler that has it.
- **Test a beta.** The testing guide is [TESTING.md](TESTING.md).

## With code

You need Git and Node.js 22 or newer.

```bash
npm ci
npm run build       # the extension, the CLI, the skill's API reference
npm test            # build + the tests
npm run typecheck
```

- [AGENTS.md](AGENTS.md) describes the layout, the conventions and the facts about Nucleus the checks rely on. It's written for AI agents, and it's the best map for people too.
- **New checks:** add them to `RULES` in `src/core/lint.ts` with a test that they fire and one that they don't (`src/test/lint.test.ts`), then run them over real Hub handlers: published, working handlers must get no errors. Each check needs its page in `src/core/ruledocs.ts` (what, why, an example, the fix).
- **Editor features** go into `src/core/features.ts` first, then into each editor (`src/extension.ts`, `src/lsp.ts`).
- **Don't edit generated files** (`data/nucleus-api.json`, `types/nucleus.d.ts`, the skill's `reference/api.md`): fix the generator or the source.
- Every change people will notice gets a line in `CHANGELOG.md` under `## Unreleased`.

Open a pull request against `main`. Small and focused is easiest to review; say what you checked it against (a Hub handler, a probe, Nucleus' source).
