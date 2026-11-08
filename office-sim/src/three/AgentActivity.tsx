import { useEffect, useState } from 'react';
import type { DialogueLine } from '../dialogueQueue';
import { playerText } from '../hudModel';
import { EMOTE_ICON } from '../emotes';
import type { Emote, Kind } from './Agent3D';

const clip = (text: string) => { const t = playerText(text); return t.length > 60 ? `${t.slice(0, 58).trimEnd()}…` : t; };

/** The dialogue bar's current line, above its speaker: speech bubble, plus a thought cloud when thoughts are on. */
function Bubble({ name, line, showThoughts }: { name: string; line: DialogueLine; showThoughts: boolean }) {
  const thought = showThoughts && line.inner ? line.inner : '';
  if (!line.publicLine && !thought) return null;
  return <div className="o3-stack">
    {thought && <div className="o3-bubble thought"><small>{name} thinks</small><span>{clip(thought)}</span></div>}
    {line.publicLine && <div className="o3-bubble speech"><small>{name} says</small><span>{clip(line.publicLine)}</span></div>}
  </div>;
}

/** A conversation line in a speech bubble, optionally a beat after the other speaker. */
function ConvBubble({ name, text, delay, pinned = false }: { name: string; text: string; delay: number; pinned?: boolean }) {
  const [shown, setShown] = useState(delay <= 0);
  useEffect(() => { if (delay <= 0) return; setShown(false); const id = setTimeout(() => setShown(true), delay * 1000); return () => clearTimeout(id); }, [text, delay]);
  if (!shown) return null;
  return <div className="o3-stack"><div className={`o3-bubble speech${pinned ? ' announce' : ''}`}><small>{name} {pinned ? 'announces' : 'says'}</small><span>{pinned ? playerText(text) : clip(text)}</span></div></div>;
}

/** Activity follows current props only: lines that expire during entry are never queued for replay. */
export function AgentActivity({ visible, name, line, showThoughts, convLine, convDelay, pinned, tag, kind, emote }: {
  visible: boolean; name: string; line: DialogueLine | null; showThoughts: boolean;
  convLine: string | null; convDelay: number; pinned: boolean; tag: string | null; kind: Kind; emote?: Emote;
}) {
  if (!visible) return null;
  const overhead = line ? <Bubble name={name} line={line} showThoughts={showThoughts} />
    : convLine ? <ConvBubble name={name} text={convLine} delay={convDelay} pinned={pinned} />
    : tag ? <div className={`o3-tag ${kind}`}>{tag}</div> : null;
  return <>
    {overhead && <div className="o3-above">{overhead}</div>}
    {emote && <div className={`o3-emote ${emote.emotion} i${emote.intensity}`} aria-label={emote.emotion}>{EMOTE_ICON[emote.emotion]}</div>}
  </>;
}
