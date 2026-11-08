import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Color, type Group } from 'three';
import type { Person } from '../design/Office';
import type { DialogueLine } from '../dialogueQueue';
import { playerText } from '../hudModel';
import { FLOOR } from './layout';
import { PANIC_NODES, seatNode, type Nav } from './nav';
import { mat, unitBox } from './voxel';

const PANTS = '#2c3040', SHOES = '#1c1d22', EYES = '#241c22', SWEAT = '#d6f1ff', BOX = '#c08a4e';
const WALK = 2.6; // units per second at 1x
/** Seconds (at 1x) an agent stays put before taking their newest behaviour, so moves stay readable. */
const DWELL = 2;
const HIP_SIT = 0.55, HIP_STAND = 0.78;
const PANIC_RUN = 2.4; // panic speed multiplier
const PERSONAL = 0.75; // agents closer than this sidestep each other
const CEO_GESTURE = 3; // seconds the resigning CEO stands with a raised fist before walking out

/** Shared live positions so walkers can avoid each other. */
export type Crowd = Map<string, { x: number; z: number; phase: number; moving: boolean }>;

export type Kind = 'desk' | 'overwork' | 'sofa' | 'idle' | 'complain' | 'gossip' | 'verify' | 'leak' | 'interview' | 'quit' | 'panic';
/** Where an agent should be and what they do there, derived from their latest TickRecord. */
export interface Behaviour {
  goal: string;
  /** Facing (radians) once arrived; null keeps the walking direction. */
  face: number | null;
  kind: Kind;
  tag: string | null;
  /** Spread agents sharing a spot along this axis. */
  spread: 'x' | 'z' | null;
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
  return <Html position={[0, 2.15, 0]} zIndexRange={[4, 0]} className="o3-anchor">
    <div className="o3-stack">
      {thought && <div className="o3-bubble thought"><small>{name} thinks</small><span>{clip(thought)}</span></div>}
      {line.publicLine && <div className="o3-bubble speech"><small>{name} says</small><span>{clip(line.publicLine)}</span></div>}
    </div>
  </Html>;
}

const lerpAngle = (a: number, b: number, t: number) => a + (Math.atan2(Math.sin(b - a), Math.cos(b - a))) * t;

export function Agent3D({ person, nav, crowd, behaviour: latest, phase, speed, cinematic = false, selected, highlighted, line, showThoughts, onSelect }: {
  person: Person; nav: Nav; crowd: Crowd; behaviour: Behaviour; phase: number; speed: number;
  /** Starring in the CEO-resigns cutscene: real-time pace and a raised-fist beat before walking out. */
  cinematic?: boolean;
  selected: boolean; highlighted: boolean; line: DialogueLine | null; showThoughts: boolean; onSelect: (id: string) => void;
}) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const legs = [useRef<Group>(null), useRef<Group>(null)];
  const knees = [useRef<Group>(null), useRef<Group>(null)];
  const arms = [useRef<Group>(null), useRef<Group>(null)];
  const sweat = useRef<Group>(null);
  // Already gone if they had quit before this view mounted; otherwise they walk out first.
  const [gone, setGone] = useState(person.quit);
  const home = nav.pos.get(seatNode(person.id)) ?? [0, 0];
  const mv = useRef({ x: home[0], z: home[1], node: seatNode(person.id), queue: [] as string[], heading: 0, t: phase, gone: person.quit, dwell: 0, wait: 0, side: 0, hold: 0, held: false, goal: '', nav: null as Nav | null });
  // Ticks can outpace walking: finish the current move, then switch. Quitting and panic interrupt at once.
  const [behaviour, setBehaviour] = useState(latest);
  const key = (b: Behaviour) => `${b.goal}|${b.kind}|${b.tag}|${b.face}`;
  useEffect(() => {
    if (latest.kind === 'quit' || latest.kind === 'panic' || behaviour.kind === 'panic') setBehaviour(latest);
  }, [latest.kind]);
  useEffect(() => () => { crowd.delete(person.id); }, [crowd, person.id]);


  const k = behaviour.kind;
  const shirt = useMemo(() => k === 'overwork' ? `#${new Color(person.color).lerp(new Color('#d9483b'), 0.5).getHexString()}` : person.color, [k, person.color]);

  useFrame((_, delta) => {
    const m = mv.current, g = root.current;
    if (!g || m.gone) return;
    // Re-route here rather than in an effect, so no frame ever sees a new goal with the old (empty) route.
    if (m.goal !== behaviour.goal || m.nav !== nav) {
      const start = m.queue[0] ?? m.node;
      const route = nav.route(start, behaviour.goal);
      m.queue = m.queue.length ? [start, ...route.slice(1)] : route.slice(1);
      m.goal = behaviour.goal; m.nav = nav;
    }
    if (k === 'quit' && cinematic && !m.held) { m.hold = CEO_GESTURE; m.held = true; }
    const dt = Math.min(delta, 0.1) * (cinematic ? 1 : speed);
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
      const off = m.queue.length === 1 && behaviour.spread ? ((phase % 3) - 1) * 0.5 : 0;
      const tx = px + (behaviour.spread === 'x' ? off : 0), tz = pz + (behaviour.spread === 'z' ? off : 0);
      const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
      if (d <= step) { m.x = tx; m.z = tz; m.node = id; m.queue.shift(); }
      else { m.x += (dx / d) * step; m.z += (dz / d) * step; m.heading = Math.atan2(dx, dz); }
    }
    let arrived = !m.queue.length;
    if (arrived && k === 'quit') { m.gone = true; crowd.delete(person.id); setGone(true); return; }
    // Panic: keep running to random open-floor spots.
    if (arrived && panic) {
      const next = PANIC_NODES[Math.floor(Math.random() * PANIC_NODES.length)];
      m.queue = nav.route(m.node, next).slice(1);
      arrived = !m.queue.length;
    }
    m.dwell = arrived ? m.dwell + dt : 0;
    if (arrived && m.dwell > DWELL && key(latest) !== key(behaviour)) { m.dwell = 0; setBehaviour(latest); }
    const walking = !arrived && !holding;
    const sitting = arrived && (k === 'desk' || k === 'overwork' || k === 'sofa');
    crowd.set(person.id, { x: m.x, z: m.z, phase, moving: walking });
    // Sidestep only while walking (drawn offset; the logical path stays on the waypoint graph).
    m.side += ((walking ? Math.max(-0.35, Math.min(0.35, side)) : 0) - m.side) * Math.min(1, dt * 6);
    g.position.set(m.x + hz * m.side, FLOOR, m.z - hx * m.side);
    // The resigning CEO turns to face the camera for their moment.
    const facing = holding ? 0.35 : arrived && behaviour.face !== null ? behaviour.face : m.heading;
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
      if (holding) { a = i ? -3.0 + Math.sin(t * 12) * 0.22 : 0.1; out = i ? 0.15 : 0; }
      else if (panic) { a = -2.6 + Math.sin(t * 20 + i * Math.PI) * 0.8; out = 0.5 + Math.sin(t * 15 + i) * 0.3; }
      else if (k === 'quit') a = -1.2;
      else if (walking) a = (i ? swing : -swing) * 0.6;
      else if (k === 'desk') a = typing(14, i);
      else if (k === 'overwork') a = typing(26, i);
      else if (k === 'sofa') a = -0.4;
      else if (k === 'leak') a = i ? -2.7 : 0;
      else if (k === 'gossip') a = i ? -2.3 : 0.1;
      // Exasperated: both arms up in a V, shaking (not in front, so it can't read as typing).
      else if (k === 'complain') { a = -2.8 + Math.sin(t * 12 + i * Math.PI) * 0.25; out = 0.35; }
      else if (k === 'verify') a = i ? -1.5 : 0;
      ref.current.rotation.x = a;
      ref.current.rotation.z = i ? out : -out;
    });
    if (sweat.current) {
      sweat.current.visible = k === 'overwork' && sitting;
      sweat.current.children.forEach((drop, i) => { drop.position.y = 1.75 - ((t * 0.9 + i * 0.5) % 1) * 0.5; });
    }
  });

  if (gone) return null;
  const ring = selected ? '#d7b66c' : highlighted ? '#fff2cf' : line ? '#8abca2' : null;
  return <group ref={root} position={[home[0], FLOOR, home[1]]}
    onClick={e => { e.stopPropagation(); onSelect(person.id); }}
    onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { document.body.style.cursor = ''; }}>
    {ring && <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0.15]}><ringGeometry args={[0.55, 0.72, 24]} /><meshBasicMaterial color={ring} /></mesh>}
    {/* Floor rings hide behind desks, so highlighted/selected agents also get a marker overhead. */}
    {(selected || highlighted) && <mesh position={[0, 2.3, 0]} scale={[1, 1.4, 1]}><octahedronGeometry args={[0.2]} /><meshBasicMaterial color={ring!} /></mesh>}
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
      <Part p={[0, 0.88, 0]} s={[0.5, 0.5, 0.46]} c={person.skin} />
      <Part p={[0, 1.16, -0.02]} s={[0.54, 0.12, 0.52]} c={person.hair} />
      <Part p={[0, 0.94, -0.22]} s={[0.54, 0.4, 0.1]} c={person.hair} />
      <Part p={[-0.1, 0.9, 0.235]} s={[0.08, 0.08, 0.02]} c={EYES} />
      <Part p={[0.1, 0.9, 0.235]} s={[0.08, 0.08, 0.02]} c={EYES} />
    </group>
    <group ref={sweat} visible={false}>
      <Part p={[-0.34, 1.7, 0.15]} s={[0.09, 0.14, 0.09]} c={SWEAT} />
      <Part p={[0.36, 1.7, 0.1]} s={[0.09, 0.14, 0.09]} c={SWEAT} />
    </group>
    {line ? <Bubble name={person.name} line={line} showThoughts={showThoughts} />
      : behaviour.tag && <Html position={[0, 2.05, 0]} zIndexRange={[4, 0]} className="o3-anchor">
        <div className={`o3-tag ${k}`}>{behaviour.tag}</div>
      </Html>}
  </group>;
}
