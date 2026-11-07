import { useState, type FormEvent } from 'react';

import { timeLabel } from './hudModel';
import { CUSTOM_EVENT_KINDS, CUSTOM_EVENT_KIND_IDS, CUSTOM_EVENT_LIMITS, checkHeadline, normaliseHeadline, type CustomEventKind } from '../shared/customEvent';
import type { EventType } from '../shared/types';

// The engine's event types. `isTrue` is the engine's default truth for each.
export const presets: Array<{ type: EventType; title: string; isTrue: boolean; icon: string }> = [
  { type: 'merger', title: 'Merger with a competitor', isTrue: true, icon: '&' },
  { type: 'new_management', title: 'New VP takes over', isTrue: true, icon: '↑' },
  { type: 'long_hours_policy', title: 'Working-hours announcement', isTrue: true, icon: '!' },
  { type: 'pr_scandal', title: 'Unverified press allegation', isTrue: true, icon: '★' },
  { type: 'layoffs_rumour', title: 'Layoffs rumour', isTrue: false, icon: '?' },
  { type: 'surprise_bonus', title: 'Surprise bonus', isTrue: true, icon: '+' },
  { type: 'competitor_poaching', title: 'Competitor poaching staff', isTrue: true, icon: '$' },
];

const iconFor = (kind: CustomEventKind) => presets.find(p => p.type === CUSTOM_EVENT_KINDS[kind].base)?.icon ?? '!';

export function EventComposer({ onInject, onInjectCustom, onInjectBusiness, label, error, disabled = false, nextTick }: {
  onInjectBusiness?: (id: string, isTrue: boolean) => Promise<boolean>;
  onInject: (type: EventType, isTrue: boolean) => Promise<boolean>;
  onInjectCustom: (kind: CustomEventKind, text: string, isTrue: boolean) => Promise<boolean>;
  label: string;
  /** The last request error, shown if this composer's last post failed. */
  error: string | null;
  disabled?: boolean;
  nextTick: number;
}) {
  const [businessTemplate,setBusinessTemplate] = useState('client_win');
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [preset, setPreset] = useState(0);
  const [kind, setKind] = useState<CustomEventKind>(CUSTOM_EVENT_KIND_IDS[0]);
  const [headline, setHeadline] = useState('');
  const [isTrue, setIsTrue] = useState(presets[0].isTrue);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = presets[preset];
  // Instant feedback from the same rules the server applies; the server stays the gate.
  const check = checkHeadline(headline);
  const length = normaliseHeadline(headline).length;
  const showCheck = headline.trim() !== '' && !check.ok;

  function reset(truth: boolean) {
    setIsTrue(truth);
    setMessage('');
    setFailed(false);
  }

  function choose(index: number) {
    setPreset(index);
    reset(presets[index].isTrue);
  }

  function switchMode(next: 'preset' | 'custom') {
    setMode(next);
    reset(next === 'preset' ? chosen.isTrue : true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'custom' && !check.ok) return;
    setSending(true);
    const ok = mode === 'preset' ? await onInject(chosen.type, isTrue) : await onInjectCustom(kind, check.ok ? check.text : headline, isTrue);
    setSending(false);
    setFailed(!ok);
    setMessage(ok ? `Queued for ${timeLabel(nextTick)}. “${mode === 'preset' ? chosen.title : check.ok ? check.text : headline}”` : '');
    if (ok && mode === 'custom') setHeadline('');
  }

  return <section className="panel event-composer" aria-labelledby="event-composer-title">
    <div className="event-composer-heading">
      <h3 id="event-composer-title">{mode === 'preset' ? 'Choose an announcement' : 'Write an announcement'}</h3>
      <span className="event-preview-label">{label}</span>
    </div>
    {onInjectBusiness && <section className="structured-injection"><h3>Introduce a business situation</h3><p>The CEO chooses the response autonomously. This is labelled as a scenario override.</p><label>Situation <select value={businessTemplate} onChange={e => setBusinessTemplate(e.target.value)}><option value="client_win">Qualified client contract</option><option value="supplier_interruption">Supplier interruption</option><option value="material_breach">Supplier data exposure</option><option value="cost_review">Cost reduction review</option></select></label><button disabled={disabled || sending} onClick={async () => { setSending(true); try { const ok = await onInjectBusiness(businessTemplate,true); setFailed(!ok); setMessage(ok ? 'Business situation queued for the next tick.' : ''); } finally { setSending(false); } }}>Queue business situation</button><p role="status">{failed ? error : message}</p></section>}
    <div className="event-mode-tabs" role="tablist" aria-label="Announcement source">
      <button type="button" role="tab" aria-selected={mode === 'preset'} className={mode === 'preset' ? 'chosen' : ''} onClick={() => switchMode('preset')}>Presets</button>
      <button type="button" role="tab" aria-selected={mode === 'custom'} className={mode === 'custom' ? 'chosen' : ''} onClick={() => switchMode('custom')}>Write your own</button>
    </div>
    {mode === 'preset' ? <div className="event-presets" aria-label="Event presets">
      {presets.map((item, index) => <button type="button" key={item.type} aria-pressed={preset === index} className={preset === index ? 'event-preset chosen' : 'event-preset'} onClick={() => choose(index)}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}
    </div> : <div className="event-custom">
      <label className="event-headline-label" htmlFor="event-headline">Headline <span className={length > CUSTOM_EVENT_LIMITS.maxLength ? 'coral' : ''}>{length}/{CUSTOM_EVENT_LIMITS.maxLength}</span></label>
      <textarea id="event-headline" className="event-headline" rows={3} value={headline} maxLength={CUSTOM_EVENT_LIMITS.maxLength * 2} placeholder="The office coffee machine is being replaced with a vending machine." aria-invalid={showCheck} aria-describedby="event-headline-check" onChange={e => { setHeadline(e.target.value); setMessage(''); setFailed(false); }}/>
      <p id="event-headline-check" className="event-headline-check">{showCheck ? <span className="coral">{check.message}</span> : 'Keep it to things that could happen at an office.'}</p>
      <div className="event-presets event-kinds" role="radiogroup" aria-label="What kind of event is it?">
        {CUSTOM_EVENT_KIND_IDS.map(id => <button type="button" role="radio" key={id} aria-checked={kind === id} className={kind === id ? 'event-preset chosen' : 'event-preset'} title={CUSTOM_EVENT_KINDS[id].hint} onClick={() => setKind(id)}><span aria-hidden="true">{iconFor(id)}</span>{CUSTOM_EVENT_KINDS[id].label}</button>)}
      </div>
    </div>}
    <form onSubmit={submit} className="event-form">
      <div className="event-selection">
        <div className="event-selection-copy"><strong>{mode === 'preset' ? chosen.title : `${CUSTOM_EVENT_KINDS[kind].label}: ${CUSTOM_EVENT_KINDS[kind].hint.toLowerCase()}`}</strong></div>
      </div>
      <div className="event-action-row">
        <fieldset className="event-truth-options"><legend>Behind the headline</legend><label className={isTrue ? 'selected' : ''}><input type="radio" name="event-truth" checked={isTrue} onChange={() => setIsTrue(true)} /> True event</label><label className={!isTrue ? 'selected' : ''}><input type="radio" name="event-truth" checked={!isTrue} onChange={() => setIsTrue(false)} /> False rumour</label></fieldset>
        <button className="post-event" type="submit" disabled={disabled || sending || (mode === 'custom' && !check.ok)}>{sending ? (mode === 'custom' ? 'Checking…' : 'Posting…') : 'Post announcement'} <span aria-hidden="true">↗</span></button>
      </div>
      <div className="event-form-note"><span>Truth stays hidden from employees.{mode === 'custom' && ' Custom text is informational; structured situations create business work.'}</span><p className="event-feedback" role="status">{failed && error ? <span className="coral">{error}</span> : message || 'Queued announcements arrive at the start of the next tick.'}</p></div>
    </form>
  </section>;
}
