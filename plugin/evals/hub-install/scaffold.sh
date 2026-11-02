#!/usr/bin/env bash
cat > handler.js <<'JS'
var name = "Tidecaller";
Game.GUID = "Tidecaller";
  Game.GameName = name; // set from the variable above
Game.ExecutableName = 'Tidecaller.exe';
Game.MaxPlayers = 2;
Game.Play = function () {
  Context.StartArguments = "-windowed";
};
JS
