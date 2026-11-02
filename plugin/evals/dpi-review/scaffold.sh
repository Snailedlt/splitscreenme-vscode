#!/usr/bin/env bash
cat > handler.js <<'JS'
Game.GUID = "Frost Delvers";
Game.GameName = "Frost Delvers";
Game.ExecutableName = "FrostDelvers.exe";
Game.MaxPlayers = 4;
Game.DPIHandling = true;
Game.SymlinkGame = true;
Game.Play = function () {
  Context.StartArguments = "-windowed -w " + Context.Width + " -h " + Context.Height;
};
JS
