// A leading byte order mark: Nucleus (.NET's File.ReadAllLines, UTF-8) drops it, so the core does too, once, at its
// entry points (lint, completion; format keeps it in place itself), with offsets still counted in the text as given.

export const BOM = '\uFEFF';

/** A copy of `v` with every numeric `start`, `end` and `offset` moved by `n` (results of the core features). */
export function shiftOffsets<T>(v: T, n: number): T {
  if (!n || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => shiftOffsets(x, n)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = typeof x === 'number' && (k === 'start' || k === 'end' || k === 'offset') ? x + n : shiftOffsets(x, n);
  return out as T;
}

/** Runs `f` on the text without its BOM (the offset moved with it), and moves the offsets in the result back. */
export function withoutBom<T>(text: string, offset: number, f: (text: string, offset: number) => T): T {
  if (!text.startsWith(BOM)) return f(text, offset);
  return shiftOffsets(f(text.slice(1), Math.max(0, offset - 1)), 1);
}
