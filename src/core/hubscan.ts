/**
 * What Nucleus reads from a handler when it installs it from the Hub: DownloadPrompt.ExtractHandler, and the same
 * loop in HubWebView (the in-app Hub browser), HandlerScanner and UI_Functions (drag & drop). One copy here, used by
 * the linter (`hub-install-parse`), the simulator (`Game.Folder`) and the package checks (where files end up).
 *
 * Nucleus' loop, on `File.ReadAllLines` (a leading BOM dropped; lines split at \r\n, \n and \r):
 *
 *     if (line.ToLower().StartsWith("game.executablename")) { exeName = line.Substring(first + 1, last - first - 1); found++; }
 *     else if (line.ToLower().StartsWith("game.gamename")) { title = pattern.Replace(<same>, ""); found++; }
 *     if (found == 2) break;
 *
 * So: raw lines, comments and function bodies included; indentation means no match; the text between the first and
 * last `"`; a later match overwrites an earlier one; it stops after two matches (of either kind); a matched line with
 * fewer than two `"` throws (`Substring` with a negative length), which ends the install. The game name loses only
 * / : * ? " < > | (`new Regex("[\\/:*?\"<>|]")`): a backslash stays.
 */
export interface HubScanHit {
  /** The text between the first and last `"`, or null when the line has fewer than two (the install throws). */
  value: string | null;
  /** 0-based line. */
  line: number;
  /** Offset of the line's start in the text as given (a BOM before it counted). */
  offset: number;
  crash: boolean;
}
export interface HubScan {
  ExecutableName?: HubScanHit;
  GameName?: HubScanHit;
  /** 1-based lines that matched, in order (at most two). */
  matched: number[];
}

/** Replays Nucleus' Hub install scan (see above). Stops at a crash, as the install does. */
export function hubScan(text: string): HubScan {
  const result: HubScan = { matched: [] };
  let found = 0;
  let offset = 0;
  const lines = text.split(/\r\n|\n|\r/);
  const ends = text.match(/\r\n|\n|\r/g) ?? [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = i === 0 && raw.startsWith('﻿') ? raw.slice(1) : raw; // ReadAllLines drops the BOM
    const lower = line.toLowerCase();
    const key = lower.startsWith('game.executablename') ? 'ExecutableName' : lower.startsWith('game.gamename') ? 'GameName' : null;
    if (key) {
      const first = line.indexOf('"');
      const last = line.lastIndexOf('"');
      const crash = first < 0 || last === first;
      result[key] = { value: crash ? null : line.slice(first + 1, last), line: i, offset, crash };
      result.matched.push(i + 1);
      found++;
      if (crash || found === 2) break;
    }
    offset += raw.length + (ends[i]?.length ?? 0);
  }
  return result;
}

/** Removes what Nucleus removes from the game name before using it as a file and folder name. */
export const cleanGameName = (name: string) => name.replace(/[\/:*?"<>|]/g, '');

/** The name a Hub install gives the handler (`handlers\<name>.js` and `handlers\<name>\`), or undefined when Nucleus
 *  finds no game name line (it then keeps the package's name) or the install throws. A backslash stays. */
export function hubGameName(text: string): string | undefined {
  const s = hubScan(text);
  if (s.ExecutableName?.crash || !s.GameName || s.GameName.crash) return undefined;
  return cleanGameName(s.GameName.value!);
}
