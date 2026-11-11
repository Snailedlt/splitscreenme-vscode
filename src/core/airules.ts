// What an AI must know before it touches a handler, in one place: the workbench's "Fix with AI" and "Explain with
// AI", and the MCP server's instructions all use it, so a person's AI and an agent learn the same rules. The skill's
// SKILL.md says the same at length. No `vscode` import.
import { RULES } from './lint';
import { RULE_DOCS, ruleUrl } from './ruledocs';

/** The hard rules: break one and the handler fails to load, or silently does something else. */
export const AI_HARD_RULES: readonly string[] = [
  'ES5 JavaScript only (Jint 2.11.58): no arrow functions, template strings, classes, spread/rest, destructuring, default parameters, for...of, ?. or ??, and no trailing comma in a call. let/const parse but act like var; prefer var. No ES2015 library calls either (.includes, .startsWith, .find, Object.assign, Map, Set): they throw when the line runs.',
  'Only use options that exist in the Nucleus API (look them up). Nucleus silently ignores unknown names, so a typo "works" but does nothing. Names are case-sensitive except the first letter.',
  'Context, Player, PlayerList, Handler and ProtoInput exist only inside callbacks such as Game.Play = function () { ... }. Top-level code may only use Game, Hub, Nucleus and System.',
  'Game.GUID, Game.GameName and Game.ExecutableName are required. GameName and ExecutableName must each start their own unindented line, double-quoted, with no other double quote on the line (the Hub install scans those lines). ExecutableName is a file name, never a path.',
  'Types matter: list options take arrays (Game.KillMutex = ["name"]; anything else stops the handler loading), booleans are true/false (not "true"), numbers are numbers, and enum options take the enum value (Game.DPIHandling = Nucleus.DPIHandling.True), never a boolean.',
  'Pass every parameter of a method, even ones with a C# default value: Jint 2.11 ignores defaults, so a call with fewer arguments throws.',
  'Top-level code runs many times (every scan, Play click and install): only Game.* settings there, no file, registry or process work outside callbacks.',
  'An error thrown in Game.Play or Game.OnFinishedSetup ends the whole session; Game.OnStop must never throw (Nucleus would skip its cleanup).',
  "Don't add or edit Hub.* lines: hub.splitscreen.me writes them on upload.",
];

/** The rules as a block of text for a prompt. */
export const aiHardRulesText = () => `Nucleus Co-op runs handlers with Jint 2.11.58. Hard rules:\n${AI_HARD_RULES.map((r) => `- ${r}`).join('\n')}`;

/** A check explained for an AI (or a terminal): title, why, the fix, a wrong and a right example, and its page. */
export function ruleDocText(id: string, ref?: string): string | undefined {
  const r = (RULES as Record<string, { severity: string; description: string }>)[id];
  const d = RULE_DOCS[id];
  if (!r || !d) return undefined;
  return [
    `${id} (${r.severity}): ${d.title}`,
    d.why,
    `Fix: ${d.fix}`,
    d.bad ? `Wrong:\n${d.bad}` : '',
    d.good ? `Right:\n${d.good}` : '',
    `More: ${ruleUrl(id, ref)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
