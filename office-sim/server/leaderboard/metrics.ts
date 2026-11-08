// Best Boss: one run's scorecard, from data the simulation already records. No new simulation logic.
import type { MetricId } from '../../shared/leaderboard';
import { moraleOf, productivity } from '../../shared/scorecard';
import { TICKS_PER_DAY } from '../../shared/workday';
import type { EngineTickLog, World } from '../engine-types';
import type { Params } from '../params';

const mean = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);

export function runMetrics(world: World, logs: EngineTickLog[], params: Params, ticks: number): Record<MetricId, number> {
  const prices = logs.map(l => l.price.price);
  const rets = logs.map(l => l.price.ret);
  const mr = mean(rets);
  // Daily 23:00 closes: hourly drawdown would only measure the office-hours price cycle every day repeats.
  const closes = [params.price.initialPrice, ...prices.filter((_, i) => (i + 1) % TICKS_PER_DAY === 0)];
  if (prices.length % TICKS_PER_DAY) closes.push(prices.at(-1)!);
  let peak = closes[0]; let drawdown = 0;
  for (const p of closes) { peak = Math.max(peak, p); drawdown = Math.max(drawdown, 1 - p / peak); }
  // Crises handled: true business cases (not unconfirmed rumours) that did not end in failure.
  const crises = world.eventState.cases.filter(e => e.rootId === e.id && e.truth);
  const departed = world.ids.map(id => world.agents[id]).filter(a => a.status !== 'active');
  const active = world.ids.map(id => world.agents[id]).filter(a => a.status === 'active');
  return {
    endPrice: world.price.price,
    volatility: 100 * Math.sqrt(mean(rets.map(r => (r - mr) ** 2))),
    maxDrawdown: 100 * drawdown,
    productivity: 100 * productivity(logs.map(l => l.decisions.map(d => d.chosen.action)), params.scorecard, params.rules.actions.overwork.burnout),
    crisesHandled: crises.length ? 100 * crises.filter(e => e.status !== 'failed').length / crises.length : 100,
    // Quits and layoffs both lose a person; layoffs are the CEO's only direct lever on staff.
    departures: departed.length,
    firstDeparture: departed.length ? Math.min(...departed.map(a => a.quitTick ?? ticks + 1)) : ticks + 1,
    morale: mean(logs.map(l => moraleOf(Object.values(l.states).map(s => ({ status: s.status, stress: s.stress, burnout: s.burnout, trust_mgmt: s.trust_mgmt }))) ?? 0)),
    trust: mean(active.map(a => a.state.trust_mgmt)),
    falseReach: Math.max(0, ...logs.map(l => l.reach.false_holders)),
    leaks: world.leaks.length,
  };
}
