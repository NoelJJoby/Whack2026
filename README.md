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

The UI shows the active mode in the top bar

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

## Overtime

Each tick represents one hour ending at the displayed time. Hours ending at 18:00 through 24:00 are overtime; the next simulated day resumes at 08:00 (the overnight interval is skipped). Every active employee receives +2 stress and +1 burnout per overtime hour, in addition to their chosen action, before passive updates and the quit check. Values are clamped to the existing 0–100 limits. The separate `overwork` action means taking on extra work and retains its own effects; the long-hours policy remains a separate workload and trust shock. The model assumes everyone active is still on shift, even when their action is an interview or other non-work activity. There is currently no leaving-early or overnight recovery mechanic. These values are initial tuning parameters in `server/params.ts`.

## Demo run

All commands run from `office-sim/`.

- **Development** (hot reload): `pnpm dev`, then open http://localhost:5173. The API runs on port 3010.
- **Production** (one server, built UI): `pnpm build && pnpm start`, then open http://localhost:3010.

Settings:

- `ANTHROPIC_API_KEY` in `office-sim/.env` runs the CEO and ops through the LLM. Without it the app runs on rules, and the HUD badge says so.
- `SIM_SEED=<number>` replays a fixed company. Without it, each server start picks a new random seed, so set it for a repeatable run.

### Two-minute quarter

Select **2 min / quarter** beside the playback speeds, then **Start**. The default quarter is 240 work periods across 90 calendar days. Fast-forward targets 96 seconds (400 ms per work period), leaving headroom within two minutes for local processing. Pauses and time spent with playback paused extend the run.

Fast-forward uses the deterministic rules engine for employees and management, with brief dialogue highlights instead of waiting for every line. It retains all 240 committed snapshots, business events, stock prices, scores and daily reports, and immediately saves a factual final report. When a key is configured, a separate AI recap starts after completion with a ten-second budget. The End of Quarter screen opens after the final dialogue and fills in the recap when ready; exact prices and results remain usable if AI is unavailable. The HUD says **Fast-forward · Rules mode**. Select an ordinary playback speed to return to the configured AI/rules mode and full dialogue. Changing speeds during an AI turn takes effect after that turn finishes.

API: `POST /api/sim/speed` with `{ "speed": 8 }` selects this mode. Ordinary playback speeds remain `0.5`, `1`, `2`, and `4`.

Run `pnpm benchmark:quarter` from `office-sim` to time a complete paced quarter, including disk commits, stream serialization and the factual report. It uses a temporary run directory and makes no AI requests. `pnpm benchmark:quarter --unpaced` measures computation/storage throughput without pacing. Both verify 240 committed ticks and fail if execution exceeds two minutes.

Measured locally on 2026-11-08: seed 42 completed all 240 ticks and the factual report in **96.81 seconds**, with no viewer acknowledgements or AI calls. The production build and all 319 automated tests passed. Browser verification covered the fast-forward control, live clock/price updates and pause.

## Autonomous business demo

Run `pnpm dev` from `office-sim` and open http://localhost:5173. The API runs on port 3010. For a built single-server deployment, use `pnpm build && pnpm start` (port 3010 by default). See [implementation and run notes](docs/events-implementation-status.md) for event stories, durable reports, configuration and measured verification.

## Company objectives

Submit a hypothetical objective to `POST /api/sim/company-tasks` using the current run ID and an idempotency key. Inspect its brief, work, findings, and outcome through the company-task API and committed SSE frames.

From `office-sim`, run `node --import tsx server/scripts/company-task-demo.ts` for a rules-mode launch scenario. See the [implementation plan and release notes](docs/task-driven-company-implementation-plan.md#release-implementation-and-verification) for the request body, route details, and verification results.
