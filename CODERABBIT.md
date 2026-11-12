# Setting up CodeRabbit

CodeRabbit reviews pull requests in both repos: **splitscreenme-vscode** (this one) and **nucleuscoop-handler-testbench**. Most of the setup is already in the repos; this guide covers the steps that happen in CodeRabbit's web app, once.

## What the repos already do

Each repo has a `.coderabbit.yaml` (checked against CodeRabbit's schema). A repo's file wins over the web app's settings for that repo, so change review behaviour there, not in the web app.

- **Guidelines:** `AGENTS.md` is read automatically. This repo also points CodeRabbit at the skill's docs (`SKILL.md`, workflow, troubleshooting), `PORTING.md` and `CONTRIBUTING.md`.
- **Rules per folder** (`path_instructions`): the rules from `AGENTS.md` for each part (core, checks, Format, the sandbox, the Hub, adapters, the workbench's UI, links, workflows). Change them together with `AGENTS.md`.
- **Left out of reviews** (`path_filters`): generated, recorded and binary files (the API model, the skill bundle, `probes/expected.txt`, screenshots).
- **The two repos are linked** (`linked_repositories`), so a change in one is reviewed with the other in view: the workbench imports this repo's `src/core`.
- **MCP turned on** (`knowledge_base.mcp.usage: enabled`). The default, `auto`, turns MCP servers off for public repositories, which both repos are.
- Quiet reviews: the `chill` profile, no poem, never blocks a merge (no "request changes").

## 1. Install CodeRabbit on the repos

1. Go to [app.coderabbit.ai](https://app.coderabbit.ai) and sign in with GitHub.
2. Install the CodeRabbit GitHub app, choose **Only select repositories**, and pick:
   - `Snailedlt/splitscreenme-vscode`
   - `Snailedlt/nucleuscoop-handler-testbench`

   Leave your other repos out: their own reviews won't need any of this.

CodeRabbit is free for public repositories.

## 2. Make a scope for the two repos

Connections (like DeepWiki below) apply to every repo in a scope. The **Base Scope** means all your repos, so give these two their own:

1. **Setup › Scopes › New scope**, named for example `Nucleus Co-op tools`.
2. Add `splitscreenme-vscode` and `nucleuscoop-handler-testbench`.

## 3. Connect DeepWiki

DeepWiki lets reviews look things up in the Nucleus Co-op source and the related repos.

1. **Integrations › MCP servers › DeepWiki** (one of the suggested servers).
2. Fill in:

   | Field | Value |
   | --- | --- |
   | Connection name / Server name | `DeepWiki` |
   | Access mode | **Read-only** |
   | Server URL | `https://mcp.deepwiki.com/mcp` |
   | Transport | **Streamable HTTP** |
   | Authentication | **No auth** |

3. **Discover tools**: it lists `read_wiki_structure`, `read_wiki_contents` and `ask_question`. Allow all three.
4. **Prompt Guidance:** paste the text below.
5. Add it to the scope from step 2 (not the Base Scope), then **Save**.

```
Only for Nucleus Co-op / SplitScreen.Me work (handlers, the handler tools). Skip this connection for anything else.

Current code (trust these first):
- SplitScreen-Me/splitscreenme-nucleus: Nucleus Co-op (C#). How handlers are loaded and run: GenericGameInfo, GenericGameHandler, Game.Play, Context, every Game.* option, the Hub install.
- SplitScreen-Me/splitscreenme-protoInput: Proto Input (input hooks, message filters, focus loop).
- SplitScreen-Me/splitscreenme-www: the official handler docs (Handler API, Create handlers).
- SplitScreen-Me/splitscreenme-hub: hub.splitscreen.me, where handlers are published.
- SplitScreen-Me/splitscreenme-discordbot: the Discord bot and its handler templates.
- sebastienros/jint: the JavaScript engine. Nucleus uses Jint 2.11.58: ES5 plus let/const acting as var, no arrow functions or template literals.

Our tools:
- Snailedlt/splitscreenme-vscode: the linter, simulator and API model (VS Code, Notepad++, ncdev CLI, MCP, agent skill).
- Snailedlt/nucleuscoop-handler-testbench: the browser workbench and site, and the Jint testbench whose probes record how the real engine behaves.

History (only for why something is the way it is, or old handlers; current code wins):
- lucasassislar/nucleuscoop: the original Nucleus Co-op.
- distrohelena/nucleuscoop: the community version before SplitScreen.Me.
- Ilyaki/ProtoInput: Proto Input before it moved to SplitScreen.Me.
- UniversalSplitScreen/UniversalSplitScreen: Ilyaki's earlier split screen with multiple keyboards, mice and controllers; the input-hook ideas Proto Input grew from.

Related projects (for ideas and comparison only; never describe Nucleus behaviour from them):
- partydeck/partydeck: a split-screen launcher for Linux/SteamOS. Useful for how another tool solves instancing, windows and input.

Facts in a repository's AGENTS.md are verified against Nucleus and Jint: prefer them. Use DeepWiki to confirm or fill gaps, and name the repository (and file, if known) an answer came from.
```

The same list is in both repos' `AGENTS.md` (*Related repositories*): keep the two in step.

DeepWiki only knows public repos it has indexed. If a review says one isn't there, open `https://deepwiki.com/<owner>/<repo>` once in a browser to have it indexed.

## 4. Check it on the first pull request

Open a pull request (or push to one). Within a few minutes CodeRabbit posts:

- **A walkthrough** (summary, changed files). At its end, **Review details › Additional context used** lists the guideline files and, when it looked something up, the DeepWiki tools.
- **Review comments** on lines. Each says what breaks; reply to argue or ask, and it answers.

If `.coderabbit.yaml` has a problem, CodeRabbit says so in a comment. `@coderabbitai configuration` shows the settings it actually used.

## Commands in a pull request

Write these as a comment on the pull request:

| Comment | Does |
| --- | --- |
| `@coderabbitai review` | Review the new commits |
| `@coderabbitai full review` | Review everything again from scratch |
| `@coderabbitai pause` / `resume` | Stop / restart automatic reviews on this PR |
| `@coderabbitai resolve` | Mark all its comments resolved |
| `@coderabbitai summary` | Rewrite the summary |
| `@coderabbitai configuration` | Show the settings in use |
| `@coderabbitai help` | All commands |

`@coderabbitai ignore` anywhere in a pull request's description skips that PR.

**Learnings:** when you correct a review ("this is fine: Jint ignores the declaration kind"), CodeRabbit remembers it for this repo and stops flagging it. If it keeps flagging something that's a verified fact, add it to `AGENTS.md` instead: that helps every agent, not just CodeRabbit.

## Changing the setup later

- Review behaviour, rules per folder, ignored files: edit `.coderabbit.yaml` in that repo (the editor validates it against the schema named on its first line).
- A new verified fact about Nucleus: add it to `AGENTS.md`; CodeRabbit reads it from the next review.
- A new related repo: add it to the DeepWiki prompt guidance (step 3) and to *Related repositories* in both `AGENTS.md` files.
