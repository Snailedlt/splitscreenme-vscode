---
type: regex
target: { source: file, path: handler.js }
pattern: '^Game\.GameName = "Tidecaller";'
flags: m
weight: 2
---
The Hub install reads the first line that starts with game.gamename and takes the text between the first and last double quote: unindented, double-quoted, no variable.
