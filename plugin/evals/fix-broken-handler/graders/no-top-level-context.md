---
type: regex
target: { source: file, path: handler.js }
pattern: '^var width = Context'
match: not_contains
flags: m
---
Context only exists inside callbacks; at the top level it stops the handler from loading.
