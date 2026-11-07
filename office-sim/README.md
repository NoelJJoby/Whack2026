# Office Sim

This project provides the integration shell for an office simulation backend and client UI. It focuses on the simulation lifecycle, state streaming, and event injection rather than presentation details.

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start the backend:
   ```bash
   PORT=3010 ./node_modules/.bin/tsx server/index.ts
   ```
4. Start the frontend:
   ```bash
   ./node_modules/.bin/vite --host 0.0.0.0 --port 5173
   ```
5. Open the app at http://localhost:5173.

## API surface

The Fastify server exposes:

- GET /api/health
- GET /api/sim/state
- POST /api/sim/start
- POST /api/sim/play
- POST /api/sim/pause
- POST /api/sim/reset
- POST /api/sim/step
- POST /api/sim/inject
- GET /api/events

`/api/events` is a plain SSE connection; it sends the current state and recent history on connect, and emits later updates as the sim changes.

## Known limitations

- This is an integration scaffold, not a complete simulation engine.
- The server currently owns lifecycle and event queue state, but the underlying office logic is intentionally minimal.
- Without an API key, the app falls back to a placeholder response path rather than a real model call.
- The app is best used to validate wiring, state flow, and control integration rather than to assert final simulation realism.
- The project expects a stable state contract across the backend and UI layers.

## Integration checklist

- Confirm the server starts cleanly on port 3010.
- Confirm the client can connect to `/api/events`.
- Confirm start/play/pause/reset/step routes mutate the singleton state.
- Confirm inject accepts a valid event type and truth flag.
- Confirm state payloads and feed history remain consistent across updates.
