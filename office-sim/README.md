# Office Sim

Office Sim is a lightweight interactive demo of a workplace rumor engine: a seeded office population reacts to events, deals with gossip, and can be steered by the user via the control panel and event injector.

## What this repo is

This project is built as an integration shell: the backend, SSE event stream, UI controls, and event-injection flow are wired together so the demo can be opened and exercised without the full simulation engine being fully fleshed out.

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start the app:
   ```bash
   pnpm run dev
   ```
4. Open the Vite client URL printed in the terminal.

## Demo flow

1. Open the app.
2. Click Start or Play to begin the office loop.
3. Click Step to advance one tick manually.
4. Use the injector to queue a rumor or policy event.
5. Watch the server event stream update the feed and state.

## Demo pitch

"This is a seeded office simulation where a small set of events can trigger stress, gossip, and resignation pressure. The app is designed to show how managerial signals, rumor distortion, and pressure on trust interact in a tight system. It is a fast visual sandbox for understanding why information quality matters and how a company can drift from normal operations into churn and mistrust."

## Known limitations

- This is intentionally an integration-focused scaffold, not a full production simulation.
- The server exposes the control loop and SSE stream, but the underlying office logic remains intentionally simple.
- Ground truth is not yet surfaced to all agents; the app is optimized for demo clarity rather than full social realism.
- A live LLM is optional; without the API key, the app falls back to a deterministic placeholder action.
- The simulation is best used for pattern demos and UI rehearsals rather than as a decision engine.

## Ablation / Q&A prep

- Ablations: We can toggle event injection on/off, gossip distortions on/off, and policy shock intensity without changing the app shell.
- Ground truth: The hidden truth tag is isolated from the agent prompt to keep the LLM from seeing a privileged signal.
- LLM role-play bias: This is a demo tool, not a statement about real office behavior. The agent role-play is intentionally constrained to keep it interpretable and reproducible.

## Venue rehearsal checklist

- Confirm the dev server starts on the expected port.
- Verify the event stream is connected and history is replayed on connect.
- Test Start / Play / Pause / Step / Reset in sequence.
- Inject one true event and one false event to validate the queue.
- Keep the demo focused on the story: stress rises, trust spreads, and the office dynamics change in a visible way.
