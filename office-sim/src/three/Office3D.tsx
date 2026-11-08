// 3D office scene, driven exclusively by the application's presented state.
import { useEffect, useMemo, useRef, useState, type ElementRef, type RefObject, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor, Stats } from '@react-three/drei';
import { DoubleSide, MeshBasicMaterial, MeshLambertMaterial, Vector3, type Group, type OrthographicCamera } from 'three';
import type { Person } from '../people';
import type { DialogueLine } from '../dialogueQueue';
import type { TickRecord } from '../../shared/types';
import type { TickEvent } from '../../shared/api';
import { Agent3D, type Behaviour, type Crowd, type Emote } from './Agent3D';
import { EMOTES, FOCUS_PRIORITY } from '../emotes';
import { DESK_OFFSET, FLOOR, SEAT_LIST, seatFor, type Seat } from './layout';
import { accessNode, buildNav, seatNode, type Nav } from './nav';
import { carBoxes, glass, glow, solid } from './world';
import { bake } from './voxel';
import { DayNight } from './DayNight';
import { walksIn } from './daylight';
import './office3d.css';

const TARGET: [number, number, number] = [0, 0, 1.5];
const AZIMUTH = 0.35, POLAR = 0.88, R = 80;
const CAMERA: [number, number, number] = [
  TARGET[0] + R * Math.sin(POLAR) * Math.sin(AZIMUTH), TARGET[1] + R * Math.cos(POLAR), TARGET[2] + R * Math.sin(POLAR) * Math.cos(AZIMUTH),
];

const solidMat = new MeshLambertMaterial({ vertexColors: true });
const glowMat = new MeshBasicMaterial({ vertexColors: true });
const glassMat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, side: DoubleSide });
const screenOn = new MeshBasicMaterial({ color: '#8fd3f5' });
const screenOff = new MeshBasicMaterial({ color: '#1c2028' });
const bulb = new MeshBasicMaterial({ color: '#ffe08a' });
const lampPool = new MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.35, depthWrite: false });

const name = (people: Person[], id: string) => people.find(p => p.id === id)?.name ?? id;

/** Dev only: `?preview=panic`, `?preview=ceo-quit` or `?preview=home-time` plays that animation 3 s after load, without engine data. */
const PREVIEW = import.meta.env.DEV ? new URLSearchParams(location.search).get('preview') : null;

/** Action -> where to go and what to show. Only reads the record; invents nothing. */
/** Staggered pack-up times (seconds at 1x) so people don't all rush out at once. */
const LEAVE_DELAYS = [0.4, 2.6, 1.2, 4.2, 0.8, 3.4, 5.2, 1.8];

/** Going home: pack up, every other person says goodbye at a colleague's desk who is staying, then out the door or to their car. */
function leaving(p: Person, i: number, people: Person[], nav: Nav, seats: Map<string, Seat>, car: number): Behaviour {
  const staying = people.filter(q => q.id !== p.id && !q.quit && q.present !== false);
  const friend = i % 2 === 0 && staying.length ? staying[i % staying.length] : null;
  let via: string | null = null, viaFace: number | null = null;
  if (friend) {
    via = accessNode(friend.id, friend.role === 'CEO');
    const [ax, az] = nav.pos.get(via)!, seat = seats.get(friend.id)!;
    viaFace = Math.atan2(seat.x - ax, seat.z - az);
  }
  return { goal: car >= 0 ? `car${car}` : 'exit', face: null, kind: 'leave', tag: car >= 0 ? 'driving home' : 'heading home',
    spread: null, delay: LEAVE_DELAYS[i % LEAVE_DELAYS.length], via, viaFace };
}

function behaviourFor(p: Person, rec: TickRecord | undefined, i: number, people: Person[], nav: Nav, seats: Map<string, Seat>, panic: boolean): Behaviour {
  const desk: Behaviour = { goal: seatNode(p.id), face: 0, kind: 'desk', tag: null, spread: null };
  if (p.quit) return { goal: 'exit', face: null, kind: 'quit', tag: p.action === 'Laid off' ? 'laid off' : p.role === 'CEO' ? 'CEO resigns' : 'resigned', spread: null };
  if (p.present === false) return { ...desk, kind: 'off-shift', tag: null };
  if (panic) return { goal: 'mC', face: null, kind: 'panic', tag: '!!', spread: null };
  if (!rec) return desk;
  const target = rec.target && rec.target !== p.id && seats.has(rec.target)
    && people.some(q => q.id === rec.target && !q.quit && q.present !== false) ? rec.target : null;
  // Visit: stand in the aisle behind the target's chair, facing them.
  const visit = (kind: Behaviour['kind'], tag: string): Behaviour => {
    const acc = accessNode(target!, people.find(q => q.id === target)?.role === 'CEO');
    const [ax, az] = nav.pos.get(acc)!, seat = seats.get(target!)!;
    return { goal: acc, face: Math.atan2(seat.x - ax, seat.z - az), kind, tag, spread: 'x' };
  };
  switch (rec.action) {
    case 'overwork': return { ...desk, kind: 'overwork', tag: 'overtime' };
    case 'slack_off': return i % 3 === 0
      ? { goal: 'cooler', face: Math.PI, kind: 'idle', tag: 'break', spread: 'x' }
      : { goal: i % 2 ? 'sofaA' : 'sofaB', face: 0, kind: 'sofa', tag: 'zzz', spread: null };
    case 'complain': return target ? visit('complain', `grr → ${name(people, target)}`) : { goal: 'coffee', face: Math.PI, kind: 'complain', tag: 'grr', spread: 'x' };
    case 'gossip': return target ? visit('gossip', `psst → ${name(people, target)}`) : { goal: 'meet', face: -Math.PI / 2, kind: 'gossip', tag: 'psst', spread: 'z' };
    case 'verify': return target ? visit('verify', `? ${name(people, target)}`) : { goal: 'coffee', face: Math.PI, kind: 'verify', tag: '?', spread: 'x' };
    case 'leak': return { goal: i % 2 ? 'winLounge' : 'winMeet', face: -Math.PI / 2, kind: 'leak', tag: '☎ press', spread: 'z' };
    case 'interview': return { goal: 'interview', face: 0, kind: 'interview', tag: 'interview', spread: 'x' };
    default: return desk;
  }
}

function World() {
  const geo = useMemo(() => ({ solid: bake(solid), glow: bake(glow), glass: bake(glass) }), []);
  return <>
    <mesh geometry={geo.solid} material={solidMat} castShadow receiveShadow />
    <mesh geometry={geo.glow} material={glowMat} />
    <mesh geometry={geo.glass} material={glassMat} />
  </>;
}

/** Fit the diorama to the viewport on load and resize. */
function FitZoom() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.zoom = Math.min(size.width / 35, size.height / 24);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

interface Cutscene { id: string; name: string; ending: boolean }
type Controls = ElementRef<typeof OrbitControls>;

/** What the camera is locked onto: the CEO cutscene or a followed agent. */
interface Focus { id: string; zoom: number; lowerThird: boolean; holdZoom: boolean; graceSeconds: number }

/** Focus camera: ease onto an agent and track them, then ease back to the player's view when released. */
function Director({ focus, crowd, controls, onLost }: {
  focus: Focus | null; crowd: Crowd; controls: RefObject<Controls>; onLost: () => void;
}) {
  const saved = useRef<{ zoom: number; target: Vector3; position: Vector3 } | null>(null);
  const started = useRef({ id: '', at: 0, zoomed: false });
  const goal = useMemo(() => new Vector3(), []);
  useFrame(({ clock }, delta) => {
    const c = controls.current;
    if (!c) return;
    const cam = c.object as OrthographicCamera;
    const ease = 1 - Math.exp(-Math.min(delta, 0.1) * 3);
    let zoomTo: number | null = null;
    if (focus) {
      if (!saved.current) saved.current = { zoom: cam.zoom, target: c.target.clone(), position: cam.position.clone() };
      if (started.current.id !== focus.id) started.current = { id: focus.id, at: clock.elapsedTime, zoomed: false };
      const star = crowd.get(focus.id);
      // Gone from the crowd (walked off the plot, or never there): release.
      if (!star) { if (clock.elapsedTime - started.current.at > focus.graceSeconds) onLost(); return; }
      // Lower third keeps the CEO clear of the headline.
      const az = c.getAzimuthalAngle(), lead = focus.lowerThird ? 2 : 0;
      goal.set(star.x - Math.sin(az) * lead, 1, star.z - Math.cos(az) * lead);
      const want = saved.current.zoom * focus.zoom;
      // Followers may scroll-zoom once the camera has arrived; the cutscene holds its framing.
      if (focus.holdZoom || !started.current.zoomed) zoomTo = want;
      if (Math.abs(cam.zoom - want) < 0.5) started.current.zoomed = true;
    } else if (saved.current) {
      goal.copy(saved.current.target);
      zoomTo = saved.current.zoom;
      if (c.target.distanceTo(goal) < 0.05 && Math.abs(cam.zoom - zoomTo) < 0.2) {
        cam.position.copy(saved.current.position); c.target.copy(goal); cam.zoom = zoomTo;
        cam.updateProjectionMatrix(); c.update(); saved.current = null; started.current.id = '';
        return;
      }
    } else return;
    // Move camera and target together so the viewing angle never changes.
    const shift = goal.clone().sub(c.target).multiplyScalar(ease);
    c.target.add(shift); cam.position.add(shift);
    if (zoomTo !== null) { cam.zoom += (zoomTo - cam.zoom) * ease; cam.updateProjectionMatrix(); }
    c.update();
  });
  return null;
}

/** The two parked cars: they wait for their driver, pull forward, turn left into the near (left-hand) lane and drive off east. */
const CARS = [{ x: 10.2, colour: '#e6e6e6' }, { x: 12.8, colour: '#cf4436' }];
const PARK_Z = 8.2, KERB_Z = 10.2, LANE_Z = 12.25, TURN = LANE_Z - KERB_Z, ROAD_END = 19, CAR_SPEED = 3.5;
interface CarState { owner: string | null; stage: 'parked' | 'waiting' | 'driving' | 'gone'; t: number; s: number }

/** Polyline for one car: straight out of the bay, a quarter-circle left turn, then along the lane. */
function carPath(x0: number) {
  const pts: Array<[number, number]> = [[x0, PARK_Z], [x0, KERB_Z]];
  for (let k = 1; k <= 12; k++) { const a = Math.PI - (k / 12) * (Math.PI / 2); pts.push([x0 + TURN + Math.cos(a) * TURN, KERB_Z + Math.sin(a) * TURN]); }
  pts.push([ROAD_END, LANE_Z]);
  const lengths = [0];
  for (let k = 1; k < pts.length; k++) lengths.push(lengths[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return { pts, lengths, total: lengths.at(-1)! };
}

function Cars({ cars, boarded, speed, paused }: { cars: CarState[]; boarded: Set<string>; speed: number; paused: boolean }) {
  const models = useMemo(() => CARS.map(c => { const b = carBoxes(c.colour); return { solid: bake(b.solid), glow: bake(b.glow), path: carPath(c.x) }; }), []);
  const groups = [useRef<Group>(null), useRef<Group>(null)];
  useFrame((_, delta) => {
    // Cars speed up with playback only to 2x, so the turn out of the bay stays readable.
    const dt = paused ? 0 : Math.min(delta, 0.1) * Math.min(speed, 2);
    cars.forEach((c, i) => {
      const g = groups[i].current;
      if (!g) return;
      if (!c.owner) { c.stage = 'parked'; c.s = 0; c.t = 0; }
      else if (c.stage === 'parked' && boarded.has(c.owner)) c.stage = 'waiting';
      // A short beat after the door shuts; only one car pulls out at a time.
      if (c.stage === 'waiting') { c.t += dt; if (c.t > 0.8 && cars[1 - i].stage !== 'driving') c.stage = 'driving'; }
      if (c.stage === 'driving') { c.s += dt * CAR_SPEED; if (c.s >= models[i].path.total) c.stage = 'gone'; }
      const { pts, lengths } = models[i].path;
      let k = 1;
      while (k < pts.length - 1 && lengths[k] < c.s) k++;
      const f = Math.min(1, Math.max(0, (c.s - lengths[k - 1]) / (lengths[k] - lengths[k - 1])));
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
      g.position.set(ax + (bx - ax) * f, 0, az + (bz - az) * f);
      g.rotation.y = Math.atan2(-(bz - az), bx - ax);
      g.visible = c.stage !== 'gone';
    });
  });
  return <>{models.map((m, i) => <group key={i} ref={groups[i]}>
    <mesh geometry={m.solid} material={solidMat} castShadow receiveShadow />
    <mesh geometry={m.glow} material={glowMat} />
  </group>)}</>;
}

export default function Office3D({ people: cast, tick, selected, onSelect, highlight, line = null, showThoughts = false, records = {}, speed = 1, announcement = null, panic = false, paused = false, showDebug = false, fallback, onSkipMeeting }: {
  people: Person[];
  /** The same presented simulation tick as the workday clock and employee presence. */
  tick: number;
  selected: string | null;
  onSelect: (id: string) => void;
  highlight: string[];
  /** The line the dialogue bar is showing: only its speaker gets a bubble. */
  line?: DialogueLine | null;
  showThoughts?: boolean;
  /** Latest TickRecord per agent: drives where they go. */
  records?: Record<string, TickRecord>;
  /** Playback speed: scales walking and animation only. */
  speed?: number;
  /** Part B: the CEO's official announcement in the presented hour, if any. */
  announcement?: TickEvent | null;
  paused?: boolean;
  /** The HUD's existing debug key controls development diagnostics, including FPS. */
  showDebug?: boolean;
  fallback?: ReactNode;
  /** Placeholder reaction to a catastrophic event: everyone still employed runs about flailing. */
  panic?: boolean;
  /** Skip the meeting cutscene now playing (its dialogue lines). */
  onSkipMeeting?: () => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [showHint, setShowHint] = useState(true);
  useEffect(() => { if (PREVIEW) { const id = setTimeout(() => setPreviewing(true), 3000); return () => clearTimeout(id); } }, []);
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(timer);
  }, []);
  // The CEO preview seats the CEO first (even if they already quit this run), then makes them resign.
  // Home-time preview: everyone in, then all but two (who stay late) go home.
  const people = useMemo(() => PREVIEW === 'ceo-quit' ? cast.map(p => p.role === 'CEO' ? { ...p, quit: previewing, present: true, action: previewing ? 'Resigned' : p.action } : p)
    : PREVIEW === 'home-time' ? cast.map((p, i) => p.quit ? p : { ...p, present: !previewing || i % 4 === 1, late: previewing && i % 4 === 1 }) : cast, [cast, previewing]);
  const panicking = panic || (previewing && PREVIEW === 'panic');
  const layoutKey = people.map(p => `${p.id}:${p.role}`).join();
  // One desk each, even if two people share an archetype.
  const seats = useMemo(() => {
    const taken = new Set<Seat>();
    return new Map(people.map((p, i) => {
      let seat = seatFor(p.role, i);
      if (taken.has(seat)) seat = SEAT_LIST.find(s => !taken.has(s)) ?? seat;
      taken.add(seat);
      return [p.id, seat];
    }));
  }, [layoutKey]);
  const crowd = useMemo<Crowd>(() => new Map(), []);
  // Going home: anyone seen in the office who is now marked as left walks out (absent on load: already gone).
  // The first two to leave each day take the parked cars; a car is back in its bay once its driver returns.
  const presence = useRef(new Map(people.map(p => [p.id, p.present !== false])));
  const previousTick = useRef(tick);
  const arriving = useRef(new Set<string>());
  const departing = useRef(new Set<string>());
  const cars = useRef<CarState[]>(CARS.map(() => ({ owner: null, stage: 'parked', t: 0, s: 0 })));
  const boarded = useMemo(() => new Set<string>(), []);
  for (const p of people) {
    if (!p.quit && walksIn(presence.current.get(p.id), p.present !== false, previousTick.current, tick)) arriving.current.add(p.id);
    if (p.present === false || p.quit) arriving.current.delete(p.id);
    if (presence.current.get(p.id) && p.present === false && !p.quit && !departing.current.has(p.id)) {
      departing.current.add(p.id);
      const free = cars.current.find(c => !c.owner && c.stage === 'parked');
      if (free && !cars.current.some(c => c.owner === p.id)) free.owner = p.id;
    }
    if (p.present !== false || p.quit) departing.current.delete(p.id);
  }
  for (const c of cars.current) {
    const owner = c.owner && people.find(p => p.id === c.owner);
    if (c.owner && (!owner || owner.present !== false)) { boarded.delete(c.owner); c.owner = null; }
  }
  useEffect(() => {
    for (const p of people) presence.current.set(p.id, p.present !== false);
    previousTick.current = tick;
  });
  // The CEO resigning mid-session (not already gone when the view loads) triggers the cutscene.
  const [cutscene, setCutscene] = useState<Cutscene | null>(null);
  const ceo = people.find(p => p.role === 'CEO');
  // OfficeView mounts only once the presentation baseline and cast are ready.
  const ceoWasQuit = useRef(ceo?.quit ?? true);
  useEffect(() => {
    if (!ceo) return;
    if (ceoWasQuit.current === false && ceo.quit && ceo.action === 'Resigned') setCutscene({ id: ceo.id, name: ceo.name, ending: false });
    ceoWasQuit.current = ceo.quit;
  }, [ceo?.id, ceo?.quit, ceo?.action]);
  const cutsceneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (cutsceneTimer.current) clearTimeout(cutsceneTimer.current); }, []);
  const endCutscene = () => {
    if (cutsceneTimer.current) return;
    setCutscene(c => c && { ...c, ending: true });
    cutsceneTimer.current = setTimeout(() => { setCutscene(null); cutsceneTimer.current = null; }, 1500);
  };
  // Follow mode works with both scene selection and Office wire selection.
  const [follow, setFollow] = useState<string | null>(null);
  useEffect(() => { if (selected) setFollow(selected); }, [selected]);
  // Meeting cutscene: driven by the dialogue bar's current line, so skipping or finishing the lines ends it.
  const meeting = !cutscene && line?.meeting ? line.meeting : null;
  const called = meeting ? people.find(p => p.id === meeting.agent) : undefined;
  useEffect(() => { if (cutscene || meeting) setFollow(null); }, [cutscene, meeting?.id]);
  useEffect(() => {
    if (!meeting || !onSkipMeeting) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSkipMeeting(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [meeting?.id, onSkipMeeting]);
  useEffect(() => {
    if (!follow) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFollow(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [follow]);
  const followed = people.find(p => p.id === follow);
  const focus: Focus | null = cutscene && !cutscene.ending
    ? { id: cutscene.id, zoom: 2.4, lowerThird: true, holdZoom: true, graceSeconds: 3 }
    : meeting ? { id: meeting.agent, zoom: 2.2, lowerThird: true, holdZoom: true, graceSeconds: 3 }
    : follow && !cutscene ? { id: follow, zoom: 2.2, lowerThird: false, holdZoom: false, graceSeconds: 1 } : null;
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  // Integrated GPUs: drop to 1x pixels if the frame rate falls.
  const [maxDpr, setMaxDpr] = useState(1.5);
  const zoom = (factor: number) => {
    const c = controls.current;
    if (!c) return;
    const cam = c.object as OrthographicCamera;
    cam.zoom = Math.min(140, Math.max(12, cam.zoom * factor));
    cam.updateProjectionMatrix();
    c.update();
  };
  // Part A focus system: full speech bubbles for at most two conversations from the latest hour
  // (the dialogue bar's speaker counts as one); everyone else shows only their emote.
  const latestTick = Math.max(0, ...Object.values(records).map(r => r.tick));
  const talk = EMOTES ? people.map(p => records[p.id]).filter((r): r is TickRecord => Boolean(r && r.tick === latestTick && r.conversation && r.public_line?.trim())) : [];
  const ranked = [...talk].sort((a, b) => Number(Boolean(b.quit)) - Number(Boolean(a.quit)) || FOCUS_PRIORITY[a.conversation!.kind] - FOCUS_PRIORITY[b.conversation!.kind]);
  // The CEO's announcement outranks every conversation and takes one of the two bubble slots.
  const focusConvs = [...new Set(ranked.map(r => r.conversation!.id))].slice(0, Math.max(0, 2 - (line?.kind === 'agent' ? 1 : 0) - (announcement ? 1 : 0)));
  const hearsCeo = (id: string) => Boolean(announcement && ceo && id !== ceo.id && announcement.first_hand?.includes(id));
  const focusSpeakers = talk.filter(r => focusConvs.includes(r.conversation!.id));
  // Partners face each other: the opener faces who they address, the addressee and the replier face the other.
  const faceTowards = new Map<string, string>();
  for (const r of talk) { faceTowards.set(r.agent, r.conversation!.with); if (!faceTowards.has(r.conversation!.with)) faceTowards.set(r.conversation!.with, r.agent); }
  const emoteFor = (p: Person): Emote | undefined => {
    const r = records[p.id];
    return EMOTES && r?.emotion && r.tick === latestTick && !p.quit && p.present !== false ? { emotion: r.emotion, intensity: r.intensity ?? 1, key: `${r.tick}:${r.emotion}`, conversation: r.conversation } : undefined;
  };
  const nav = useMemo(() => buildNav(people.map(p => ({ id: p.id, seat: seats.get(p.id)!, ceo: p.role === 'CEO' }))), [seats]);
  return <div className="o3-scene">
    <Canvas fallback={fallback} orthographic shadows flat dpr={[1, maxDpr]} camera={{ position: CAMERA, zoom: 30, near: 1, far: 300 }}
      onPointerMove={event => { if (event.buttons) setShowHint(false); }} onWheel={() => setShowHint(false)}>
      <PerformanceMonitor onDecline={() => setMaxDpr(1)} />
      <DayNight tick={tick} speed={speed} paused={paused} />
      <World />
      <Cars cars={cars.current} boarded={boarded} speed={speed} paused={paused} />
      {people.map((p, i) => {
        const seat = seats.get(p.id)!;
        const isLeaving = departing.current.has(p.id);
        const announcing = announcement && p.id === ceo?.id && !p.quit && p.present !== false;
        // Called in: the agent walks into the CEO's glass office; the boss waits there (the CEO at their own desk).
        const inMeeting = meeting && (p.id === meeting.agent || p.id === meeting.boss);
        const b = inMeeting ? { goal: p.id === meeting!.agent ? 'ceoA' : p.role === 'CEO' ? seatNode(p.id) : 'ceoB', face: null, kind: 'meeting' as const, tag: p.id === meeting!.agent ? 'called in' : null, spread: null }
          : announcing ? { goal: 'hall', face: 0.35, kind: 'announce' as const, tag: null, spread: null } : isLeaving ? leaving(p, i, people, nav, seats, cars.current.findIndex(c => c.owner === p.id))
          : behaviourFor(p, records[p.id], i, people, nav, seats, panicking);
        const dz = seat.z + DESK_OFFSET;
        return <group key={p.id}>
          <mesh position={[seat.x + 0.4, FLOOR + 1.08, dz + 0.035]} scale={[0.58, 0.32, 0.01]} material={p.quit || p.present === false ? screenOff : screenOn}>
            <boxGeometry />
          </mesh>
          {b.kind === 'overwork' && <>
            <mesh position={[seat.x + 0.85, FLOOR + 1.29, dz + 0.3]} scale={[0.28, 0.13, 0.28]} material={bulb}><boxGeometry /></mesh>
            <mesh position={[seat.x + 0.3, FLOOR + 0.81, dz]} rotation-x={-Math.PI / 2} scale={[1.5, 0.8, 1]} material={lampPool}><planeGeometry /></mesh>
          </>}
          <Agent3D key={`${p.id}:${p.present !== false || p.quit}:${arriving.current.has(p.id)}`} person={p} nav={nav} crowd={crowd} behaviour={b} phase={i} speed={speed} paused={paused} cinematic={cutscene?.id === p.id} departing={isLeaving} arriving={arriving.current.has(p.id)} onExit={() => boarded.add(p.id)}
            emote={emoteFor(p)} attend={hearsCeo(p.id)} faceTowards={hearsCeo(p.id) ? ceo!.id : EMOTES ? faceTowards.get(p.id) ?? null : null}
            convLine={announcing ? announcement!.text : focusSpeakers.find(r => r.agent === p.id)?.public_line ?? null}
            convDelay={(() => { const mine = focusSpeakers.find(r => r.agent === p.id); return mine?.conversation?.role === 'reply' && focusSpeakers.some(r => r.agent !== p.id && r.conversation?.id === mine.conversation?.id) ? 1.5 : 0; })()} selected={selected === p.id} highlighted={highlight.includes(p.id)}
            line={line?.kind === 'agent' && line.agent === p.id ? line : null} showThoughts={showThoughts} onSelect={id => { if (!p.quit && p.present !== false) setFollow(id); onSelect(id); }} />
        </group>;
      })}
      <OrbitControls ref={controls} makeDefault enabled={!cutscene && !meeting} target={TARGET} enablePan={false} minPolarAngle={0.6} maxPolarAngle={1.1}
        minAzimuthAngle={-0.8} maxAzimuthAngle={0.8} minZoom={12} maxZoom={140} />
      <FitZoom />
      <Director focus={focus} crowd={crowd} controls={controls} onLost={cutscene ? endCutscene : meeting ? () => {} : () => setFollow(null)} />
      {import.meta.env.DEV && showDebug && <Stats className="o3-stats" />}
    </Canvas>
    {cutscene && <div className={`o3-cutscene ${cutscene.ending ? 'out' : ''}`} role="status">
      <i className="bar top" /><i className="bar bottom" />
      <div className="o3-headline"><span>Breaking news</span><strong>CEO resigns</strong><em>{cutscene.name} walks out of the office</em></div>
    </div>}
    {meeting && <div className="o3-cutscene o3-meeting" role="status">
      <i className="bar top" /><i className="bar bottom" />
      <div className="o3-called"><span>Called in</span><strong>{called?.name ?? 'Employee'}</strong></div>
      {meeting.last && <div key={meeting.id} className={`o3-stamp ${meeting.stamp === 'Fired' ? 'fired' : ''}`}>{meeting.stamp}</div>}
      {onSkipMeeting && <button className="o3-skip" onClick={onSkipMeeting} aria-label="Skip meeting cutscene">Skip ⏭</button>}
    </div>}
    {followed && !cutscene && !meeting && <div className="o3-follow" role="status">
      <span><i />Following <b>{followed.name}</b></span>
      <button onClick={() => setFollow(null)} aria-label={`Stop following ${followed.name}`}>Exit ✕</button>
    </div>}
    <div className="o3-zoom">
      <button onClick={() => zoom(1.25)} aria-label="Zoom in">+</button>
      <button onClick={() => zoom(0.8)} aria-label="Zoom out">−</button>
    </div>
    <p className={`o3-hint ${showHint ? '' : 'dismissed'}`}>Drag to orbit · Scroll to zoom</p>
  </div>;
}
