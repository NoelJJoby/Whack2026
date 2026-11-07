import 'dotenv/config';
import Fastify from 'fastify';

import type { EventType, SimulationMode, SimulationState } from '../shared/types';
import { createInitialSimulation, injectEvent, stepSimulation } from './tick';

const DEFAULT_MODE: SimulationMode = 'llm_bias';

class OfficeSimManager {
  private readonly listeners = new Set<(payload: unknown) => void>();
  state: SimulationState = { ...createInitialSimulation(), mode: DEFAULT_MODE };

  subscribe(listener: (payload: unknown) => void) {
    this.listeners.add(listener);
  }

  unsubscribe(listener: (payload: unknown) => void) {
    this.listeners.delete(listener);
  }

  private emit(payload: unknown) {
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  async start() {
    this.state.started = true;
    this.state.running = true;
    this.state.mode = DEFAULT_MODE;
    this.emit({ type: 'state', mode: this.state.mode, state: this.state, history: this.state.feed.slice(-20) });
    return this.state;
  }

  async play() {
    this.state.started = true;
    this.state.running = true;
    this.state.mode = DEFAULT_MODE;
    this.emit({ type: 'state', mode: this.state.mode, state: this.state, history: this.state.feed.slice(-20) });
    return this.state;
  }

  async pause() {
    this.state.running = false;
    this.emit({ type: 'state', mode: this.state.mode, state: this.state, history: this.state.feed.slice(-20) });
    return this.state;
  }

  async reset() {
    this.state = { ...createInitialSimulation(this.state.seed), mode: DEFAULT_MODE };
    this.emit({ type: 'state', mode: this.state.mode, state: this.state, history: this.state.feed.slice(-20) });
    return this.state;
  }

  async step() {
    this.state = { ...stepSimulation(this.state), mode: this.state.mode ?? DEFAULT_MODE };
    this.emit({ type: 'tick', mode: this.state.mode, state: this.state, history: this.state.feed.slice(-20) });
    return this.state;
  }

  async inject(type: EventType, isTrue = true) {
    this.state = injectEvent(this.state, type);
    this.state.event = type;
    this.state.feed = [...this.state.feed, `Queued event: ${type} (truth=${String(isTrue)})`];
    this.emit({ type: 'inject', mode: this.state.mode, state: this.state, history: this.state.feed.slice(-20) });
    return this.state;
  }
}

const sim = new OfficeSimManager();
const app = Fastify({ logger: false });

app.get('/api/health', async () => ({ ok: true }));
app.get('/api/sim/state', async () => ({ mode: sim.state.mode ?? DEFAULT_MODE, state: sim.state }));
app.post('/api/sim/start', async () => ({ mode: DEFAULT_MODE, state: await sim.start() }));
app.post('/api/sim/play', async () => ({ mode: DEFAULT_MODE, state: await sim.play() }));
app.post('/api/sim/pause', async () => ({ mode: sim.state.mode ?? DEFAULT_MODE, state: await sim.pause() }));
app.post('/api/sim/reset', async () => ({ mode: DEFAULT_MODE, state: await sim.reset() }));
app.post('/api/sim/step', async () => ({ mode: sim.state.mode ?? DEFAULT_MODE, state: await sim.step() }));
app.post('/api/sim/inject', async (request) => {
  const body = request.body as { type?: EventType; is_true?: boolean };
  const type = body.type ?? 'merger';
  return { mode: sim.state.mode ?? DEFAULT_MODE, state: await sim.inject(type, body.is_true ?? true) };
});

app.get('/api/events', async (request, reply) => {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no');
  reply.raw.flushHeaders?.();

  const write = (payload: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sim.subscribe(write);
  write({ type: 'history', mode: sim.state.mode ?? DEFAULT_MODE, state: sim.state, history: sim.state.feed.slice(-20) });

  request.raw.on('close', () => {
    sim.unsubscribe(write);
  });

  return reply;
});

const port = Number(process.env.PORT ?? '3010');

void (async () => {
  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Office sim server listening on http://localhost:${port}`);
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
})();

setInterval(() => {
  if (!sim.state.running) {
    return;
  }
  void sim.step();
}, 2500);

export { app };
