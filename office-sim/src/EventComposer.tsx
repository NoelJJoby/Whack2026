import { useState, type FormEvent } from 'react';

export interface BillboardPost {
  id: number;
  title: string;
  isTrue: boolean;
}

const presets = [
  { title: 'Customer data breach', isTrue: true, icon: '!' },
  { title: 'Fake Glassdoor review by CEO', isTrue: true, icon: '★' },
  { title: 'Fake acquisition rumour', isTrue: false, icon: '?' },
  { title: 'Surprise bonus', isTrue: true, icon: '+' },
];

export function EventComposer({ onPost }: { onPost: (post: Omit<BillboardPost, 'id'>) => void }) {
  const [preset, setPreset] = useState<number | null>(0);
  const [title, setTitle] = useState(presets[0].title);
  const [isTrue, setIsTrue] = useState(true);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);

  function choose(index: number | null) {
    setPreset(index);
    setEditing(index === null);
    setTitle(index === null ? '' : presets[index].title);
    setIsTrue(index === null ? true : presets[index].isTrue);
    setMessage('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setEditing(true);
      setMessage('Add a headline before posting.');
      return;
    }
    onPost({ title: title.trim(), isTrue });
    setMessage('Posted to the preview billboard and office wire. Employee reactions are not simulated in this preview.');
  }

  return <section className="panel event-composer" aria-labelledby="event-composer-title">
    <div className="event-composer-heading">
      <div><span className="event-eyebrow">YOU MAKE THE NEWS</span><h2 id="event-composer-title">Shake up the office.</h2><p>Pick an event to shake things up.</p></div>
      <span className="event-preview-label">MOCK PREVIEW</span>
    </div>
    <div className="event-presets" aria-label="Event presets">
      {presets.map((item, index) => <button type="button" key={item.title} aria-pressed={preset === index} className={preset === index ? 'event-preset chosen' : 'event-preset'} onClick={() => choose(index)}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}
    </div>
    <form onSubmit={submit} className="event-form">
      <div className="event-selection">
        <div className="event-selection-copy"><span className="event-eyebrow">READY TO POST</span><strong>{title.trim() || 'Your next office headline'}</strong></div>
        <button type="button" className="edit-headline" aria-expanded={editing} aria-controls="headline-editor" onClick={() => setEditing(!editing)}>{editing ? 'Close editor −' : 'Edit headline ✎'}</button>
      </div>
      {editing && <div className="event-fields" id="headline-editor">
        <label htmlFor="event-title">Headline <span>{title.length}/100</span></label>
        <input id="event-title" autoFocus value={title} maxLength={100} required placeholder="What just happened?" onChange={e => { setTitle(e.target.value); setPreset(null); setMessage(''); }} />
      </div>}
      <div className="event-action-row">
        <fieldset className="event-truth-options"><legend>Behind the headline</legend><label className={isTrue ? 'selected' : ''}><input type="radio" name="event-truth" checked={isTrue} onChange={() => setIsTrue(true)} /> True event</label><label className={!isTrue ? 'selected' : ''}><input type="radio" name="event-truth" checked={!isTrue} onChange={() => setIsTrue(false)} /> False rumour</label></fieldset>
        <button className="post-event" type="submit">Post to billboard <span aria-hidden="true">↗</span></button>
      </div>
      <div className="event-form-note"><span>Truth stays hidden from employees.</span><p className="event-feedback" role="status">{message || 'Preview only · no live simulation changes.'}</p></div>
    </form>
  </section>;
}
