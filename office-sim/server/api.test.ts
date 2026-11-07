import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { app } from './index';

describe('api routes', () => {
  test('GET /api/health returns ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  });

  test('simulation lifecycle routes mutate singleton state', async () => {
    await app.inject({ method: 'POST', url: '/api/sim/reset' });

    let response = await app.inject({ method: 'POST', url: '/api/sim/start' });
    let json = response.json();
    assert.equal(response.statusCode, 200);
    assert.equal(json.state.started, true);
    assert.equal(json.state.running, true);

    response = await app.inject({ method: 'POST', url: '/api/sim/pause' });
    json = response.json();
    assert.equal(response.statusCode, 200);
    assert.equal(json.state.running, false);

    response = await app.inject({ method: 'POST', url: '/api/sim/step' });
    json = response.json();
    assert.equal(response.statusCode, 200);
    assert.equal(json.state.tick, 1);

    response = await app.inject({
      method: 'POST',
      url: '/api/sim/inject',
      payload: { type: 'merger', is_true: false },
      headers: { 'content-type': 'application/json' },
    });
    json = response.json();
    assert.equal(response.statusCode, 200);
    assert.equal(json.state.event, 'merger');
    assert.ok(json.state.queue.includes('merger'));
    assert.ok(json.state.feed.some((line: string) => line.includes('Queued event: merger')));

    response = await app.inject({ method: 'POST', url: '/api/sim/reset' });
    json = response.json();
    assert.equal(response.statusCode, 200);
    assert.equal(json.state.started, false);
    assert.equal(json.state.running, false);
    assert.equal(json.state.tick, 0);
  });

  test('GET /api/sim/state returns the singleton state', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/sim/reset' });
    const resetJson = response.json();

    const stateResponse = await app.inject({ method: 'GET', url: '/api/sim/state' });
    const stateJson = stateResponse.json();

    assert.equal(stateResponse.statusCode, 200);
    assert.deepEqual(stateJson.state, resetJson.state);
    assert.equal(stateJson.state.tick, 0);
  });
});
