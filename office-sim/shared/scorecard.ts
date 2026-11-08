// Run scorecard. Five metrics advance live every tick (kept on the engine world, shown in the
// Scorecard panel); productivity is scored once from the saved run for the final report card.
// Pure: no engine imports, thresholds are passed in.
import type { Action, AgentStatus } from './types';

export interface ScoreAgent { status: AgentStatus; stress: number; burnout: number; trust_mgmt: number }

export interface ScorecardParams {
  /** Overwork credit = 1 - (burnout overwork adds directly) * this weight. */
  overworkBurnoutWeight: number;
}

/** 100 minus the mean of stress and burnout over active staff; null with nobody active. */
export function moraleOf(agents: ScoreAgent[]): number | null {
  const active = agents.filter(a => a.status === 'active');
  return active.length ? 100 - active.reduce((n, a) => n + (a.stress + a.burnout) / 2, 0) / active.length : null;
}
function trustOf(agents: ScoreAgent[]): number | null {
  const active = agents.filter(a => a.status === 'active');
  return active.length ? active.reduce((n, a) => n + a.trust_mgmt, 0) / active.length : null;
}

export interface LiveScorecard {
  tick: number;
  price: number; startPrice: number;
  startHeadcount: number; headcount: number;
  quits: number; layoffs: number; firstQuitTick: number | null;
  /** Share of the starting staff who have not resigned (layoffs counted separately). */
  retention: number;
  morale: number; startMorale: number;
  trust: number; startTrust: number;
  falseReach: number; peakFalseReach: number; leaks: number;
}

export function createLiveScorecard(start: { price: number; agents: ScoreAgent[] }): LiveScorecard {
  const morale = moraleOf(start.agents) ?? 0; const trust = trustOf(start.agents) ?? 0;
  const headcount = start.agents.filter(a => a.status === 'active').length;
  return { tick: 0, price: start.price, startPrice: start.price,
    startHeadcount: headcount, headcount, quits: 0, layoffs: 0, firstQuitTick: null, retention: 1,
    morale, startMorale: morale, trust, startTrust: trust, falseReach: 0, peakFalseReach: 0, leaks: 0 };
}

export interface LiveInput { tick: number; price: number; agents: ScoreAgent[]; falseReach: number; leaks: number }

export function advanceLiveScorecard(card: LiveScorecard, input: LiveInput): LiveScorecard {
  const quits = input.agents.filter(a => a.status === 'quit').length;
  const layoffs = input.agents.filter(a => a.status === 'laid_off').length;
  const falseReach = input.falseReach;
  return { ...card, tick: input.tick, price: input.price,
    headcount: input.agents.filter(a => a.status === 'active').length, quits, layoffs,
    firstQuitTick: card.firstQuitTick ?? (quits > card.quits ? input.tick : null),
    retention: card.startHeadcount ? (card.startHeadcount - quits) / card.startHeadcount : 1,
    morale: moraleOf(input.agents) ?? card.morale, trust: trustOf(input.agents) ?? card.trust,
    falseReach, peakFalseReach: Math.max(card.peakFalseReach, falseReach), leaks: card.leaks + input.leaks };
}

const PRODUCTIVE: ReadonlySet<Action> = new Set(['work', 'review_work', 'report_issue', 'support_colleague']);

/** 0-1: productive credit per agent-hour with a decision, given every hour's chosen actions. */
export function productivity(hours: Action[][], p: ScorecardParams, overworkBurnout: number): number {
  const overworkCredit = Math.max(0, 1 - overworkBurnout * p.overworkBurnoutWeight);
  let credit = 0; let n = 0;
  for (const actions of hours) for (const action of actions) { n += 1; credit += action === 'overwork' ? overworkCredit : PRODUCTIVE.has(action) ? 1 : 0; }
  return n ? credit / n : 0;
}
