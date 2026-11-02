---
description: A small change where the obvious modern JavaScript (.includes) crashes in Nucleus.
tags: [write]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit]
---

In my handler.js, Game.Play always appends " -windowed". Change it so it only adds -windowed when the arguments don't already contain it, and also add -nosound for every player except the first one.
