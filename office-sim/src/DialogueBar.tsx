import { useRef } from 'react';
import { Sprite, type Look } from './design/Office';
import type { DialogueLine, PlayerState } from './dialogueQueue';

export function Portrait({ look }: { look: Pick<Look, 'color' | 'hair' | 'skin'> }) {
  return <div className="dialogue-portrait" style={{ borderColor: look.color }}><Sprite person={look} crop/></div>;
}

/** Typed text plus the untyped rest held invisibly, so wrapping never shifts while typing. */
function Typed({ text, shown, typing }: { text: string; shown: number; typing: boolean }) {
  return <>{text.slice(0, shown)}{typing && <span className="dialogue-cursor" aria-hidden="true">▍</span>}<span className="dialogue-untyped">{text.slice(shown)}</span></>;
}

export interface Speaker { name: string; team: string; look: Pick<Look, 'color' | 'hair' | 'skin'> }

export function DialogueBar({ state, line, speaker, auto, showThoughts, hidden, onNext, onSkip, onAuto, onHistory }: {
  state: PlayerState;
  line: DialogueLine | null;
  speaker: Speaker | null;
  auto: boolean;
  showThoughts: boolean;
  /** A menu is open over the office. */
  hidden: boolean;
  onNext: () => void;
  onSkip: () => void;
  onAuto: () => void;
  onHistory: () => void;
}) {
  // Keep the last line on screen while the bar fades out.
  const last = useRef<{ line: DialogueLine; speaker: Speaker } | null>(null);
  if (line && speaker) last.current = { line, speaker };
  const open = Boolean(line && speaker) && !hidden;
  const shown = last.current;
  if (!shown) return null;
  const active = Boolean(line);
  const { phase } = state;
  const publicShown = active ? state.shownPublic : shown.line.publicLine.length;
  const innerShown = active ? state.shownInner : shown.line.inner.length;
  const thoughts = showThoughts && Boolean(shown.line.inner);
  const innerStarted = !active || phase === 'inner' || phase === 'reading';
  const announcement = `${shown.speaker.name}: “${shown.line.publicLine}”${thoughts ? ` Thinks: ${shown.line.inner}` : ''}`;
  return <section className={`dialogue-bar ${open ? 'open' : ''}`} aria-label="Dialogue">
    <div className="dialogue-plate"><strong>{shown.speaker.name}</strong>{shown.speaker.team && <small>· {shown.speaker.team}</small>}{shown.line.quit && <span className="dialogue-tag">Left the company</span>}</div>
    <div className="dialogue-box">
      <Portrait look={shown.speaker.look}/>
      <div className="dialogue-text" onClick={onNext} aria-hidden="true">
        <p className="dialogue-public">“<Typed text={shown.line.publicLine} shown={publicShown} typing={active && phase === 'public'}/>”</p>
        {thoughts && <p className={`dialogue-inner ${innerStarted ? '' : 'waiting'}`}><span>thinks:</span> <Typed text={shown.line.inner} shown={innerShown} typing={active && phase === 'inner'}/></p>}
      </div>
      <div className="dialogue-controls">
        {state.pending && <span className="dialogue-new">New round ▸</span>}
        {active && <span className="dialogue-progress" aria-label={`Line ${state.index + 1} of ${state.round.length}`}>{state.index + 1}/{state.round.length}</span>}
        <button onClick={onNext} aria-label="Next line" title="Next line (Enter or N)">▶</button>
        <button onClick={onSkip} aria-label="Skip round" title="Skip round (S)">⏭</button>
        <button onClick={onAuto} aria-pressed={auto} aria-label="Auto advance" title="Auto advance (A)">AUTO</button>
        <button onClick={onHistory} aria-label="Open dialogue history in Office wire" title="History">LOG</button>
      </div>
    </div>
    <p className="visually-hidden" aria-live="polite">{open ? announcement : ''}</p>
  </section>;
}
