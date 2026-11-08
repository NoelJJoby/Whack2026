import type { TickFrame } from '../shared/api';
import type { Action } from '../shared/types';
import { BURNOUT_RECOVERY_THRESHOLD, BURNOUT_STRESS_THRESHOLD } from '../shared/stressThresholds';
import { ruleParams, quitParams } from '../server/params';
import { workdayTime } from './Workday';

export const ACTION_LABEL: Record<Action, string> = {
  review_work: 'Reviewing work', report_issue: 'Reporting an issue', support_colleague: 'Supporting a colleague',
  work: 'Working', overwork: 'Overworking', slack_off: 'Slacking off', complain: 'Complaining',
  gossip: 'Spreading gossip', verify: 'Verifying rumour', interview: 'Interviewing', leak: 'Leaking to the press',
};
export function playerText(text: string) {
  return text.replace(/max_ticks/gi, 'duration').replace(/tick_in_progress/gi, 'decision in progress')
    .replace(/\ba tick\b/gi, 'A work period').replace(/\bticks\b/gi, 'work periods').replace(/\btick\b/gi, 'work period');
}
export function timeLabel(tick: number) {
  const { month, dayOfMonth, hour } = workdayTime(tick);
  return `Day ${dayOfMonth} (M${month}), ${String(hour).padStart(2, '0')}:00`;
}
export type Metric = 'Stress' | 'Burnout' | 'Trust in management' | 'Workload';
export function metricState(label: Metric, value: number, burnoutThreshold: number) {
  if (label === 'Stress') return value > BURNOUT_STRESS_THRESHOLD
    ? { text: 'Burnout rising', tone: 'coral' } : value < BURNOUT_RECOVERY_THRESHOLD
      ? { text: 'Recovery range', tone: 'mint' } : { text: 'Burnout steady', tone: 'gold' };
  if (label === 'Burnout') return value > burnoutThreshold
    ? { text: 'Above base exit threshold', tone: 'coral' } : { text: 'Within base exit threshold', tone: value === 0 ? 'mint' : 'gold' };
  if (label === 'Trust in management') return value < quitParams.trustThreshold
    ? { text: 'Low trust', tone: 'coral' } : { text: 'Outside low-trust range', tone: 'mint' };
  return value > ruleParams.comfortableWorkload
    ? { text: 'Above comfortable load', tone: 'coral' } : { text: 'Comfortable load', tone: 'mint' };
}
export interface FeedEntry {
  key: string; time: string; label: string; text: string; ids: string[]; truth?: boolean;
}
/** Each record occurs once: a resignation replaces its action entry. */
export function feedEntries(history: TickFrame[]): FeedEntry[] {
  return [...history].reverse().flatMap(frame => [
    ...[...frame.records].reverse().sort((a, b) => Number(Boolean(b.quit)) - Number(Boolean(a.quit))).map((record) => ({
      key: `${frame.tick}-${record.agent}`, time: timeLabel(frame.tick),
      label: record.quit ? 'Resignation' : ACTION_LABEL[record.action], text: playerText(record.summary),
      ids: record.target ? [record.agent, record.target] : [record.agent],
    })),
    ...[...frame.events].reverse().map((event, i) => ({
      key: `${frame.tick}-event-${i}`, time: timeLabel(frame.tick),
      label: event.custom ? 'Your announcement' : event.type === 'layoffs_rumour' ? 'Rumour' : 'Announcement', text: playerText(event.text), ids: [], truth: event.is_true,
    })),
  ]);
}

/** The engine label shown to players: which decision-maker is driving the office. */
export function engineLabel(mode: string | null, reason: string | null): string {
  if (mode === 'llm_bias') return 'LLM + bias engine';
  if (reason === 'no_api_key') return 'Rules mode · No API key';
  if (reason === 'llm_failed') return 'Rules mode · LLM unavailable';
  return 'Rules mode';
}
