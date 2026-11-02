---
type: regex
target: { source: file, path: handler.js }
pattern: '\.(includes|startsWith|endsWith)\(|=>|`'
match: not_contains
weight: 2
---
Jint 2.11 has only ES5 built-ins: "".includes() throws when Game.Play runs, so every instance fails.
