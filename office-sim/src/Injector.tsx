import { useState } from 'react';

import type { EventType } from '../shared/types';

const EVENT_OPTIONS: EventType[] = [
  'merger',
  'new_management',
  'long_hours_policy',
  'pr_scandal',
  'layoffs_rumour',
  'surprise_bonus',
  'competitor_poaching',
];

interface InjectorProps {
  onInject?: (type: EventType, isTrue: boolean) => void;
}

export function Injector({ onInject }: InjectorProps) {
  const [eventType, setEventType] = useState<EventType>('merger');
  const [isTrue, setIsTrue] = useState(true);

  return (
    <section>
      <h2>Inject event</h2>
      <label style={{ display: 'block', marginBottom: '0.75rem' }}>
        <div>Event</div>
        <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
          {EVENT_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
        <label>
          <input type="radio" checked={isTrue} onChange={() => setIsTrue(true)} />
          True
        </label>
        <label>
          <input type="radio" checked={!isTrue} onChange={() => setIsTrue(false)} />
          False
        </label>
      </div>

      <button type="button" onClick={() => onInject?.(eventType, isTrue)}>Queue next tick</button>
    </section>
  );
}
