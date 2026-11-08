// "Best Boss" leaderboard: the precomputed results file's shape and the client-side scoring.
// The batch runner (server/scripts/leaderboard.ts) writes the file; the HUD only reads it.

export type Group = 'shareholders' | 'people';
export type MetricId = 'endPrice' | 'volatility' | 'maxDrawdown' | 'productivity' | 'crisesHandled'
  | 'departures' | 'firstDeparture' | 'morale' | 'trust' | 'falseReach' | 'leaks';

export interface MetricDef { id: MetricId; label: string; group: Group; higherIsBetter: boolean; unit: string; digits: number; badge: string }

export const METRICS: readonly MetricDef[] = [
  { id: 'endPrice', label: 'End stock price', group: 'shareholders', higherIsBetter: true, unit: '', digits: 2, badge: 'Top share price' },
  { id: 'volatility', label: 'Volatility', group: 'shareholders', higherIsBetter: false, unit: '%', digits: 2, badge: 'Calmest stock' },
  { id: 'maxDrawdown', label: 'Max drawdown', group: 'shareholders', higherIsBetter: false, unit: '%', digits: 1, badge: 'Smallest slump' },
  { id: 'productivity', label: 'Productivity', group: 'shareholders', higherIsBetter: true, unit: '%', digits: 1, badge: 'Most productive' },
  { id: 'crisesHandled', label: 'Crises handled', group: 'shareholders', higherIsBetter: true, unit: '%', digits: 0, badge: 'Crisis manager' },
  { id: 'departures', label: 'Departures', group: 'people', higherIsBetter: false, unit: '', digits: 1, badge: 'Kept everyone' },
  { id: 'firstDeparture', label: 'Hours to first departure', group: 'people', higherIsBetter: true, unit: 'h', digits: 1, badge: 'Held the team' },
  { id: 'morale', label: 'Morale', group: 'people', higherIsBetter: true, unit: '', digits: 1, badge: 'Happiest staff' },
  { id: 'trust', label: 'Trust in management', group: 'people', higherIsBetter: true, unit: '', digits: 1, badge: 'Most trusted' },
  { id: 'falseReach', label: 'Peak false-claim reach', group: 'people', higherIsBetter: false, unit: '', digits: 1, badge: 'Least rumours' },
  { id: 'leaks', label: 'Press leaks', group: 'people', higherIsBetter: false, unit: '', digits: 1, badge: 'No leaks' },
];

export interface LeaderboardEntry {
  id: string; name: string; kind: 'model' | 'baseline';
  /** Model entries: the API model id and the thinking setting it ran with. */
  model?: string; thinking?: string;
  /** Portrait shirt colour. */
  color: string;
}
export interface LeaderboardRun {
  entry: string; seed: number;
  metrics: Record<MetricId, number>;
  /** Share price after every hour, for the sparkline. */
  prices: number[];
  /** CEO turns, and how many fell back to the engine's rules CEO (invalid or failed model reply). */
  ceo: { decisions: number; fallbacks: number };
}
export interface LeaderboardFile {
  schemaVersion: 1;
  /** Fictional sample results, rather than measured simulation runs. */
  demo?: boolean;
  /** Starting share price, used to display the return across runs. */
  initialPrice?: number;
  /** Null until the batch has run. */
  generatedAt: string | null;
  mode: string; ticks: number; seeds: number[];
  scenario: Array<{ tick: number; type: string; templateId?: string }>;
  entries: LeaderboardEntry[];
  runs: LeaderboardRun[];
  /** Model entries: API calls and tokens actually spent (cache hits are free and not counted). */
  usage: Record<string, { calls: number; inputTokens: number; outputTokens: number; errors: number }>;
}

/** Per-metric 0-100 scores for every run, oriented so higher is always better. */
export interface Normalised { scores: Map<LeaderboardRun, Partial<Record<MetricId, number>>>; spread: Record<MetricId, boolean> }

/**
 * Min-max across all runs of all entries. A metric with no spread (every run equal) scores 50
 * and is left out of group averages, so it cannot stretch noise into a ranking.
 */
export function normalise(runs: LeaderboardRun[]): Normalised {
  const scores = new Map(runs.map(r => [r, {} as Partial<Record<MetricId, number>>]));
  const spread = {} as Record<MetricId, boolean>;
  for (const m of METRICS) {
    const values = runs.map(r => r.metrics[m.id]);
    const min = Math.min(...values); const max = Math.max(...values);
    spread[m.id] = runs.length > 0 && max - min > 1e-9;
    for (const r of runs) {
      const v = r.metrics[m.id];
      scores.get(r)![m.id] = !spread[m.id] ? 50 : 100 * (m.higherIsBetter ? v - min : max - v) / (max - min);
    }
  }
  return { scores, spread };
}

function groupScore(score: Partial<Record<MetricId, number>>, spread: Record<MetricId, boolean>, group: Group): number {
  const ids = METRICS.filter(m => m.group === group && spread[m.id]).map(m => m.id);
  return ids.length ? ids.reduce((n, id) => n + score[id]!, 0) / ids.length : 50;
}

/** Boss Score = (1 - w) x Shareholders + w x People; w = 0 is all shareholders, 1 all people. */
export const bossScore = (shareholders: number, people: number, w: number) => (1 - w) * shareholders + w * people;

export interface BoardRow {
  entry: LeaderboardEntry; rank: number;
  score: number; min: number; max: number;
  shareholders: number; people: number;
  /** Mean raw value and mean 0-100 score per metric, across this entry's seeds. */
  metrics: Array<{ def: MetricDef; raw: number; score: number; spread: boolean }>;
  badges: string[];
  /** Median-seed run (by end price) for the sparkline. */
  representative: LeaderboardRun;
  ceo: { decisions: number; fallbacks: number };
  runs: number;
}

const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

export function board(file: LeaderboardFile, w: number): BoardRow[] {
  const { scores, spread } = normalise(file.runs);
  const rows = file.entries.flatMap((entry): Omit<BoardRow, 'rank' | 'badges'>[] => {
    const runs = file.runs.filter(r => r.entry === entry.id);
    if (!runs.length) return [];
    const perRun = runs.map(r => {
      const s = scores.get(r)!; const sh = groupScore(s, spread, 'shareholders'); const pe = groupScore(s, spread, 'people');
      return { sh, pe, boss: bossScore(sh, pe, w) };
    });
    const byPrice = [...runs].sort((a, b) => a.metrics.endPrice - b.metrics.endPrice);
    return [{
      entry, score: mean(perRun.map(p => p.boss)), min: Math.min(...perRun.map(p => p.boss)), max: Math.max(...perRun.map(p => p.boss)),
      shareholders: mean(perRun.map(p => p.sh)), people: mean(perRun.map(p => p.pe)),
      metrics: METRICS.map(def => ({ def, raw: mean(runs.map(r => r.metrics[def.id])), score: mean(runs.map(r => scores.get(r)![def.id]!)), spread: spread[def.id] })),
      representative: byPrice[Math.floor((byPrice.length - 1) / 2)],
      ceo: { decisions: runs.reduce((n, r) => n + r.ceo.decisions, 0), fallbacks: runs.reduce((n, r) => n + r.ceo.fallbacks, 0) },
      runs: runs.length,
    }];
  });
  // Badges: best mean raw value per metric (ties share it); none where the metric has no spread.
  const badges = new Map(rows.map(r => [r.entry.id, [] as string[]]));
  for (const def of METRICS) {
    if (!spread[def.id] || rows.length < 2) continue;
    const raws = rows.map(r => r.metrics.find(m => m.def.id === def.id)!.raw);
    const best = def.higherIsBetter ? Math.max(...raws) : Math.min(...raws);
    if (raws.every(v => Math.abs(v - best) < 1e-9)) continue;
    rows.forEach((r, i) => { if (Math.abs(raws[i] - best) < 1e-9) badges.get(r.entry.id)!.push(def.badge); });
  }
  return rows.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map((r, i) => ({ ...r, rank: i + 1, badges: badges.get(r.entry.id)! }));
}
