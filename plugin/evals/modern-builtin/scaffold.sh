#!/usr/bin/env bash
cat > handler.js <<'JS'
Game.GUID = "Ember Run";
Game.GameName = "Ember Run";
Game.ExecutableName = "EmberRun.exe";
Game.MaxPlayers = 2;
Game.StartArguments = "-novid";
Game.Play = function () {
  Context.StartArguments = Context.StartArguments + " -windowed";
};
JS
