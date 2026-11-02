---
type: regex
target: { source: file, path: handler.js }
pattern: '^Game\.ExecutableName = "RiftWardens-Win64-Shipping\.exe";'
flags: m
weight: 2
---
Nucleus compares Game.ExecutableName with the picked .exe's file name, and the Hub install reads this exact line.
