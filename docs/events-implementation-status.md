# Autonomous business demo

Implemented 7 November 2026 from `events-implementation-plan.md`. The final delivery scope is a locally running hackathon demo, following the request to prioritise delivery over additional testing.

The existing office now has persistent Business events with CEO decisions, Ops assignments, employee work and financial outcomes. The engine supports the 24 common/rare situation families, stateful seeded arrivals, finite staff capacity, contracts, exact-once integer-money postings, calendar-aware costs, layoffs chosen by the CEO, employee incidents, detection, containment and recovery. Role-specific AI contracts run CEO → Ops → employees with safe deterministic fallbacks and revision/assignment validation. Legacy scripted scenarios remain available for earlier engine fixtures; the application and CLI use the new business loop.

Run journals retain starting and committed tick snapshots, accepted inputs, structured decisions, work and accounting independently of the 300-frame display history. Reports are attached to a run, history cutoff and retained version. The analyst selects grounded evidence and typed metrics; unsupported narrative fails validation and produces a labelled factual fallback. Archives, citations, regeneration and Markdown/JSON downloads remain available after reset.

## Run locally

From `office-sim`:

```sh
pnpm install
pnpm dev
```

The development UI runs at `http://localhost:5173` and proxies the API on port 3010. The delivered local demo uses this setup, with its history in `office-sim/.runtime/demo`. A built single-server launch is also available with `pnpm build && pnpm start` on port 3010 by default. `PORT` and `SIM_STORE_DIR` configure the port and persistent history location. An existing `ANTHROPIC_API_KEY` enables AI mode; without it, the demo operates autonomously in rules mode. Runtime journals and credentials are ignored by Git and the Docker build context.

A Dockerfile is included for a future Node hosting target. Build from `office-sim`, expose port 3010 and mount a persistent volume at `/data`. Supply credentials through the hosting environment, never the image.

## Verification performed

- Production TypeScript/Vite build passed.
- New deterministic business, storage, report and generation-isolation checks passed, including reset during CEO/Ops/employee phases and injections accepted during a tick.
- Chromium verified client-win, breach and avoided-layoff stories, report citations/download links, archive access after reset, keyboard focus and 1440×900, 1280×720 and 640×800 windows. Screenshots were inspected.
- Local production page and `/api/health` returned HTTP 200 on port 3022.
- A development baseline of seeds 1–100 over 600 ticks each (twelve simulated months) produced 5,340 material roots, 60.3745% positive. Nominal common intervals were 10–20 ticks; rare intervals were 40–60 ticks, mean 49.7567. There were 117 cost reviews, 107 executed alternatives recorded as layoffs avoided, and zero fallback-initiated layoffs. Average final headcount was eight and average cash was 73,734,890 minor GBP units. This measures the rules baseline, not live-model realism. The compact results are in `events-calibration.json`.
- Further statistical comparisons, timeout benchmarking and expanded live-model evaluation were not pursued after the user requested a quicker demo delivery. One final suite run inherited a local API key; it was stopped and the affected deterministic API test now explicitly disables that key. No complete final full-suite pass is claimed.

This is the hackathon implementation, with deliberately small financial and delivery models. Report narrative is constrained to verifiable evidence excerpts and a bounded recommendation vocabulary. Broader calibration and production operational hardening remain outside the reduced demo acceptance scope.

## Tick speed correction

Gameplay requests now explicitly disable model thinking and use low effort, avoiding hidden reasoning exhausting the short JSON response budgets. Ops planning is repeated when scheduling inputs change, rather than for an unchanged paused backlog. Playback intervals account for tick processing time instead of adding a full interval after each AI response. TypeScript and fourteen focused checks passed. The live timing check was blocked by automatic approval review; no improved live timing measurement is claimed.
