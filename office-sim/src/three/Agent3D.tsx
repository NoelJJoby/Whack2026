import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Color, type Group } from 'three';
import type { Person } from '../people';
import type { DialogueLine } from '../dialogueQueue';
import { playerText } from '../hudModel';
import { FLOOR } from './layout';
import { PANIC_NODES, seatNode, type Nav } from './nav';
import { mat, unitBox } from './voxel';
import type { Emotion, TickRecord } from '../../shared/types';
import { EMOTES, EMOTE_ICON } from '../emotes';

const PANTS = '#2c3040', SHOES = '#1c1d22', EYES = '#241c22', SWEAT = '#d6f1ff', BOX = '#c08a4e';
const WALK = 2.6; // units per second at 1x
/** Seconds (at 1x) an agent stays put before taking their newest behaviour, so moves stay readable. */
const DWELL = 2;
const HIP_SIT = 0.55, HIP_STAND = 0.78;
const PANIC_RUN = 2.4; // panic speed multiplier
const PERSONAL = 0.75; // agents closer than this sidestep each other
const CEO_GESTURE = 3; // seconds the resigning CEO stands with a raised fist before walking out
const GOODBYE = 1.8; // seconds spent waving goodbye before heading out

/** Shared live positions so walkers can avoid each other. */
export type Crowd = Map<string, { x: number; z: number; phase: number; moving: boolean }>;

export type Kind = 'desk' | 'overwork' | 'sofa' | 'idle' | 'complain' | 'gossip' | 'verify' | 'leak' | 'interview' | 'quit' | 'panic' | 'off-shift' | 'leave' | 'announce';
/** Where an agent should be and what they do there, derived from their latest TickRecord. */
export interface Behaviour {
  goal: string;
  /** Facing (radians) once arrived; null keeps the walking direction. */
  face: number | null;
  kind: Kind;
  tag: string | null;
  /** Spread agents sharing a spot along this axis. */
  spread: 'x' | 'z' | null;
  /** Going home: seconds to keep packing up first, and an optional colleague's spot to say goodbye at. */
  delay?: number;
  via?: string | null;
  viaFace?: number | null;
}

/** Box positioned by its centre, using the shared unit geometry. */
function Part({ p, s, c }: { p: [number, number, number]; s: [number, number, number]; c: string }) {
  return <mesh geometry={unitBox} material={mat(c)} position={p} scale={s} castShadow />;
}

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

/** This agent's emotion this hour, from their latest record (server-validated). */
export interface Emote { emotion: Emotion; intensity: 1 | 2 | 3; key: string; conversation?: TickRecord['conversation'] }
const EMOTE_SECONDS = 2.5;

/** A conversation line in a speech bubble, optionally a beat after the other speaker. */
function ConvBubble({ name, text, delay, pinned = false }: { name: string; text: string; delay: number; pinned?: boolean }) {
  const [shown, setShown] = useState(delay <= 0);
  useEffect(() => { if (delay <= 0) return; setShown(false); const id = setTimeout(() => setShown(true), delay * 1000); return () => clearTimeout(id); }, [text, delay]);
  if (!shown) return null;
  return <div className="o3-stack"><div className={`o3-bubble speech${pinned ? ' announce' : ''}`}><small>{name} {pinned ? 'announces' : 'says'}</small><span>{pinned ? playerText(text) : clip(text)}</span></div></div>;
}

const lerpAngle = (a: number, b: number, t: number) => a + (Math.atan2(Math.sin(b - a), Math.cos(b - a))) * t;

export function Agent3D({ person, nav, crowd, behaviour: latest, phase, speed, paused = false, cinematic = false, departing = false, onExit, emote, convLine = null, convDelay = 0, faceTowards = null, attend = false, selected, highlighted, line, showThoughts, onSelect }: {
  person: Person; nav: Nav; crowd: Crowd; behaviour: Behaviour; phase: number; speed: number;
  paused?: boolean;
  /** Starring in the CEO-resigns cutscene: real-time pace and a raised-fist beat before walking out. */
  cinematic?: boolean;
  /** Went home while this view was open: walk out (or to their car) instead of vanishing. */
  departing?: boolean;
  onExit?: () => void;
  /** Part A: emotion icon and gesture; a focused conversation line; who to face while talking or listening. */
  emote?: Emote;
  convLine?: string | null;
  convDelay?: number;
  faceTowards?: string | null;
  /** Listening to the CEO: turn towards him even when seated. */
  attend?: boolean;
  selected: boolean; highlighted: boolean; line: DialogueLine | null; showThoughts: boolean; onSelect: (id: string) => void;
}) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const legs = [useRef<Group>(null), useRef<Group>(null)];
  const knees = [useRef<Group>(null), useRef<Group>(null)];
  const arms = [useRef<Group>(null), useRef<Group>(null)];
  const sweat = useRef<Group>(null);
  const head = useRef<Group>(null);
  // The emote pops in for a few seconds each time the emotion record changes.
  const [emoteShown, setEmoteShown] = useState(false);
  const emoteRef = useRef(emote);
  emoteRef.current = EMOTES ? emote : undefined;
  const emoteKey = EMOTES && emote && emote.emotion !== 'neutral' ? emote.key : null;
  useEffect(() => {
    if (!emoteKey) { setEmoteShown(false); return; }
    setEmoteShown(true); mv.current.emoteT = 0;
    const id = setTimeout(() => setEmoteShown(false), EMOTE_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [emoteKey]);
  // Already gone if they had quit (or gone home) before this view mounted; otherwise they walk out first.
  const offShift = person.present === false && !person.quit;
  const startsGone = person.quit || (offShift && !departing);
  const [gone, setGone] = useState(startsGone);
  const [leaveStage, setLeaveStage] = useState<'pack' | 'bye' | 'go'>('pack');
  const home = nav.pos.get(seatNode(person.id)) ?? [0, 0];
  const mv = useRef({ x: home[0], z: home[1], node: seatNode(person.id), queue: [] as string[], heading: 0, t: phase, gone: startsGone, dwell: 0, wait: 0, side: 0, hold: 0, held: false, goal: '', nav: null as Nav | null, leaveT: 0, byeT: 0, stage: 'pack', emoteT: 0 });
  // Ticks can outpace walking: finish the current move, then switch. Quitting and panic interrupt at once.
  const [behaviour, setBehaviour] = useState(latest);
  const key = (b: Behaviour) => `${b.goal}|${b.kind}|${b.tag}|${b.face}`;
  useEffect(() => {
    if (latest.kind === 'quit' || latest.kind === 'panic' || latest.kind === 'announce' || behaviour.kind === 'panic' || behaviour.kind === 'announce') setBehaviour(latest);
  }, [latest.kind]);
  useEffect(() => () => { crowd.delete(person.id); }, [crowd, person.id]);


  const k = behaviour.kind;
  const shirt = useMemo(() => k === 'overwork' ? `#${new Color(person.color).lerp(new Color('#d9483b'), 0.5).getHexString()}` : person.color, [k, person.color]);
  const inspect = () => {
    document.querySelector<HTMLButtonElement>(`[data-employee="${CSS.escape(person.id)}"]`)?.focus({ preventScroll: true });
    onSelect(person.id);
  };

  useFrame((_, delta) => {
    const m = mv.current, g = root.current;
    if (!g || m.gone || paused) return;
    const dt = Math.min(delta, 0.1) * (cinematic ? 1 : speed);
    // Going home: pack up for a staggered moment, wave goodbye (at a colleague's desk or our own), then leave.
    const leaving = k === 'leave';
    let target = behaviour.goal, packing = false, waving = false;
    if (leaving) {
      const atTarget = !m.queue.length;
      if (m.leaveT < (behaviour.delay ?? 0)) { m.leaveT += dt; target = seatNode(person.id); packing = true; }
      else if (m.byeT < (behaviour.via ? GOODBYE : GOODBYE / 2)) {
        target = behaviour.via ?? seatNode(person.id);
        if (atTarget && m.goal === target) { m.byeT += dt; waving = true; }
      }
      const stage = packing ? 'pack' : waving ? 'bye' : 'go';
      if (m.stage !== stage) { m.stage = stage; setLeaveStage(stage); }
    }
    // Re-route here rather than in an effect, so no frame ever sees a new goal with the old (empty) route.
    if (m.goal !== target || m.nav !== nav) {
      const start = m.queue[0] ?? m.node;
      const route = nav.route(start, target);
      m.queue = m.queue.length ? [start, ...route.slice(1)] : route.slice(1);
      m.goal = target; m.nav = nav;
    }
    if (k === 'quit' && cinematic && !m.held) { m.hold = CEO_GESTURE; m.held = true; }
    m.t += dt;
    const holding = m.hold > 0;
    if (holding) m.hold -= Math.min(delta, 0.1);
    const panic = k === 'panic';
    // Give way to anyone walking towards us (lower phase has priority, never for long), and sidestep when close.
    let side = 0, blocked = false;
    const hx = Math.sin(m.heading), hz = Math.cos(m.heading);
    for (const [id, o] of crowd) {
      if (id === person.id) continue;
      const ox = o.x - m.x, oz = o.z - m.z, d = Math.hypot(ox, oz);
      if (d >= PERSONAL || d < 1e-3) continue;
      const across = hz * ox - hx * oz;
      side -= Math.sign(across || (phase % 2 ? 1 : -1)) * (PERSONAL - d);
      if (m.queue.length && !panic && k !== 'quit' && o.moving && o.phase < phase && ox * hx + oz * hz > 0.2 && d < 0.6) blocked = true;
    }
    m.wait = blocked ? m.wait + dt : 0;
    const step = holding || (blocked && m.wait < 1.2) ? 0 : dt * WALK * (panic ? PANIC_RUN : 1);
    if (m.queue.length) {
      const id = m.queue[0];
      const [px, pz] = nav.pos.get(id)!;
      // Agents sharing a destination stand side by side.
      const spread = leaving ? (target === behaviour.via ? 'x' : null) : behaviour.spread;
      const off = m.queue.length === 1 && spread ? ((phase % 3) - 1) * 0.5 : 0;
      const tx = px + (spread === 'x' ? off : 0), tz = pz + (spread === 'z' ? off : 0);
      const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
      if (d <= step) { m.x = tx; m.z = tz; m.node = id; m.queue.shift(); }
      else { m.x += (dx / d) * step; m.z += (dz / d) * step; m.heading = Math.atan2(dx, dz); }
    }
    let arrived = !m.queue.length;
    if (arrived && (k === 'quit' || (leaving && m.goal === behaviour.goal))) {
      m.gone = true; crowd.delete(person.id); setGone(true); if (leaving) onExit?.(); return;
    }
    // Panic: keep running to random open-floor spots.
    if (arrived && panic) {
      const next = PANIC_NODES[Math.floor(Math.random() * PANIC_NODES.length)];
      m.queue = nav.route(m.node, next).slice(1);
      arrived = !m.queue.length;
    }
    m.dwell = arrived ? m.dwell + dt : 0;
    if (arrived && m.dwell > DWELL && key(latest) !== key(behaviour)) { m.dwell = 0; setBehaviour(latest); }
    const walking = !arrived && !holding;
    const sitting = arrived && (k === 'desk' || k === 'overwork' || k === 'sofa' || packing);
    crowd.set(person.id, { x: m.x, z: m.z, phase, moving: walking });
    // Sidestep only while walking (drawn offset; the logical path stays on the waypoint graph).
    m.side += ((walking ? Math.max(-0.35, Math.min(0.35, side)) : 0) - m.side) * Math.min(1, dt * 6);
    g.position.set(m.x + hz * m.side, FLOOR, m.z - hx * m.side);
    // The resigning CEO turns to face the camera for their moment.
    // Talking or listening: turn to face the other person.
    const partner = faceTowards && arrived && (!sitting || attend) ? crowd.get(faceTowards) : undefined;
    const facing = holding ? 0.35 : waving ? (behaviour.via ? behaviour.viaFace ?? m.heading : 0.35)
      : packing ? 0 : partner ? Math.atan2(partner.x - m.x, partner.z - m.z) : arrived && behaviour.face !== null ? behaviour.face : m.heading;
    g.rotation.y = lerpAngle(g.rotation.y, facing, Math.min(1, dt * 10));

    const t = m.t, swing = Math.sin(t * (panic ? 16 : 9));
    if (body.current) body.current.position.y = (sitting ? HIP_SIT : HIP_STAND) + (walking ? Math.abs(swing) * (panic ? 0.1 : 0.04) : Math.sin(t * 2) * 0.008);
    legs.forEach((ref, i) => {
      const s = i ? -swing : swing;
      if (ref.current) ref.current.rotation.x = sitting ? -Math.PI / 2 : walking ? s * (panic ? 0.9 : 0.6) : 0;
      if (knees[i].current) knees[i].current!.rotation.x = sitting ? Math.PI / 2 : walking ? Math.max(0, -s) * 0.7 : 0;
    });
    const typing = (rate: number, i: number) => -1.15 + Math.sin(t * rate + i * 1.6) * 0.08;
    arms.forEach((ref, i) => {
      if (!ref.current) return;
      let a = Math.sin(t * 1.5 + i) * 0.05, out = 0;
      if (waving) { a = i ? -2.9 : 0; out = i ? 0.25 + Math.sin(t * 12) * 0.35 : 0; }
      else if (packing) a = typing(8, i);
      else if (holding) { a = i ? -3.0 + Math.sin(t * 12) * 0.22 : 0.1; out = i ? 0.15 : 0; }
      else if (panic) { a = -2.6 + Math.sin(t * 20 + i * Math.PI) * 0.8; out = 0.5 + Math.sin(t * 15 + i) * 0.3; }
      else if (k === 'quit') a = -1.2;
      else if (walking) a = (i ? swing : -swing) * 0.6;
      else if (k === 'desk') a = typing(14, i);
      else if (k === 'overwork') a = typing(26, i);
      else if (k === 'sofa') a = -0.4;
      else if (k === 'leak') a = i ? -2.7 : 0;
      else if (k === 'gossip') a = i ? -2.3 : 0.1;
      // Complaining: with emotes on, the emotion decides the gesture (no unconditional flail).
      else if (k === 'complain') { if (EMOTES) a = -0.55; else { a = -2.8 + Math.sin(t * 12 + i * Math.PI) * 0.25; out = 0.35; } }
      else if (k === 'verify') a = i ? -1.5 : 0;
      else if (k === 'announce') { a = i ? -1.9 + Math.sin(t * 3) * 0.25 : -0.3; out = i ? 0.35 : 0; } // addressing the floor
      ref.current.rotation.x = a;
      ref.current.rotation.z = i ? out : -out;
    });
    // Part A: one gesture per emotion, scaled by intensity, while standing still (or upper body when seated).
    const e = emoteRef.current;
    m.emoteT += dt;
    const free = arrived && !holding && !panic && !waving && !packing && k !== 'quit' && k !== 'leave';
    const hd = head.current, bd = body.current;
    if (hd) hd.rotation.set(0, 0, 0);
    if (bd) bd.rotation.x = 0;
    if (e && free && e.emotion !== 'neutral') {
      const n = e.intensity, conv = e.conversation?.kind;
      const set = (i: number, a: number, out: number) => { const r = arms[i].current; if (r) { r.rotation.x = a; r.rotation.z = i ? out : -out; } };
      const armsFree = !sitting;
      switch (e.emotion) {
        case 'angry':
          if (bd && !sitting) bd.position.y += Math.abs(Math.sin(t * 7)) * 0.03 * n; // stomp
          // Big flailing only at full intensity in a confrontation; otherwise clenched fists.
          if (armsFree) for (const i of [0, 1]) n === 3 && conv === 'confrontation' ? set(i, -2.8 + Math.sin(t * 12 + i * Math.PI) * 0.25, 0.35) : set(i, -0.55, -0.12);
          break;
        case 'frustrated':
          if (armsFree) { set(0, -0.25, 0.8); set(1, -0.25, 0.8); } // hands on hips
          if (hd) hd.rotation.y = Math.sin(t * 6) * 0.12 * n; // head shake
          break;
        case 'skeptical':
          if (armsFree) { set(0, -1.45, -0.4); set(1, -1.45, -0.4); } // arms crossed
          if (hd) hd.rotation.z = 0.18;
          break;
        case 'stressed':
          if (bd) bd.rotation.x = 0.06 * n; // slump
          if (sitting) for (const i of [0, 1]) set(i, typing(28, i), 0);
          break;
        case 'anxious':
          g.position.x += Math.sin(t * 23) * 0.012 * n; // fidget
          break;
        case 'happy':
          if (bd) bd.position.y += Math.abs(Math.sin(t * 5)) * 0.03 * n;
          break;
        case 'excited':
          if (bd && !sitting) bd.position.y += Math.max(0, Math.sin(t * 5)) * 0.08 * n;
          if (armsFree) { set(0, -2.6, 0.3); set(1, -2.6, 0.3); }
          break;
        case 'surprised': {
          const p = Math.min(1, m.emoteT / 0.6);
          if (bd && !sitting && p < 1) bd.position.y += Math.sin(p * Math.PI) * 0.12 * n; // hop back
          if (p < 1 && !sitting) { g.position.x -= Math.sin(g.rotation.y) * 0.15 * p; g.position.z -= Math.cos(g.rotation.y) * 0.15 * p; }
          break;
        }
        case 'sad':
          if (hd) hd.rotation.x = 0.35;
          if (armsFree) { set(0, 0.05, 0); set(1, 0.05, 0); }
          break;
      }
      // Venting: lean in and nod along.
      if (conv === 'venting') { if (bd) bd.rotation.x = 0.1; if (hd) hd.rotation.x = Math.sin(t * 7) * 0.15; }
    } else if (faceTowards && free && hd) hd.rotation.x = Math.sin(t * 5) * 0.08; // listener nods
    if (sweat.current) {
      sweat.current.visible = k === 'overwork' && sitting;
      sweat.current.children.forEach((drop, i) => { drop.position.y = 1.75 - ((t * 0.9 + i * 0.5) % 1) * 0.5; });
    }
  });

  // The bubble or action tag rides in the label's own overlay, pinned just above the name in screen
  // space, so it never covers the name at any zoom or font size.
  const tag = k === 'leave' ? (leaveStage === 'bye' ? 'bye!' : leaveStage === 'pack' ? 'packing up' : behaviour.tag) : behaviour.tag;
  const overhead = gone ? null : line ? <Bubble name={person.name} line={line} showThoughts={showThoughts} />
    : convLine ? <ConvBubble name={person.name} text={convLine} delay={convDelay} pinned={k === 'announce'} />
    : tag ? <div className={`o3-tag ${k}`}>{tag}</div> : null;
  const label = <Html position={[0, gone ? 0.65 : 1.85, 0]} center zIndexRange={[4, 0]} className="o3-person-anchor">
    <div className="o3-overhead">
      {overhead && <div className="o3-above">{overhead}</div>}
      {!gone && emoteShown && emote && <div className={`o3-emote ${emote.emotion} i${emote.intensity}`} aria-label={emote.emotion}>{EMOTE_ICON[emote.emotion]}</div>}
      <button className={`o3-person ${offShift || gone ? 'off-shift' : ''}`} data-employee={person.id}
        aria-label={`Inspect ${person.name}`} aria-haspopup="dialog" aria-expanded={selected} onClick={event => { event.stopPropagation(); inspect(); }}>
        {person.name}{(person.quit || (offShift && gone) || person.late) && <small className={!person.quit && offShift ? 'o3-presence' : undefined}>{person.quit ? person.action : offShift ? 'Left for the day' : 'Working late'}</small>}
      </button>
    </div>
  </Html>;
  // Keyed so React doesn't reuse the walking group (which was moved off to the exit or car) for the desk label.
  if (gone) return <group key="gone" position={[home[0], FLOOR, home[1]]}>{label}</group>;
  const ring = selected ? '#d7b66c' : highlighted ? '#fff2cf' : line ? '#8abca2' : null;
  return <group ref={root} position={[home[0], FLOOR, home[1]]}
    onClick={e => { e.stopPropagation(); inspect(); }}
    onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { document.body.style.cursor = ''; }}>
    {ring && <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0.15]}><ringGeometry args={[0.55, 0.72, 24]} /><meshBasicMaterial color={ring} /></mesh>}
    {/* Floor rings hide behind desks, so highlighted/selected agents also get a marker overhead. */}
    {(selected || highlighted) && <mesh position={[0, 2.3, 0]} scale={[1, 1.4, 1]}><octahedronGeometry args={[0.2]} /><meshBasicMaterial color={ring!} /></mesh>}
    {label}
    <group ref={body} position={[0, HIP_SIT, 0]}>
      {/* Legs hang from the hip; knees bend for sitting and walking. */}
      {[-0.12, 0.12].map((x, i) => <group key={x} ref={legs[i]} position={[x, 0, 0]}>
        <Part p={[0, -0.16, 0]} s={[0.2, 0.32, 0.2]} c={PANTS} />
        <group ref={knees[i]} position={[0, -0.32, 0]}>
          <Part p={[0, -0.19, 0]} s={[0.2, 0.38, 0.2]} c={PANTS} />
          <Part p={[0, -0.4, 0.05]} s={[0.22, 0.08, 0.3]} c={SHOES} />
        </group>
      </group>)}
      <Part p={[0, 0.3, 0]} s={[0.52, 0.6, 0.32]} c={shirt} />
      {[-0.34, 0.34].map((x, i) =>
        <group key={x} ref={arms[i] as RefObject<Group>} position={[x, 0.52, 0]}>
          <Part p={[0, -0.2, 0]} s={[0.15, 0.42, 0.17]} c={shirt} />
          <Part p={[0, -0.45, 0]} s={[0.13, 0.1, 0.15]} c={person.skin} />
          {i === 1 && k === 'leak' && <Part p={[0, -0.5, 0.1]} s={[0.08, 0.22, 0.04]} c="#15171c" />}
        </group>)}
      {k === 'quit' && (person.role === 'CEO'
        ? <><Part p={[0, 0.15, 0.36]} s={[0.6, 0.42, 0.16]} c="#3b2a20" /><Part p={[0, 0.4, 0.36]} s={[0.2, 0.08, 0.06]} c="#d7b66c" /></>
        : <><Part p={[0, 0.2, 0.42]} s={[0.55, 0.36, 0.42]} c={BOX} /><Part p={[0.05, 0.4, 0.42]} s={[0.14, 0.08, 0.1]} c="#5f9e45" /></>)}
      <group ref={head} position={[0, 0.88, 0]}>
        <Part p={[0, 0, 0]} s={[0.5, 0.5, 0.46]} c={person.skin} />
        <Part p={[0, 0.28, -0.02]} s={[0.54, 0.12, 0.52]} c={person.hair} />
        <Part p={[0, 0.06, -0.22]} s={[0.54, 0.4, 0.1]} c={person.hair} />
        <Part p={[-0.1, 0.02, 0.235]} s={[0.08, 0.08, 0.02]} c={EYES} />
        <Part p={[0.1, 0.02, 0.235]} s={[0.08, 0.08, 0.02]} c={EYES} />
      </group>
    </group>
    <group ref={sweat} visible={false}>
      <Part p={[-0.34, 1.7, 0.15]} s={[0.09, 0.14, 0.09]} c={SWEAT} />
      <Part p={[0.36, 1.7, 0.1]} s={[0.09, 0.14, 0.09]} c={SWEAT} />
    </group>
  </group>;
}
