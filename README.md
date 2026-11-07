# Agentic Chaos

This project provides the integration shell for an office simulation backend and client UI. It focuses on the simulation lifecycle, state streaming, and event injection rather than presentation details.

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Run the automated test suite:
   ```bash
   pnpm test
   ```
4. Start the backend:
   ```bash
   PORT=3010 ./node_modules/.bin/tsx server/index.ts
   ```
5. Start the frontend:
   ```bash
   ./node_modules/.bin/vite --host 0.0.0.0 --port 5173
   ```
6. Open the app at http://localhost:5173.

## API surface

The Fastify server runs the real simulation engine. Types for every request, response and stream message are in `office-sim/shared/api.ts`.

- `GET /api/health`: `{ ok, mode, mode_reason }`
- `GET /api/sim/cast`: the agent profiles
- `GET /api/sim/state`: `{ mode, mode_reason, state }`
- `GET /api/sim/history`: the same, plus `history` (one frame per tick)
- `POST /api/sim/start`, `/play`, `/pause`, `/reset`, `/step`
- `POST /api/sim/settings` with `{ "max_ticks": 1-128 }`: the run length (default 16, can't go below the current tick, kept across reset). Every response includes `max_ticks`.
- `POST /api/sim/inject` with `{ "type": EventType, "is_true"?: boolean }`. Applied at the start of the next tick.
- `GET /api/events`: SSE. It sends `history` on connect (and after reset), then a `tick` message per tick and a `state` message on play, pause or inject.

Errors always look like `{ "error": { "code", "message" } }`, with status 400 (invalid input), 404 or 409 (`sim_running`, `tick_in_progress`, `run_complete`).

## Modes

- With `ANTHROPIC_API_KEY` set, the sim runs in `llm_bias` mode.
- Without a key, it runs in `rules` mode and reports `mode_reason: "no_api_key"`.
- If every LLM call in a tick fails, it switches to `rules` for the rest of the run (`mode_reason: "llm_failed"`). Reset tries the LLM again.

The UI shows the active mode in the top bar.

## Dev flag

`VITE_USE_MOCKS=true ./node_modules/.bin/vite` renders the design-preview mock data without a server. It's off by default.

## Integration checklist

- Confirm the server starts cleanly on port 3010.
- Confirm the client can connect to `/api/events`.
- Confirm start/play/pause/reset/step routes mutate the singleton state.
- Confirm inject accepts a valid event type and truth flag, and rejects anything else with a 400.
- Confirm state payloads and feed history remain consistent across updates.

## Backend share price

The existing main-branch stock ticker/chart now consumes the deterministic backend price through current snapshots and SSE history. No extra chart, controls or styling are added. Price combines fixed-seat output, decaying news, six-tick false-claim corrections and an isolated seeded noise stream. Optional feedback defaults off; select it before starting via `/api/sim/settings` with `{ "price_feedback": true }`, or CLI `--price-feedback`.

See [backend implementation and measured acceptance](docs/share-price-implementation.md) for API details, commands, ten-seed results and the remaining calm-volatility tuning target.
