import { useState, type FormEvent } from 'react';

import { timeLabel } from './hudModel';
import { CUSTOM_EVENT_LIMITS, checkHeadline, normaliseHeadline } from '../shared/customEvent';
import type { EventType } from '../shared/types';

export function EventComposer({ onInject, onInjectCustom, label, error, disabled = false, nextTick }: {
  onInject: (type: EventType, isTrue: boolean) => Promise<boolean>;
  onInjectCustom: (text: string, isTrue: boolean) => Promise<boolean>;
  label: string;
  error: string | null;
  disabled?: boolean;
  nextTick: number;
}) {
  const [headline, setHeadline] = useState('');
  const [isTrue, setIsTrue] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const check = checkHeadline(headline);
  const length = normaliseHeadline(headline).length;
  const showCheck = headline.trim() !== '' && !check.ok;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check.ok) return;
    setSending(true);
    const ok = await onInjectCustom(check.ok ? check.text : headline, isTrue);
    setSending(false);
    setFailed(!ok);
    setMessage(ok ? `Queued for ${timeLabel(nextTick)}. “${check.ok ? check.text : headline}”` : '');
    if (ok) setHeadline('');
  }

  return <section className="panel event-composer" aria-labelledby="event-composer-title">
    <div className="event-composer-heading">
      <h3 id="event-composer-title">Write an announcement</h3>
      <span className="event-preview-label">{label}</span>
    </div>

    <div className="event-custom">
      <label className="event-headline-label" htmlFor="event-headline">Headline <span className={length > CUSTOM_EVENT_LIMITS.maxLength ? 'coral' : ''}>{length}/{CUSTOM_EVENT_LIMITS.maxLength}</span></label>
      <textarea id="event-headline" className="event-headline" rows={3} value={headline} maxLength={CUSTOM_EVENT_LIMITS.maxLength * 2} placeholder="Tariffs are pushing shipping costs up and teams expect a hiring freeze and layoffs." aria-invalid={showCheck} aria-describedby="event-headline-check" onChange={e => { setHeadline(e.target.value); setMessage(''); setFailed(false); }}/>
      <p id="event-headline-check" className="event-headline-check">{showCheck ? <span className="coral">{check.message}</span> : 'The sim infers the office impact automatically from the headline.'}</p>
    </div>

    <form onSubmit={submit} className="event-form">
      <div className="event-selection">
        <div className="event-selection-copy"><strong>AI-generated office event</strong></div>
      </div>
      <div className="event-action-row">
        <fieldset className="event-truth-options"><legend>Behind the headline</legend><label className={isTrue ? 'selected' : ''}><input type="radio" name="event-truth" checked={isTrue} onChange={() => setIsTrue(true)} /> True event</label><label className={!isTrue ? 'selected' : ''}><input type="radio" name="event-truth" checked={!isTrue} onChange={() => setIsTrue(false)} /> False rumour</label></fieldset>
        <button className="post-event" type="submit" disabled={disabled || sending || !check.ok}>{sending ? 'Checking…' : 'Post announcement'} <span aria-hidden="true">↗</span></button>
      </div>
      <div className="event-form-note"><span>Truth stays hidden from employees. The sim infers the event family and impact automatically.</span><p className="event-feedback" role="status">{failed && error ? <span className="coral">{error}</span> : message || 'Queued announcements arrive at the start of the next hour.'}</p></div>
    </form>
  </section>;
}
