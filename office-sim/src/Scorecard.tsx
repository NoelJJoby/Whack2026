import type { LiveScorecard } from '../shared/scorecard';
import { timeLabel } from './hudModel';

type Tone = 'mint' | 'coral' | 'gold' | '';
interface Tile { label: string; question: string; value: string; delta?: { text: string; tone: Tone }; detail: string }

/** Signed change since the start; tone = direction × whether up is good. Arrow + words so it never relies on colour. */
function change(now: number, start: number, upIsGood: boolean, unit: string, digits = 0): Tile['delta'] {
  const d = now - start;
  if (Math.abs(d) < 0.5 * 10 ** -digits) return { text: 'No change since start', tone: '' };
  const good = d > 0 === upIsGood;
  return { text: `${d > 0 ? '▲ +' : '▼ −'}${Math.abs(d).toFixed(digits)}${unit} since start`, tone: good ? 'mint' : 'coral' };
}

export function scorecardTiles(s: LiveScorecard): Tile[] {
  return [
    { label: 'Stock price', question: 'Shareholder value', value: s.price.toFixed(2),
      delta: change(s.price / s.startPrice * 100, 100, true, '%', 1), detail: `Started at ${s.startPrice.toFixed(2)}` },
    { label: 'Retention', question: 'Did people stay?', value: `${Math.round(s.retention * 100)}%`,
      delta: s.quits ? { text: `▼ ${s.quits} resigned`, tone: 'coral' } : { text: 'No resignations', tone: 'mint' },
      detail: `${s.layoffs ? `${s.layoffs} laid off · ` : ''}${s.firstQuitTick !== null ? `First quit ${timeLabel(s.firstQuitTick)}` : `${s.startHeadcount} on staff at start`}` },
    { label: 'Morale', question: 'How people feel', value: `${Math.round(s.morale)}`,
      delta: change(s.morale, s.startMorale, true, ' pts'), detail: `Low stress and burnout score high · ${s.headcount} active staff` },
    { label: 'Trust', question: 'Do they believe the boss?', value: `${Math.round(s.trust)}`,
      delta: change(s.trust, s.startTrust, true, ' pts'), detail: `Average trust in management · ${s.headcount} active staff` },
    { label: 'Rumour control', question: 'Did the boss keep the story straight?', value: `${s.falseReach}`,
      delta: s.leaks ? { text: `▼ ${s.leaks} press leak${s.leaks === 1 ? '' : 's'}`, tone: 'coral' } : { text: 'No press leaks', tone: 'mint' },
      detail: `False claims held now · peak ${s.peakFalseReach}` },
  ];
}

export function Scorecard({ scorecard }: { scorecard?: LiveScorecard }) {
  if (!scorecard) return <p className="empty-state">The scorecard appears once the simulation connects.</p>;
  return <section className="scorecard" aria-label="Run scorecard">
    <h3>Live scorecard · {scorecard.tick ? timeLabel(scorecard.tick) : 'Before the first hour'}</h3>
    <dl className="score-tiles">{scorecardTiles(scorecard).map(t => <div className="score-tile" key={t.label}>
      <dt>{t.label}<small>{t.question}</small></dt>
      <dd><strong>{t.value}</strong>{t.delta && <span className={t.delta.tone}>{t.delta.text}</span>}<small>{t.detail}</small></dd>
    </div>)}</dl>
    <p className="score-note">Productivity is scored on the final report card, from the whole run.</p>
  </section>;
}
