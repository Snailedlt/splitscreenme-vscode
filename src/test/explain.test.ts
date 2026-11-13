import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainLine } from '../core/features';

const src = 'Game.GUID = "a";\nGame.GameName = "a";\nGame.ExecutableName = "a.exe";\n// a note\nGame.Play = function () {\n  Context.StartArguments += " -windowed";\n  if (Player.IsKeyboardPlayer) {\n  }\n};\nGame.MaxPlayers = "4";\n\n';
const at = (line: number) => explainLine(src, src.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0));

test('explainLine: what the line does, the names in it, and what Check says about it', () => {
  assert.match(at(0)!.markdown, /^\*\*Line 1:\*\* Sets `Game\.GUID` to `"a"`\./);
  assert.match(at(0)!.markdown, /The names in it[\s\S]*`Game\.GUID`/);
  assert.match(at(3)!.markdown, /A comment/);
  assert.match(at(4)!.markdown, /once for each player/);
  assert.match(at(5)!.markdown, /Adds `" -windowed"` to the end of `Context\.StartArguments`[\s\S]*that player only/);
  assert.match(at(6)!.markdown, /only when `Player\.IsKeyboardPlayer` is true/);
  assert.match(at(9)!.markdown, /Check says[\s\S]*expects a number/);
  assert.equal(at(10), undefined, 'an empty line has nothing to explain');
  assert.match(at(5)!.aiPrompt, /JSON/);
});
