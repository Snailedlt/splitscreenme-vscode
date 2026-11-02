---
type: regex
target: { source: file, path: handler.js }
pattern: 'Game\.KillMutex\s*=\s*\['
flags: m
---
A non-array value for an array option makes the handler fail to load.
