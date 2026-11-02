---
type: regex
target: { source: file, path: handler.js }
pattern: '^Game\.GameName = "[^"]+";[ \t]*$'
flags: m
---
Unindented, double quotes, nothing else with a quote on the line: the Hub install reads it with a line scanner.
