import type { AgentState } from '../shared/types';

export function AgentCard({ name, role, state }: { name: string; role: string; state: AgentState }) {
  return (
    <article style={{ border: '1px solid #334155', borderRadius: '12px', padding: '1rem' }}>
      <h3>{name}</h3>
      <p>{role}</p>
      <div>Stress: {state.stress}</div>
      <div>Burnout: {state.burnout}</div>
    </article>
  );
}
