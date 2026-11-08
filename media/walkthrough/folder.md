# The game's folder

With the folder linked, a handler is checked against the real game:

- `Game.ExecutableName`: does that exe exist, and is it the one that starts the game? A wrong name gets a fix with the right one.
- `Game.BinariesFolder`, the folders to link or copy, the files to leave out: do they exist?
- Inside those lists, the game's own files and folders are suggested as you type.

Nothing in the game's folder is changed.
