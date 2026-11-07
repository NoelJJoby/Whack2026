import 'dotenv/config';
import Fastify from 'fastify';

import { createInitialSimulation, stepSimulation } from './tick';

const app = Fastify({ logger: false });

app.get('/api/health', async () => ({ ok: true }));
app.get('/api/sim/state', async () => ({ state: createInitialSimulation() }));
app.post('/api/sim/start', async () => ({ state: createInitialSimulation() }));
app.post('/api/sim/play', async () => ({ state: createInitialSimulation() }));
app.post('/api/sim/pause', async () => ({ state: createInitialSimulation() }));
app.post('/api/sim/reset', async () => ({ state: createInitialSimulation() }));
app.post('/api/sim/step', async () => ({ state: stepSimulation(createInitialSimulation()) }));
app.post('/api/sim/inject', async () => ({ state: createInitialSimulation() }));

const port = Number(process.env.PORT ?? '3010');

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen({ port, host: '0.0.0.0' });
}

export { app };
