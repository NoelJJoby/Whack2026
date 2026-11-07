import { Controls } from './Controls';
import { Feed } from './Feed';
import { Injector } from './Injector';
import { CrackOrder } from './CrackOrder';
import { Chart } from './Chart';
import { AgentCard } from './AgentCard';

export default function App() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh' }}>
      <h1>Office Sim</h1>
      <p>Basic skeleton only.</p>
      <Controls />
      <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <Chart data={[]} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <AgentCard name="Agent 1" role="Staff" state={{ stress: 0, workload: 0, loyalty: 0, trust_mgmt: 0, burnout: 0, affinity: {}, source_trust: {} }} />
          <AgentCard name="Agent 2" role="Manager" state={{ stress: 0, workload: 0, loyalty: 0, trust_mgmt: 0, burnout: 0, affinity: {}, source_trust: {} }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <Injector />
          <Feed items={['Waiting for simulation logic.']} />
        </div>
        <CrackOrder items={[]} />
      </div>
    </main>
  );
}
