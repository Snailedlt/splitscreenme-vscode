# Changelog

## 0.1.0

First release.

- Completion, hover and signature help for the Nucleus handler API (`Game`, `Game.Hook`, `Game.ProtoInput`, `Context`, `Player`, `PlayerList`, `ProtoInput`, `Hub`, `Nucleus.*`), generated from the Nucleus Co-op sources and docs.
- Linter with 16 rules and quick fixes; also available as the `nucleus-lint` CLI.
- Commands: New Handler, Package for the Hub (.nc), Install into Nucleus Co-op, Browse the Hub, Set Up Type Definitions, Lint All Handlers, Open Documentation.
- Fix all: deterministic, behaviour-preserving automatic fixes (command, fix-on-save, `nucleus lint --fix`).
- Try it follows Nucleus' session flow and paths: errors end the session, OnFinishedSetup/OnStop run, Play timing flags, instance paths per copy mode and BinariesFolder, Context.Hook shared with Game.Hook, `Handler`, plugin globals from pluginsInfo.txt.
- Try it: simulate a handler for 1–4 players (window, launch arguments, file changes, skipped options, errors), in a panel beside the editor and as `nucleus simulate`. It emulates Nucleus' Jint engine, matches the real engine on all 106 testbench probes, and runs the handler isolated from Node and your files.
- Checked against the Nucleus source: the Hub install's exact line scan, `ExecutableName` needed for "Search disks", `AddOption` values and duplicate keys, `ShowOptionAsStep` keys, file-name-only `ExecutableName`, callbacks Nucleus never runs or calls unchecked (`callback-misuse`), required C# default parameters, strings continued with `\`.
- Snippets for common handler tasks.
- Rule severities and enum handling verified against Jint 2.11.58 itself (probe handlers run with Nucleus' engine setup).
- `missing-builtin`: flags ES2015+ library calls (`.includes()`, `Object.assign`, `Map`, ...) that Jint 2.11 lacks and that throw at run time; each one checked against the real engine.
- `nucleus.d.ts` type definitions.
