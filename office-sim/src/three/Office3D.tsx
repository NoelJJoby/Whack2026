// 3D isometric voxel office (VITE_VIEW=3d). Same props as the 2D <Office>; renders only what it is given.
import { useEffect, useMemo, useRef, useState, type ElementRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor, Stats } from '@react-three/drei';
import { DoubleSide, MeshBasicMaterial, MeshLambertMaterial, type OrthographicCamera } from 'three';
import type { Person } from '../design/Office';
import type { DialogueLine } from '../dialogueQueue';
import type { TickRecord } from '../../shared/types';
import { Agent3D, type Behaviour } from './Agent3D';
import { DESK_OFFSET, FLOOR, seatFor, type Seat } from './layout';
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

/** Action -> where to go and what to show. Only reads the record; invents nothing. */
function behaviourFor(p: Person, rec: TickRecord | undefined, i: number, people: Person[], nav: Nav, seats: Map<string, Seat>): Behaviour {
  const desk: Behaviour = { goal: seatNode(p.id), face: 0, kind: 'desk', tag: null, spread: null };
  if (p.quit) return { goal: 'exit', face: null, kind: 'quit', tag: 'resigned', spread: null };
  if (!rec) return desk;
  const target = rec.target && rec.target !== p.id && seats.has(rec.target) ? rec.target : null;
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

/** Keeps the HTML compass needle pointing north as the camera orbits. */
function CompassSync({ controls, needle }: { controls: RefObject<ElementRef<typeof OrbitControls>>; needle: RefObject<HTMLDivElement> }) {
  useFrame(() => {
    const c = controls.current, n = needle.current;
    if (c && n) n.style.transform = `rotate(${c.getAzimuthalAngle()}rad)`;
  });
  return null;
}

export default function Office3D({ people, selected, onSelect, highlight, line = null, showThoughts = false, records = {}, speed = 1 }: {
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
}) {
  const layoutKey = people.map(p => `${p.id}:${p.role}`).join();
  const seats = useMemo(() => new Map(people.map((p, i) => [p.id, seatFor(p.role, i)])), [layoutKey]);
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const needle = useRef<HTMLDivElement>(null);
  // Integrated GPUs: drop to 1x pixels if the frame rate falls.
  const [maxDpr, setMaxDpr] = useState(1.5);
  const resetView = () => {
    const c = controls.current;
    if (!c) return;
    c.object.position.set(...CAMERA);
    c.target.set(...TARGET);
    // Drop any leftover orbit momentum so the reset lands exactly.
    c.enableDamping = false;
    c.update();
    c.enableDamping = true;
  };
  const zoom = (factor: number) => {
    const c = controls.current;
    if (!c) return;
    const cam = c.object as OrthographicCamera;
    cam.zoom = Math.min(140, Math.max(12, cam.zoom * factor));
    cam.updateProjectionMatrix();
    c.update();
  };
  const nav = useMemo(() => buildNav(people.map(p => ({ id: p.id, seat: seats.get(p.id)!, ceo: p.role === 'CEO' }))), [seats]);
  return <div className="office-scene o3-scene">
    <Canvas orthographic shadows flat dpr={[1, maxDpr]} camera={{ position: CAMERA, zoom: 30, near: 1, far: 300 }}>
      <color attach="background" args={['#14203a']} />
      <PerformanceMonitor onDecline={() => setMaxDpr(1)} />
      <hemisphereLight args={['#c9d6ff', '#6b4a2a', 1.4]} />
      <directionalLight position={[-14, 26, 16]} color="#ffe0b0" intensity={2.4} castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22} shadow-camera-far={90} />
      <World />
      {people.map((p, i) => {
        const seat = seats.get(p.id)!;
        const b = behaviourFor(p, records[p.id], i, people, nav, seats);
        const dz = seat.z + DESK_OFFSET;
        return <group key={p.id}>
          <mesh position={[seat.x + 0.4, FLOOR + 1.08, dz + 0.035]} scale={[0.58, 0.32, 0.01]} material={p.quit ? screenOff : screenOn}>
            <boxGeometry />
          </mesh>
          {b.kind === 'overwork' && <>
            <mesh position={[seat.x + 0.85, FLOOR + 1.29, dz + 0.3]} scale={[0.28, 0.13, 0.28]} material={bulb}><boxGeometry /></mesh>
            <mesh position={[seat.x + 0.3, FLOOR + 0.81, dz]} rotation-x={-Math.PI / 2} scale={[1.5, 0.8, 1]} material={lampPool}><planeGeometry /></mesh>
          </>}
          <Agent3D person={p} nav={nav} behaviour={b} phase={i} speed={speed} selected={selected === p.id} highlighted={highlight.includes(p.id)}
            line={line?.agent === p.id ? line : null} showThoughts={showThoughts} onSelect={onSelect} />
        </group>;
      })}
      <OrbitControls ref={controls} makeDefault target={TARGET} enablePan={false} minPolarAngle={0.6} maxPolarAngle={1.1}
        minAzimuthAngle={-0.8} maxAzimuthAngle={0.8} minZoom={12} maxZoom={140} />
      <FitZoom />
      <CompassSync controls={controls} needle={needle} />
      {import.meta.env.DEV && <Stats className="o3-stats" />}
    </Canvas>
    <button className="o3-compass" onClick={resetView} aria-label="Reset view" title="Reset view">
      <div ref={needle}><span className="n">N</span><span className="e">E</span><span className="s">S</span><span className="w">W</span><i /></div>
    </button>
    <div className="o3-zoom">
      <button onClick={() => zoom(1.25)} aria-label="Zoom in">+</button>
      <button onClick={() => zoom(0.8)} aria-label="Zoom out">−</button>
    </div>
    <p className="o3-hint">Drag to orbit · Scroll to zoom</p>
  </div>;
}
