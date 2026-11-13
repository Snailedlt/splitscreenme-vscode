// "Explain this line": what one line of a handler does, in plain words, from the API docs and the checks; no AI.
// The editors show it on request (a hover link, a command, a code action); the workbench can hand `aiPrompt` to the
// AI the person has set up, for a longer answer. Plain data: Markdown and the line's range.
import { ownerLabel, type Member } from './api';
import { resolveAt } from './complete';
import { lint } from './lint';
import { aiHardRulesText } from './airules';

export interface LineExplanation {
  /** 0-based line. */
  line: number;
  text: string;
  markdown: string;
  /** For an AI, if the person asks: the line, its docs and its problems, and what to answer. */
  aiPrompt: string;
}

const firstSentence = (t?: string) => {
  const s = String(t ?? '').split('\n')[0].trim();
  return (s.match(/^[\s\S]*?[.!?](?=\s+[A-Z`"(]|$)/) ?? [s])[0];
};
const code = (t: string) => '`' + t.replace(/`/g, "'") + '`';

/** The names on the line that the API knows, in order, each once. */
function namesOn(text: string, start: number, end: number): { path: string; member: Member }[] {
  const out: { path: string; member: Member }[] = [];
  const re = /[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/g;
  const line = text.slice(start, end);
  for (let m; (m = re.exec(line)); ) {
    const r = resolveAt(text, start + m.index + m[0].length);
    if (r?.resolved.kind !== 'member') continue;
    const path = `${ownerLabel(r.resolved.owner)}.${r.resolved.name}`;
    if (!out.some((x) => x.path === path)) out.push({ path, member: r.resolved.member });
  }
  return out;
}

/** The line at `offset`, explained; undefined for an empty line. */
export function explainLine(text: string, offset: number): LineExplanation | undefined {
  const start = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  let end = text.indexOf('\n', offset);
  if (end < 0) end = text.length;
  const raw = text.slice(start, end).replace(/\r$/, '');
  const t = raw.trim();
  if (!t) return undefined;
  const line = text.slice(0, start).split('\n').length - 1;
  const names = namesOn(text, start, end);
  const byPath = new Map(names.map((n) => [n.path, n.member]));
  const says: string[] = [];

  const assign = /^((?:var|let|const)\s+)?([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*(?:\s*\[[^\]]+\])?)\s*(=|\+=|-=)\s*(.*?);?$/.exec(t);
  if (/^(\/\/|\/\*|\*)/.test(t)) says.push('A comment: notes for people. Nucleus skips it.');
  else if (/^Hub\./.test(t)) says.push('Written by hub.splitscreen.me when the handler is uploaded. Leave it as it is.');
  else if (assign && /^function\b/.test(assign[4])) {
    const target = assign[2].replace(/\s+/g, '');
    const m = byPath.get(target);
    if (target === 'Game.Play') says.push(`Starts ${code('Game.Play')}: the function Nucleus runs **once for each player**, after it has set up their copy and before it starts it. The lines inside, up to its ${code('};')}, are what each player gets.`);
    else if (m) says.push(`Gives ${code(target)} a function: Nucleus calls it ${firstSentence(m.doc).replace(/^[A-Z]/, (c) => c.toLowerCase()) || 'when the time comes'}`);
    else says.push(`Makes a function called ${code(target.replace(/^(var|let|const)\s+/, ''))}, for the lines below to call.`);
  } else if (assign && assign[1]) {
    says.push(`Makes a variable, ${code(assign[2])}, and stores ${code(assign[4])} in it, for the lines after it to use.`);
  } else if (assign) {
    const target = assign[2].replace(/\s+/g, '');
    const m = byPath.get(target);
    const value = assign[4];
    says.push(assign[3] === '=' ? `Sets ${code(target)} to ${code(value)}.` : assign[3] === '+=' ? `Adds ${code(value)} to the end of ${code(target)}.` : `Takes ${code(value)} off ${code(target)}.`);
    if (m?.readonly) says.push('That one is read-only: Nucleus ignores the change.');
    else if (m && m.default !== undefined && assign[3] === '=' && value.replace(/^["']|["']$/g, '') === String(m.default).replace(/^["']|["']$/g, '')) says.push("That's already Nucleus' default, so this line changes nothing (it can go).");
    if (/^Context\./.test(target)) says.push(`${code('Context')} is the player being set up, so this is for that player only.`);
  } else if (/^if\s*\(/.test(t)) says.push(`Runs the part after it only when ${code(t.replace(/^if\s*\(|\)\s*\{?\s*$/g, ''))} is true.`);
  else if (/^}\s*else\b/.test(t) || /^else\b/.test(t)) says.push('Otherwise (when the `if` above was false), runs the part after it.');
  else if (/^return\b/.test(t)) says.push(`Ends the function here${t.length > 7 ? `, handing back ${code(t.replace(/^return\s*|;$/g, ''))}` : ''}.`);
  else if (/^[}\])]+[;,)]*$/.test(t)) says.push('Closes the block or list opened above it.');
  else if (/^[A-Za-z_$][\w$.]*\s*\(/.test(t)) {
    const fn = t.slice(0, t.indexOf('(')).replace(/\s+/g, '');
    const m = byPath.get(fn);
    says.push(m ? `Calls ${code(fn)} (what it does is below).` : `Calls ${code(fn)}.`);
  } else says.push('Part of a longer statement that starts above it.');

  const docs = names.filter((n) => n.member.doc).map((n) => `- ${code(n.path)}: ${firstSentence(n.member.doc)}`);
  const problems = lint(text).filter((d) => d.start >= start && d.start <= end && d.severity !== 'hint').map((d) => `- ${d.severity === 'error' ? 'Error' : d.severity === 'warning' ? 'Warning' : 'Note'}: ${d.message}`);
  const md = [
    `**Line ${line + 1}:** ${says.join(' ')}`,
    docs.length ? `**The names in it**\n\n${docs.join('\n')}` : '',
    problems.length ? `**Check says**\n\n${problems.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const aiPrompt = [
    'Explain, in plain words for someone new to Nucleus Co-op handlers (JavaScript files run by Jint 2.11.58, ES5 only), what this line does, why a handler would have it, and anything to watch out for. Keep it short: a few sentences.',
    `Line ${line + 1}: ${raw.trim()}`,
    `The lines around it:\n${text.split('\n').slice(Math.max(0, line - 3), line + 4).join('\n')}`,
    names.length ? `Docs of the names in it:\n${names.map((n) => `${n.path}: ${String(n.member.doc ?? '').split('\n')[0]}`).join('\n')}` : '',
    problems.length ? `Problems the checks found on it:\n${problems.join('\n')}` : '',
    `So your answer stays true to how Nucleus runs it:\n${aiHardRulesText()}`,
    'Answer as JSON: {"explanation": "…"} (Markdown inside the string is fine).',
  ].filter(Boolean).join('\n\n');
  return { line, text: raw, markdown: md, aiPrompt };
}

