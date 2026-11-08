import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Vector3, type DirectionalLight, type Group, type HemisphereLight, type MeshBasicMaterial, type OrthographicCamera, type PointLight } from 'three';
import { daylightForTick } from './daylight';
import { FLOOR } from './layout';

const LAMPS: Array<[number, number, number]> = [
  [-7, FLOOR + 4, -1], [0, FLOOR + 4, -1], [8, FLOOR + 4, -4],
  [0, FLOOR + 2, 5.7], [-1.6, 1.6, 8.5], [1.6, 1.6, 8.5],
];

/** Follow the presented hour, just like employee presence; never run a separate wall clock. */
export function DayNight({ tick, speed, paused }: { tick: number; speed: number; paused: boolean }) {
  const target = useMemo(() => {
    const light = daylightForTick(tick);
    return {
      ...light,
      sky: new Color(light.from.sky).lerp(new Color(light.to.sky), light.fraction),
      sun: new Color(light.from.sun).lerp(new Color(light.to.sun), light.fraction),
      position: new Vector3(...light.position),
    };
  }, [tick]);
  const sky = useRef<Color>(null);
  const ambient = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const lamps = useRef<Array<PointLight | null>>([]);
  const sunDisc = useRef<Group>(null);
  const sunFace = useRef<MeshBasicMaterial>(null);
  const sunHalo = useRef<MeshBasicMaterial>(null);
  // Initial props stay fixed: later hours ease in, rather than React snapping light values.
  const initial = useRef(target).current;
  const orbit = useRef({ progress: initial.sunProgress, visibility: initial.sunVisibility });
  useFrame(({ camera }, delta) => {
    const ease = paused ? 0 : 1 - Math.exp(-Math.min(delta, 0.1) * 3 * Math.min(speed, 2));
    sky.current?.lerp(target.sky, ease);
    if (ambient.current) ambient.current.intensity += (target.ambient - ambient.current.intensity) * ease;
    if (sun.current) {
      sun.current.color.lerp(target.sun, ease);
      sun.current.intensity += (target.sunlight - sun.current.intensity) * ease;
      sun.current.position.lerp(target.position, ease);
    }
    lamps.current.forEach((lamp, i) => {
      if (lamp) lamp.intensity += (target.lamps * (i < 3 ? 32 : 12) - lamp.intensity) * ease;
    });
    const disc = sunDisc.current, face = sunFace.current, halo = sunHalo.current;
    if (!disc || !face || !halo) return;
    const state = orbit.current;
    // Reset an invisible sun at dawn so it never travels backwards across the night sky.
    if (!paused && state.visibility < 0.001 && target.sunVisibility > 0) state.progress = target.sunProgress;
    state.progress += (target.sunProgress - state.progress) * ease;
    state.visibility += (target.sunVisibility - state.visibility) * ease;
    face.color.lerp(target.sun, ease);
    halo.color.copy(face.color);
    face.opacity = state.visibility;
    halo.opacity = state.visibility * 0.14;
    disc.visible = state.visibility > 0.001;
    // A distant backdrop keeps the sun in the sky when the player orbits or follows staff.
    // Interpolate the angle, then draw the arc, so each time change follows a curved path.
    const angle = state.progress * Math.PI;
    disc.position.set(-0.78 * Math.cos(angle), 0.36 + 0.36 * Math.sin(angle), 0.9).unproject(camera);
    disc.quaternion.copy(camera.quaternion);
    const cam = camera as OrthographicCamera;
    disc.scale.setScalar((cam.top - cam.bottom) / cam.zoom * 0.027);
  });
  return <>
    <color ref={sky} attach="background" args={[initial.sky]} />
    <hemisphereLight ref={ambient} args={['#c9d6ff', '#6b4a2a', initial.ambient]} />
    <group ref={sunDisc} visible={initial.sunVisibility > 0}>
      <mesh>
        <circleGeometry args={[1.6, 32]} />
        <meshBasicMaterial ref={sunHalo} color={initial.sun} transparent opacity={initial.sunVisibility * 0.14} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position-z={0.01}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial ref={sunFace} color={initial.sun} transparent opacity={initial.sunVisibility} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
    <directionalLight ref={sun} position={initial.position} color={initial.sun} intensity={initial.sunlight} castShadow
      shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.03}
      shadow-camera-left={-36} shadow-camera-right={36} shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-far={100} />
    {LAMPS.map((position, i) => <pointLight key={i} ref={lamp => { lamps.current[i] = lamp; }}
      position={position} color="#ffce8a" intensity={initial.lamps * (i < 3 ? 32 : 12)} distance={i < 3 ? 15 : 9} decay={2} />)}
  </>;
}
