#!/usr/bin/env bash
# A handler with the mistakes the linter's checks were built from (each verified against Jint 2.11).
cat > handler.js <<'JS'
// Buggy Game handler
Game.GameName = "Buggy Game";
Game.GUID = "Buggy Game";
Game.ExecutableName = "buggy.exe";
Game.MaxPlayers = 4;
Game.KillMutex = "BuggyMutex";
Game.IgnoreWindowBordercheck = true;
var width = Context.Width;
Game.Play = function () {
  const args = `-windowed -w ${Context.Width}`;
  Context.StartArguments = args + " -id " + Context.PLayerID;
};
JS
