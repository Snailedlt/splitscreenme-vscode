---
type: regex
target: { source: file, path: handler.js }
pattern: 'PLayerID'
match: not_contains
flags: m
---
Jint matches only the first letter case-insensitively: PLayerID is undefined.
