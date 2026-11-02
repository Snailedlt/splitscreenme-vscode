// Apply every safe automatic fix the linter offers ("Fix all"), repeatedly until
// nothing more changes. Deterministic, offline, no AI.
import { lint, Diagnostic, LintOptions, TextEdit, lineOf } from './lint';

export interface AppliedFix {
  rule: string;
  title: string;
  line: number;
}
export interface FixAllResult {
  code: string;
  applied: AppliedFix[];
  /** Problems still present after fixing (errors and warnings). */
  remaining: Diagnostic[];
}

/**
 * Applies the preferred fix of each diagnostic. Fixes whose edits overlap an
 * already chosen fix wait for the next pass (the code is re-linted in between),
 * so nested problems (an arrow inside an arrow) resolve over several passes.
 */
export function fixAll(text: string, options: LintOptions & { maxPasses?: number } = {}): FixAllResult {
  let code = text;
  const applied: AppliedFix[] = [];
  for (let pass = 0; pass < (options.maxPasses ?? 10); pass++) {
    const diags = lint(code, options);
    const chosen: TextEdit[] = [];
    const seen = new Set<string>();
    const overlaps = (e: TextEdit) =>
      chosen.some((c) => (e.start < c.end && c.start < e.end) || (e.start === e.end && e.start >= c.start && e.start <= c.end) || (c.start === c.end && c.start >= e.start && c.start <= e.end));
    for (const d of diags) {
      const fix = d.fixes?.find((f) => f.preferred);
      if (!fix) continue;
      const key = JSON.stringify(fix.edits);
      if (seen.has(key)) continue; // the same fix offered by several diagnostics
      if (fix.edits.some(overlaps)) continue;
      seen.add(key);
      chosen.push(...fix.edits);
      applied.push({ rule: d.rule, title: fix.title.replace(/`/g, ''), line: lineOf(code, d.start) + 1 });
    }
    if (!chosen.length) break;
    for (const e of [...chosen].sort((a, b) => b.start - a.start || b.end - a.end)) code = code.slice(0, e.start) + e.text + code.slice(e.end);
  }
  return { code, applied, remaining: lint(code, options).filter((d) => d.severity === 'error' || d.severity === 'warning') };
}
