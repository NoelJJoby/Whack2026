import { useState, type FormEvent } from 'react';

import { timeLabel } from './hudModel';
import { CUSTOM_EVENT_LIMITS, checkHeadline, normaliseHeadline } from '../shared/customEvent';
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

export function EventComposer({ onInject, onInjectCustom, onInjectBusiness, label, error, disabled = false, nextTick }: {
  onInjectBusiness?: (id: string, isTrue: boolean) => Promise<boolean>;
  onInject: (type: EventType, isTrue: boolean) => Promise<boolean>;
  onInjectCustom: (text: string, isTrue: boolean) => Promise<boolean>;
  label: string;
  error: string | null;
  disabled?: boolean;
  nextTick: number;
}) {
  const [businessTemplate,setBusinessTemplate] = useState('client_win');
  const [businessSending, setBusinessSending] = useState(false);
  const [businessMessage, setBusinessMessage] = useState('');
  const [businessFailed, setBusinessFailed] = useState(false);
  const [activePanel, setActivePanel] = useState<'preset' | 'custom'>('preset');
  const [preset, setPreset] = useState(0);
  const [presetTruth, setPresetTruth] = useState(presets[0].isTrue);
  const [presetMessage, setPresetMessage] = useState('');
  const [presetSending, setPresetSending] = useState(false);
  const [presetFailed, setPresetFailed] = useState(false);

  const [headline, setHeadline] = useState('');
  const [customTruth, setCustomTruth] = useState(true);
  const [customMessage, setCustomMessage] = useState('');
  const [customSending, setCustomSending] = useState(false);
  const [customFailed, setCustomFailed] = useState(false);

  const chosen = presets[preset];
  const check = checkHeadline(headline);
  const length = normaliseHeadline(headline).length;
  const showCheck = headline.trim() !== '' && !check.ok;

  async function submitPreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPresetSending(true);
    const ok = await onInject(chosen.type, presetTruth);
    setPresetSending(false);
    setPresetFailed(!ok);
    setPresetMessage(ok ? `Queued for ${timeLabel(nextTick)}. “${chosen.title}”` : '');
  }

  async function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check.ok) return;
    setCustomSending(true);
    const ok = await onInjectCustom(check.ok ? check.text : headline, customTruth);
    setCustomSending(false);
    setCustomFailed(!ok);
    setCustomMessage(ok ? `Queued for ${timeLabel(nextTick)}. “${check.ok ? check.text : headline}”` : '');
    if (ok) setHeadline('');
  }

  return <section className="panel event-composer" aria-labelledby="event-composer-title">
    <div className="event-composer-heading">
      <h3 id="event-composer-title">Announcement board</h3>
      <span className="event-preview-label">{label}</span>
    </div>
    {onInjectBusiness && <section className="structured-injection"><h3>Introduce a business situation</h3><p>The CEO chooses the response autonomously. This is labelled as a scenario override.</p><label>Situation <select value={businessTemplate} onChange={e => setBusinessTemplate(e.target.value)}><option value="client_win">Qualified client contract</option><option value="supplier_interruption">Supplier interruption</option><option value="material_breach">Supplier data exposure</option><option value="cost_review">Cost reduction review</option></select></label><button disabled={disabled || businessSending} onClick={async () => { setBusinessSending(true); try { const ok = await onInjectBusiness(businessTemplate,true); setBusinessFailed(!ok); setBusinessMessage(ok ? 'Business situation queued for the next tick.' : ''); } finally { setBusinessSending(false); } }}>Queue business situation</button><p role="status">{businessFailed ? error : businessMessage}</p></section>}

    <div className="event-panel-tabs" role="tablist" aria-label="Event type selector">
      <button type="button" role="tab" aria-selected={activePanel === 'preset'} className={activePanel === 'preset' ? 'event-panel-tab active' : 'event-panel-tab'} onClick={() => setActivePanel('preset')}>Preset events</button>
      <button type="button" role="tab" aria-selected={activePanel === 'custom'} className={activePanel === 'custom' ? 'event-panel-tab active' : 'event-panel-tab'} onClick={() => setActivePanel('custom')}>Custom event</button>
    </div>

    <div className="event-panels">
      {activePanel === 'preset' && <div className="event-panel" role="tabpanel" aria-label="Preset events">
        <div className="event-panel-header">
          <h4>Preset events</h4>
        </div>
        <div className="event-presets" aria-label="Event presets">
          {presets.map((item, index) => <button type="button" key={item.type} aria-pressed={preset === index} className={preset === index ? 'event-preset chosen' : 'event-preset'} onClick={() => { setPreset(index); setPresetTruth(item.isTrue); setPresetMessage(''); setPresetFailed(false); }}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}
        </div>

        <form onSubmit={submitPreset} className="event-form">
          <div className="event-selection">
            <div className="event-selection-copy"><strong>{chosen.title}</strong></div>
          </div>
          <div className="event-action-row">
            <fieldset className="event-truth-options"><legend>Behind the headline</legend><label className={presetTruth ? 'selected' : ''}><input type="radio" name="preset-event-truth" checked={presetTruth} onChange={() => setPresetTruth(true)} /> True event</label><label className={!presetTruth ? 'selected' : ''}><input type="radio" name="preset-event-truth" checked={!presetTruth} onChange={() => setPresetTruth(false)} /> False rumour</label></fieldset>
            <button className="post-event" type="submit" disabled={disabled || presetSending}>{presetSending ? 'Posting…' : 'Post preset'} <span aria-hidden="true">↗</span></button>
          </div>
          <div className="event-form-note"><span>Quick board pushes for common office shocks.</span><p className="event-feedback" role="status">{presetFailed && error ? <span className="coral">{error}</span> : presetMessage || 'Queued announcements arrive at the start of the next hour.'}</p></div>
        </form>
      </div>}

      {activePanel === 'custom' && <div className="event-panel" role="tabpanel" aria-label="Custom event">
        <div className="event-panel-header">
          <h4>Custom event</h4>
        </div>
        <div className="event-custom">
          <label className="event-headline-label" htmlFor="event-headline">Headline <span className={length > CUSTOM_EVENT_LIMITS.maxLength ? 'coral' : ''}>{length}/{CUSTOM_EVENT_LIMITS.maxLength}</span></label>
          <textarea id="event-headline" className="event-headline" rows={3} value={headline} maxLength={CUSTOM_EVENT_LIMITS.maxLength * 2} placeholder="Tariffs are pushing shipping costs up and teams expect a hiring freeze and layoffs." aria-invalid={showCheck} aria-describedby="event-headline-check" onChange={e => { setHeadline(e.target.value); setCustomMessage(''); setCustomFailed(false); }}/>
          <p id="event-headline-check" className="event-headline-check">{showCheck ? <span className="coral">{check.message}</span> : 'The sim infers the office impact automatically from the headline.'}</p>
        </div>

        <form onSubmit={submitCustom} className="event-form">
          <div className="event-selection">
            <div className="event-selection-copy"><strong>AI-generated office event</strong></div>
          </div>
          <div className="event-action-row">
            <fieldset className="event-truth-options"><legend>Behind the headline</legend><label className={customTruth ? 'selected' : ''}><input type="radio" name="custom-event-truth" checked={customTruth} onChange={() => setCustomTruth(true)} /> True event</label><label className={!customTruth ? 'selected' : ''}><input type="radio" name="custom-event-truth" checked={!customTruth} onChange={() => setCustomTruth(false)} /> False rumour</label></fieldset>
            <button className="post-event" type="submit" disabled={disabled || customSending || !check.ok}>{customSending ? 'Checking…' : 'Post custom'} <span aria-hidden="true">↗</span></button>
          </div>
          <div className="event-form-note"><span>Truth stays hidden from employees. The sim infers the event family and impact automatically.</span><p className="event-feedback" role="status">{customFailed && error ? <span className="coral">{error}</span> : customMessage || 'Queued announcements arrive at the start of the next hour.'}</p></div>
        </form>
      </div>}
    </div>
  </section>;
}
