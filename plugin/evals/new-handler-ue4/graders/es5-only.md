---
type: regex
target: { source: file, path: handler.js }
pattern: '=>|`|\.(includes|startsWith|endsWith|find|repeat)\(|Object\.assign|new (Map|Set)\b'
match: not_contains
weight: 2
---
Jint 2.11: no arrow functions or template strings (the handler fails to load), no ES2015+ built-ins (they throw).
