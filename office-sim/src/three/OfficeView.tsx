import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import type OfficeScene from './Office3D';

const Office3D = lazy(() => import('./Office3D'));

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** The HUD stays mounted over an empty backdrop while the scene loads; without WebGL it shows a notice. */
export function OfficeView({ ready, ...props }: Omit<ComponentProps<typeof OfficeScene>, 'fallback'> & { ready: boolean }) {
  const backdrop = <div className="o3-scene" aria-busy="true"/>;
  const unavailable = <div className="o3-scene o3-unavailable" role="status"><p>The office view needs WebGL, which this browser can't provide.</p></div>;
  if (!ready) return backdrop;
  return <SceneBoundary fallback={unavailable}>
    <Suspense fallback={backdrop}><Office3D {...props} fallback={unavailable}/></Suspense>
  </SceneBoundary>;
}
