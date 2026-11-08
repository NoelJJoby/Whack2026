import { useState, type FormEvent, type ReactNode } from 'react';

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

const panels = [
  { id: 'preset', label: 'Preset events' },
  { id: 'custom', label: 'Custom event' },
  { id: 'task', label: 'Company task' },
] as const;

export function EventComposer({ onInject, onInjectCustom, onInjectBusiness, label, error, disabled = false, nextTick, companyTask }: {
  onInjectBusiness?: (id: string, isTrue: boolean) => Promise<boolean>;
  onInject: (type: EventType, isTrue: boolean) => Promise<boolean>;
  onInjectCustom: (text: string, isTrue: boolean) => Promise<boolean>;
  label: string;
  error: string | null;
  disabled?: boolean;
  nextTick: number;
  companyTask: ReactNode;
}) {
  const [businessTemplate,setBusinessTemplate] = useState('client_win');
  const [businessSending, setBusinessSending] = useState(false);
  const [businessMessage, setBusinessMessage] = useState('');
  const [businessFailed, setBusinessFailed] = useState(false);
  const [activePanel, setActivePanel] = useState<typeof panels[number]['id']>('preset');
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
      <h3 id="event-composer-title">{activePanel === 'task' ? 'Company task' : 'Announcement board'}</h3>
      <span className="event-preview-label">{label}</span>
    </div>
    <div className="event-panel-tabs" role="tablist" aria-label="Office input" onKeyDown={event => {
      const index = panels.findIndex(panel => panel.id === activePanel);
      const next = event.key === 'ArrowRight' ? (index + 1) % panels.length
        : event.key === 'ArrowLeft' ? (index + panels.length - 1) % panels.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      const { id } = panels[next];
      setActivePanel(id);
      event.currentTarget.querySelector<HTMLButtonElement>(`#office-tab-${id}`)?.focus();
    }}>
      {panels.map(({ id, label }) => <button key={id} type="button" role="tab" id={`office-tab-${id}`}
        aria-controls={`office-panel-${id}`} aria-selected={activePanel === id} tabIndex={activePanel === id ? 0 : -1}
        className={activePanel === id ? 'event-panel-tab active' : 'event-panel-tab'} onClick={() => setActivePanel(id)}>{label}</button>)}
    </div>

    {activePanel !== 'task' && onInjectBusiness && <section className="structured-injection"><h3>Introduce a business situation</h3><p>The CEO chooses the response autonomously. This is labelled as a scenario override.</p><label>Situation <select value={businessTemplate} onChange={e => setBusinessTemplate(e.target.value)}><option value="client_win">Qualified client contract</option><option value="supplier_interruption">Supplier interruption</option><option value="material_breach">Supplier data exposure</option><option value="cost_review">Cost reduction review</option></select></label><button disabled={disabled || businessSending} onClick={async () => { setBusinessSending(true); try { const ok = await onInjectBusiness(businessTemplate,true); setBusinessFailed(!ok); setBusinessMessage(ok ? `Business situation queued for ${timeLabel(nextTick)}.` : ''); } finally { setBusinessSending(false); } }}>Queue business situation</button><p role="status">{businessFailed ? error : businessMessage}</p></section>}

    <div className="event-panels">
      <div id="office-panel-preset" role="tabpanel" aria-labelledby="office-tab-preset" hidden={activePanel !== 'preset'}><div className="event-panel">
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
          <div className="event-form-note"><span>Quick board pushes for common office shocks.</span><p className="event-feedback" role="status">{presetFailed && error ? <span className="coral">{error}</span> : presetMessage || `Next announcement: ${timeLabel(nextTick)}.`}</p></div>
        </form>
      </div></div>

      <div id="office-panel-custom" role="tabpanel" aria-labelledby="office-tab-custom" hidden={activePanel !== 'custom'}><div className="event-panel">
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
          <div className="event-form-note"><span>Truth stays hidden from employees. The sim infers the event family and impact automatically.</span><p className="event-feedback" role="status">{customFailed && error ? <span className="coral">{error}</span> : customMessage || `Next announcement: ${timeLabel(nextTick)}.`}</p></div>
        </form>
      </div></div>
      <div id="office-panel-task" role="tabpanel" aria-labelledby="office-tab-task" hidden={activePanel !== 'task'}>{companyTask}</div>
    </div>
  </section>;
}
