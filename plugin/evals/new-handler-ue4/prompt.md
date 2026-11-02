---
description: Write a new handler from game facts. Graded on rules that make handlers fail in Nucleus.
tags: [write]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit]
---

I want to make a Nucleus Co-op handler for my game "Rift Wardens" so my friends and I can play split-screen. What I know:

- Unreal Engine 4, on Steam (app ID 1830420), up to 4 players over LAN.
- The game folder has RiftWardens.exe (a launcher) and RiftWardens/Binaries/Win64/RiftWardens-Win64-Shipping.exe (the real game).
- It accepts -windowed -ResX=<width> -ResY=<height> on the command line.
- Settings are in %LOCALAPPDATA%\RiftWardens\Saved\Config\WindowsNoEditor\GameUserSettings.ini.

Write the handler and save it as handler.js in the current folder.
