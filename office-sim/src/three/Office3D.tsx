// 3D isometric voxel office (VITE_VIEW=3d). Same props as the 2D <Office>; renders only what it is given.
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Stats } from '@react-three/drei';
import { DoubleSide, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import type { Person } from '../design/Office';
import type { DialogueLine } from '../dialogueQueue';
import { Agent3D } from './Agent3D';
import { DESK_OFFSET, FLOOR, seatFor } from './layout';
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

export default function Office3D({ people, selected, onSelect, highlight, line = null, showThoughts = false }: {
  people: Person[];
  selected: string | null;
  onSelect: (id: string) => void;
  highlight: string[];
  /** The line the dialogue bar is showing: only its speaker gets a bubble. */
  line?: DialogueLine | null;
  showThoughts?: boolean;
}) {
  return <div className="office-scene o3-scene">
    <Canvas orthographic shadows flat dpr={[1, 1.5]} camera={{ position: CAMERA, zoom: 30, near: 1, far: 300 }}>
      <color attach="background" args={['#14203a']} />
      <hemisphereLight args={['#c9d6ff', '#6b4a2a', 1.4]} />
      <directionalLight position={[-14, 26, 16]} color="#ffe0b0" intensity={2.4} castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22} shadow-camera-far={90} />
      <World />
      {people.map((p, i) => {
        const seat = seatFor(p.role, i);
        return <group key={p.id}>
          <mesh position={[seat.x + 0.4, FLOOR + 1.08, seat.z + DESK_OFFSET + 0.035]} scale={[0.58, 0.32, 0.01]} material={p.quit ? screenOff : screenOn}>
            <boxGeometry />
          </mesh>
          <Agent3D person={p} seat={seat} phase={i} selected={selected === p.id} highlighted={highlight.includes(p.id)} line={line?.agent === p.id ? line : null} showThoughts={showThoughts} onSelect={onSelect} />
        </group>;
      })}
      <OrbitControls makeDefault target={TARGET} enablePan={false} minPolarAngle={0.6} maxPolarAngle={1.1}
        minAzimuthAngle={-0.8} maxAzimuthAngle={0.8} minZoom={12} maxZoom={140} />
      <FitZoom />
      {import.meta.env.DEV && <Stats className="o3-stats" />}
    </Canvas>
  </div>;
}
