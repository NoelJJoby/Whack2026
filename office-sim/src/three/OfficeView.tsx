import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import { Office } from '../design/Office';
import type OfficeScene from './Office3D';

const Office3D = lazy(() => import('./Office3D'));

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** The existing HUD stays mounted while the scene loads or falls back to the original office. */
export function OfficeView({ ready, ...props }: Omit<ComponentProps<typeof OfficeScene>, 'fallback'> & { ready: boolean }) {
  const fallback = <Office people={props.people} selected={props.selected} onSelect={props.onSelect}
    highlight={props.highlight} speaking={props.line?.agent ?? null}/>;
  if (!ready) return fallback;
  return <SceneBoundary fallback={fallback}>
    <Suspense fallback={fallback}><Office3D {...props} fallback={fallback}/></Suspense>
  </SceneBoundary>;
}
