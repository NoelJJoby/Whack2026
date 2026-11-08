import type { TickFrame } from '../shared/api';
import type { Action } from '../shared/types';
import { BURNOUT_RECOVERY_THRESHOLD, BURNOUT_STRESS_THRESHOLD } from '../shared/stressThresholds';
import { ruleParams, quitParams } from '../server/params';
import { workdayTime } from './Workday';
import { ACTIVITY_LABEL, isSpoken, shortenQuoted } from './companyModel';

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
  key: string; time: string; label: string; text: string; ids: string[]; truth?: boolean; tone?: BusinessNotice['tone'];
}
/** A business case changing in a way the spectator should see without opening the Business events panel. */
export interface BusinessNotice {
  key: string; caseId: string; stage: 'new' | 'uncovered' | 'escalated' | 'resolved' | 'failed';
  label: string; text: string; tone: 'mint' | 'coral' | 'gold';
}
/** Compares a frame's business cases with the previous hour's. Spectator-only: what employees know is unchanged. */
export function businessNotices(frame: TickFrame, prev?: TickFrame): BusinessNotice[] {
  const before = new Map((prev?.state.eventState?.cases ?? []).map(c => [c.id, c]));
  return (frame.state.eventState?.cases ?? []).flatMap((c): BusinessNotice[] => {
    const was = before.get(c.id);
    const notice = (stage: BusinessNotice['stage'], label: string, text: string, tone: BusinessNotice['tone']): BusinessNotice =>
      ({ key: `${frame.tick}-business-${c.id}-${stage}`, caseId: c.id, stage, label, text: playerText(text), tone });
    const valenceTone = c.valence === 'positive' ? 'mint' : 'coral';
    const yours = c.origin === 'injection' ? 'Your business event' : null;
    // With no previous frame, only cases opened this hour count as new (not everything in a reconnected history).
    const opened = !was && (prev ? true : c.openedTick === frame.tick);
    if (opened) return c.detected ? [notice('new', yours ?? (c.rarity === 'rare' ? 'Major business event' : 'New business event'), c.headline, valenceTone)] : [];
    if (!was) return [];
    const out: BusinessNotice[] = [];
    if (!was.detected && c.detected) out.push(notice('uncovered', 'Business event uncovered', c.headline, valenceTone));
    if (was.rarity !== 'rare' && c.rarity === 'rare') out.push(notice('escalated', 'Business event escalated', `${c.headline}. Now high severity.`, 'coral'));
    if (was.status !== c.status && (c.status === 'resolved' || c.status === 'failed')) {
      const unconfirmed = !c.truth;
      out.push(notice(c.status, c.status === 'failed' ? 'Business event failed' : unconfirmed ? 'Business event archived' : 'Business event resolved',
        `${c.headline}. ${c.outcome ?? ''}`.trim(), c.status === 'failed' ? 'coral' : unconfirmed ? 'gold' : 'mint'));
    }
    return out;
  });
}
/** Each record occurs once: a resignation replaces its action entry. */
export function feedEntries(history: TickFrame[]): FeedEntry[] {
  return history.map((frame, i) => ({ frame, prev: history[i - 1]?.tick === frame.tick - 1 ? history[i - 1] : undefined })).reverse().flatMap(({ frame, prev }) => [
    ...[...frame.records].reverse().sort((a, b) => Number(Boolean(b.quit)) - Number(Boolean(a.quit))).map((record) => ({
      key: `${frame.tick}-${record.agent}`, time: timeLabel(frame.tick),
      label: record.quit ? 'Resignation' : ACTION_LABEL[record.action], text: playerText(record.summary),
      ids: record.target ? [record.agent, record.target] : [record.agent],
    })),
    ...[...frame.events].reverse().map((event, i) => ({
      key: `${frame.tick}-event-${i}`, time: timeLabel(frame.tick),
      label: event.custom ? 'Your announcement' : event.type === 'layoffs_rumour' ? 'Rumour' : 'Announcement', text: playerText(event.text), ids: [], truth: event.is_true,
    })),
    ...businessNotices(frame, prev).reverse().map(n => ({ key: n.key, time: timeLabel(frame.tick), label: n.label, text: n.text, ids: [], tone: n.tone })),
    ...[...(frame.company_activity ?? [])].filter(a => isSpoken(a) || a.kind === 'review').sort((a, b) => b.round - a.round || b.order - a.order).map(a => ({
      key: `${frame.tick}-company-${a.id}`, time: timeLabel(frame.tick), label: ACTIVITY_LABEL[a.kind],
      text: playerText(shortenQuoted(a.dialogue)), ids: [...new Set([a.actor, ...a.recipients].filter((id): id is string => Boolean(id)))],
      tone: a.kind === 'outcome' ? (a.result?.startsWith('accepted') ? 'mint' as const : 'coral' as const) : 'gold' as const,
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
