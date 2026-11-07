import { useState, type FormEvent } from 'react';

import type { EventType } from '../shared/types';

// The engine's event types. `isTrue` is the engine's default truth for each.
export const presets: Array<{ type: EventType; title: string; isTrue: boolean; icon: string }> = [
  { type: 'merger', title: 'Merger with a competitor', isTrue: true, icon: '&' },
  { type: 'new_management', title: 'New VP takes over', isTrue: true, icon: '↑' },
  { type: 'long_hours_policy', title: '20-hour workday policy', isTrue: true, icon: '!' },
  { type: 'pr_scandal', title: 'Customer data breach', isTrue: true, icon: '★' },
  { type: 'layoffs_rumour', title: 'Layoffs rumour', isTrue: false, icon: '?' },
  { type: 'surprise_bonus', title: 'Surprise bonus', isTrue: true, icon: '+' },
  { type: 'competitor_poaching', title: 'Competitor poaching staff', isTrue: true, icon: '$' },
];

export function EventComposer({ onInject, label, error, disabled = false, nextTick }: {
  onInject: (type: EventType, isTrue: boolean) => Promise<boolean>;
  label: string;
  /** The last request error, shown if this composer's last post failed. */
  error: string | null;
  disabled?: boolean;
  nextTick: number;
}) {
  const [preset, setPreset] = useState(0);
  const [isTrue, setIsTrue] = useState(presets[0].isTrue);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = presets[preset];

  function choose(index: number) {
    setPreset(index);
    setIsTrue(presets[index].isTrue);
    setMessage('');
    setFailed(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    const ok = await onInject(chosen.type, isTrue);
    setSending(false);
    setFailed(!ok);
    setMessage(ok ? `Queued. “${chosen.title}” hits the office at tick ${String(nextTick).padStart(2, '0')}.` : '');
  }

  return <section className="panel event-composer" aria-labelledby="event-composer-title">
    <div className="event-composer-heading">
      <div><span className="event-eyebrow">YOU MAKE THE NEWS</span><h2 id="event-composer-title">Shake up the office.</h2><p>Pick an event to shake things up.</p></div>
      <span className="event-preview-label">{label}</span>
    </div>
    <div className="event-presets" aria-label="Event presets">
      {presets.map((item, index) => <button type="button" key={item.type} aria-pressed={preset === index} className={preset === index ? 'event-preset chosen' : 'event-preset'} onClick={() => choose(index)}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}
    </div>
    <form onSubmit={submit} className="event-form">
      <div className="event-selection">
        <div className="event-selection-copy"><span className="event-eyebrow">READY TO POST</span><strong>{chosen.title}</strong></div>
      </div>
      <div className="event-action-row">
        <fieldset className="event-truth-options"><legend>Behind the headline</legend><label className={isTrue ? 'selected' : ''}><input type="radio" name="event-truth" checked={isTrue} onChange={() => setIsTrue(true)} /> True event</label><label className={!isTrue ? 'selected' : ''}><input type="radio" name="event-truth" checked={!isTrue} onChange={() => setIsTrue(false)} /> False rumour</label></fieldset>
        <button className="post-event" type="submit" disabled={disabled || sending}>{sending ? 'Posting…' : 'Post to billboard'} <span aria-hidden="true">↗</span></button>
      </div>
      <div className="event-form-note"><span>Truth stays hidden from employees.</span><p className="event-feedback" role="status">{failed && error ? <span className="coral">{error}</span> : message || 'Posted events land at the start of the next tick.'}</p></div>
    </form>
  </section>;
}
