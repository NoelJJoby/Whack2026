import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import type { Person } from '../design/Office';
import type { DialogueLine } from '../dialogueQueue';
import { playerText } from '../hudModel';
import { FLOOR, type Seat } from './layout';
import { mat, unitBox } from './voxel';

const PANTS = '#2c3040', SHOES = '#1c1d22', EYES = '#241c22';

/** Box positioned by its centre, using the shared unit geometry. */
function Part({ p, s, c }: { p: [number, number, number]; s: [number, number, number]; c: string }) {
  return <mesh geometry={unitBox} material={mat(c)} position={p} scale={s} castShadow />;
}

const clip = (text: string) => { const t = playerText(text); return t.length > 60 ? `${t.slice(0, 58).trimEnd()}…` : t; };

/** The dialogue bar's current line, above its speaker: speech bubble, plus a thought cloud when thoughts are on. */
function Bubble({ name, line, showThoughts }: { name: string; line: DialogueLine; showThoughts: boolean }) {
  const thought = showThoughts && line.inner ? line.inner : '';
  if (!line.publicLine && !thought) return null;
  return <Html position={[0, 1.95, 0]} zIndexRange={[4, 0]} className="o3-anchor">
    <div className="o3-stack">
      {thought && <div className="o3-bubble thought"><small>{name} thinks</small><span>{clip(thought)}</span></div>}
      {line.publicLine && <div className="o3-bubble speech"><small>{name} says</small><span>{clip(line.publicLine)}</span></div>}
    </div>
  </Html>;
}

export function Agent3D({ person, seat, phase, selected, highlighted, line, showThoughts, onSelect }: {
  person: Person; seat: Seat; phase: number; selected: boolean; highlighted: boolean; line: DialogueLine | null; showThoughts: boolean; onSelect: (id: string) => void;
}) {
  const torso = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    if (torso.current) torso.current.scale.y = 1 + Math.sin(t * 2) * 0.02;
    // Seated typing: forearms forward with a small alternating tap.
    if (armL.current) armL.current.rotation.x = -1.15 + Math.sin(t * 14) * 0.08;
    if (armR.current) armR.current.rotation.x = -1.15 + Math.sin(t * 14 + 1.6) * 0.08;
  });
  if (person.quit) return null;
  const ring = selected ? '#d7b66c' : highlighted ? '#fff2cf' : line ? '#8abca2' : null;
  return <group position={[seat.x, FLOOR, seat.z]}
    onClick={e => { e.stopPropagation(); onSelect(person.id); }}
    onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { document.body.style.cursor = ''; }}>
    {ring && <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0.15]}><ringGeometry args={[0.55, 0.72, 24]} /><meshBasicMaterial color={ring} /></mesh>}
    {/* Seated legs: thighs forward, shins down. */}
    {[-0.12, 0.12].map(x => <group key={x}>
      <Part p={[x, 0.55, 0.22]} s={[0.2, 0.2, 0.5]} c={PANTS} />
      <Part p={[x, 0.3, 0.45]} s={[0.2, 0.45, 0.2]} c={PANTS} />
      <Part p={[x, 0.05, 0.5]} s={[0.22, 0.1, 0.3]} c={SHOES} />
    </group>)}
    <group ref={torso} position={[0, 0.5, 0]}>
      <Part p={[0, 0.3, 0]} s={[0.52, 0.6, 0.32]} c={person.color} />
    </group>
    {[[-0.34, armL], [0.34, armR]].map(([x, ref]) =>
      <group key={x as number} ref={ref as RefObject<Group>} position={[x as number, 1.02, 0]}>
        <Part p={[0, -0.2, 0]} s={[0.15, 0.42, 0.17]} c={person.color} />
        <Part p={[0, -0.45, 0]} s={[0.13, 0.1, 0.15]} c={person.skin} />
      </group>)}
    <Part p={[0, 1.38, 0]} s={[0.5, 0.5, 0.46]} c={person.skin} />
    <Part p={[0, 1.66, -0.02]} s={[0.54, 0.12, 0.52]} c={person.hair} />
    <Part p={[0, 1.44, -0.22]} s={[0.54, 0.4, 0.1]} c={person.hair} />
    <Part p={[-0.1, 1.4, 0.235]} s={[0.08, 0.08, 0.02]} c={EYES} />
    <Part p={[0.1, 1.4, 0.235]} s={[0.08, 0.08, 0.02]} c={EYES} />
    {line && <Bubble name={person.name} line={line} showThoughts={showThoughts} />}
  </group>;
}
