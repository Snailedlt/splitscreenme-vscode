# Changelog

## 0.1.0

First release.

- Completion, hover and signature help for the Nucleus handler API (`Game`, `Game.Hook`, `Game.ProtoInput`, `Context`, `Player`, `PlayerList`, `ProtoInput`, `Hub`, `Nucleus.*`), generated from the Nucleus Co-op sources and docs.
- Linter with 14 rules and quick fixes; also available as the `nucleus-lint` CLI.
- Commands: New Handler, Package for the Hub (.nc), Install into Nucleus Co-op, Browse the Hub, Set Up Type Definitions, Lint All Handlers, Open Documentation.
- Fix all: deterministic, behaviour-preserving automatic fixes (command, fix-on-save, `nucleus lint --fix`).
- Snippets for common handler tasks.
- Rule severities and enum handling verified against Jint 2.11.58 itself (probe handlers run with Nucleus' engine setup).
- `nucleus.d.ts` type definitions.
