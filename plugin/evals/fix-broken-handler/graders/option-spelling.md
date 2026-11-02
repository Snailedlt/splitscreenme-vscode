---
type: regex
target: { source: file, path: handler.js }
pattern: 'IgnoreWindowBordercheck'
match: not_contains
flags: m
---
Misspelled options are silently ignored.
