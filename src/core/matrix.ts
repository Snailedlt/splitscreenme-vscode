// "Test all combinations": every player count (up to Game.MaxPlayers, at most 8), input setup and
// monitor size, run through Try it. Shared by the VS Code panel and the browser workbench; the
// caller passes how to simulate (isolated in Node, a worker in the browser).
import type { SimOptions, SimResult } from './sim';

export const MATRIX_RESOLUTIONS: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [2560, 1080],
  [1366, 768],
];
export interface MatrixMode {
  kb: number; // SimOptions.keyboardPlayer: -1 nobody, 0 player 1, -2 each player their own
  label: string;
  offered: boolean;
}
export interface MatrixJob {
  players: number;
  kb: number;
  width: number;
  height: number;
}
export interface MatrixFail {
  width: number;
  height: number;
  why: string;
}
export interface MatrixPlan {
  max: number;
  modes: MatrixMode[];
  jobs: MatrixJob[];
}

/** What to run, from one plain run of the handler; null when it doesn't load. */
export function planMatrix(first: SimResult): MatrixPlan | null {
  if (!first.loaded) return null;
  const opt = (path: string) => first.options.find((o) => o.path === path)?.value;
  const max = Math.min(8, Math.max(1, Number(opt('Game.MaxPlayers')) || 4));
  const multi = opt('Game.SupportsMultipleKeyboardsAndMice') === 'true';
  const modes: MatrixMode[] = [
    { kb: -1, label: 'Controllers only', offered: true },
    { kb: 0, label: 'Keyboard for player 1', offered: true },
    { kb: -2, label: 'Keyboard for each player', offered: multi },
  ];
  const jobs: MatrixJob[] = [];
  for (let players = 1; players <= max; players++)
    for (const m of modes) if (m.offered) for (const [width, height] of MATRIX_RESOLUTIONS) jobs.push({ players, kb: m.kb, width, height });
  return { max, modes, jobs };
}

export const jobOptions = (j: MatrixJob, base: Partial<SimOptions> = {}): SimOptions => ({ ...base, players: j.players, width: j.width, height: j.height, keyboardPlayer: j.kb });

/** Why a run failed (the first line), or undefined when it worked. */
export function failureOf(r: SimResult): string | undefined {
  const bad = r.sessionEnded ? r.sessionEnded.reason : r.players.find((x) => x.error)?.error ?? r.callbacks.find((x) => x.error)?.error;
  if (r.loaded && !bad) return undefined;
  return (bad ?? r.loadError ?? 'fails').split('\n')[0].slice(0, 140);
}

export interface MatrixResult {
  plan: MatrixPlan;
  /** `${players}|${kb}` → the screens that failed (empty: all worked). */
  cells: Map<string, MatrixFail[]>;
  failed: number;
}

/** Runs every job at once (Node hosts; the workbench runs them in slices to stay responsive). */
export function runMatrix(plan: MatrixPlan, simulate: (o: SimOptions) => SimResult, base: Partial<SimOptions> = {}): MatrixResult {
  const cells = new Map<string, MatrixFail[]>();
  let failed = 0;
  for (const j of plan.jobs) {
    const key = `${j.players}|${j.kb}`;
    const list = cells.get(key) ?? [];
    const why = failureOf(simulate(jobOptions(j, base)));
    if (why) (list.push({ width: j.width, height: j.height, why }), failed++);
    cells.set(key, list);
  }
  return { plan, cells, failed };
}
