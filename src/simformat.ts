// Text output of a simulation ("Try it"), shared by the CLI and the MCP server.
import { SimResult, sessionSummary, groupIgnored, EVERY_KEYBOARD } from './core/sim';

export function formatSimulation(r: SimResult, keyboardPlayer: number): string {
  const out: string[] = [];
  out.push(sessionSummary(r));
  if (!r.loaded) out.push(`  ${r.loadError ?? ''}`);
  if (r.inputNote) out.push(`  Note: ${r.inputNote}`);
  const ignored = groupIgnored(r.ignored);
  if (ignored.length) out.push('', `Settings Nucleus skips (${ignored.length}):`, ...ignored.map((s) => `  ${s}`));
  for (const p of r.players) {
    out.push('', `Player ${p.index + 1} (${p.index === keyboardPlayer || keyboardPlayer === EVERY_KEYBOARD ? 'keyboard & mouse' : 'controller'})`);
    if (p.error) out.push(`  FAILS: ${p.error}`);
    if (p.note) out.push(`  Note: ${p.note}`);
    out.push(`  Window:       ${p.window}`, `  Starts with:  ${p.startArguments || '(nothing extra)'}`);
    if (p.effects.length) out.push('  Changes before the game starts:', ...p.effects.map((e) => `    - ${e}`));
    if (p.calls.length) out.push('  Recorded calls:', ...p.calls.map((c) => `    ${c}`));
  }
  for (const c of r.callbacks) {
    out.push('', c.name);
    if (c.error) out.push(`  FAILS: ${c.error}${c.note ? ` ${c.note}` : ''}`);
    out.push(...c.calls.map((x) => `    ${x}`));
  }
  if (r.options.length) out.push('', `Options set (different from Nucleus' defaults):`, ...r.options.map((o) => `  ${o.path} = ${o.value}`));
  out.push('', 'Simulated: no files, registry or processes were touched. Windows, focus and input still need a real test in Nucleus.');
  return out.join('\n');
}
