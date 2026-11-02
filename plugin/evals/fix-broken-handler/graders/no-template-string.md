---
type: regex
target: { source: file, path: handler.js }
pattern: '`'
match: not_contains
flags: m
---
Template strings stop the handler from loading.
