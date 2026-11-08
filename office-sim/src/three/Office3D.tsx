// 3D office scene, driven exclusively by the application's presented state.
import { useEffect, useMemo, useRef, useState, type ElementRef, type RefObject, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor, Stats } from '@react-three/drei';
import { DoubleSide, MeshBasicMaterial, MeshLambertMaterial, Vector3, type OrthographicCamera } from 'three';
import type { Person } from '../people';
import type { DialogueLine } from '../dialogueQueue';
import type { TickRecord } from '../../shared/types';
import { Agent3D, type Behaviour, type Crowd } from './Agent3D';
import { DESK_OFFSET, FLOOR, SEAT_LIST, seatFor, type Seat } from './layout';
import { accessNode, buildNav, seatNode, type Nav } from './nav';
import { glass, glow, solid } from './world';
import { bake } from './voxel';
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

/** Dev only: `?preview=panic` or `?preview=ceo-quit` plays that animation 3 s after load, without engine data. */
const PREVIEW = import.meta.env.DEV ? new URLSearchParams(location.search).get('preview') : null;

/** Action -> where to go and what to show. Only reads the record; invents nothing. */
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

export default function Office3D({ people: cast, selected, onSelect, highlight, line = null, showThoughts = false, records = {}, speed = 1, panic = false, paused = false, fallback }: {
  people: Person[];
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
  paused?: boolean;
  fallback?: ReactNode;
  /** Placeholder reaction to a catastrophic event: everyone still employed runs about flailing. */
  panic?: boolean;
}) {
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => { if (PREVIEW) { const id = setTimeout(() => setPreviewing(true), 3000); return () => clearTimeout(id); } }, []);
  // The CEO preview seats the CEO first (even if they already quit this run), then makes them resign.
  const people = useMemo(() => PREVIEW === 'ceo-quit' ? cast.map(p => p.role === 'CEO' ? { ...p, quit: previewing, present: true, action: previewing ? 'Resigned' : p.action } : p) : cast, [cast, previewing]);
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
  useEffect(() => { if (cutscene) setFollow(null); }, [cutscene]);
  useEffect(() => {
    if (!follow) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFollow(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [follow]);
  const followed = people.find(p => p.id === follow);
  const focus: Focus | null = cutscene && !cutscene.ending
    ? { id: cutscene.id, zoom: 2.4, lowerThird: true, holdZoom: true, graceSeconds: 3 }
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
  const nav = useMemo(() => buildNav(people.map(p => ({ id: p.id, seat: seats.get(p.id)!, ceo: p.role === 'CEO' }))), [seats]);
  return <div className="o3-scene">
    <Canvas fallback={fallback} orthographic shadows flat dpr={[1, maxDpr]} camera={{ position: CAMERA, zoom: 30, near: 1, far: 300 }}>
      <color attach="background" args={['#14203a']} />
      <PerformanceMonitor onDecline={() => setMaxDpr(1)} />
      <hemisphereLight args={['#c9d6ff', '#6b4a2a', 1.4]} />
      <directionalLight position={[-14, 26, 16]} color="#ffe0b0" intensity={2.4} castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22} shadow-camera-far={90} />
      <World />
      {people.map((p, i) => {
        const seat = seats.get(p.id)!;
        const b = behaviourFor(p, records[p.id], i, people, nav, seats, panicking);
        const dz = seat.z + DESK_OFFSET;
        return <group key={p.id}>
          <mesh position={[seat.x + 0.4, FLOOR + 1.08, dz + 0.035]} scale={[0.58, 0.32, 0.01]} material={p.quit || p.present === false ? screenOff : screenOn}>
            <boxGeometry />
          </mesh>
          {b.kind === 'overwork' && <>
            <mesh position={[seat.x + 0.85, FLOOR + 1.29, dz + 0.3]} scale={[0.28, 0.13, 0.28]} material={bulb}><boxGeometry /></mesh>
            <mesh position={[seat.x + 0.3, FLOOR + 0.81, dz]} rotation-x={-Math.PI / 2} scale={[1.5, 0.8, 1]} material={lampPool}><planeGeometry /></mesh>
          </>}
          <Agent3D key={`${p.id}:${p.present !== false || p.quit}`} person={p} nav={nav} crowd={crowd} behaviour={b} phase={i} speed={speed} paused={paused} cinematic={cutscene?.id === p.id} selected={selected === p.id} highlighted={highlight.includes(p.id)}
            line={line?.kind === 'agent' && line.agent === p.id ? line : null} showThoughts={showThoughts} onSelect={id => { if (!p.quit && p.present !== false) setFollow(id); onSelect(id); }} />
        </group>;
      })}
      <OrbitControls ref={controls} makeDefault enabled={!cutscene} target={TARGET} enablePan={false} minPolarAngle={0.6} maxPolarAngle={1.1}
        minAzimuthAngle={-0.8} maxAzimuthAngle={0.8} minZoom={12} maxZoom={140} />
      <FitZoom />
      <Director focus={focus} crowd={crowd} controls={controls} onLost={cutscene ? endCutscene : () => setFollow(null)} />
      {import.meta.env.DEV && <Stats className="o3-stats" />}
    </Canvas>
    {cutscene && <div className={`o3-cutscene ${cutscene.ending ? 'out' : ''}`} role="status">
      <i className="bar top" /><i className="bar bottom" />
      <div className="o3-headline"><span>Breaking news</span><strong>CEO resigns</strong><em>{cutscene.name} walks out of the office</em></div>
    </div>}
    {followed && !cutscene && <div className="o3-follow" role="status">
      <span><i />Following <b>{followed.name}</b></span>
      <button onClick={() => setFollow(null)} aria-label={`Stop following ${followed.name}`}>Exit ✕</button>
    </div>}
    <div className="o3-zoom">
      <button onClick={() => zoom(1.25)} aria-label="Zoom in">+</button>
      <button onClick={() => zoom(0.8)} aria-label="Zoom out">−</button>
    </div>
    <p className="o3-hint">Drag to orbit · Scroll to zoom</p>
  </div>;
}
