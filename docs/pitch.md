# Agentic Chaos — three-minute pitch

Pitch direction: **Can an AI run a company without losing its people?**

Audience assumed: hackathon judges. Rank features by how quickly they demonstrate value, originality and working depth. Show one connected company story rather than opening every menu.

This review covers the current frontend, simulation and bias engines, LLM integration, objectives and collaboration, events and rumours, business and stock systems, reports, playback, persistence, evaluation tools, scene and audio code, tests and implementation notes. Current source takes precedence over older plans. This is a source review; the application and test suite were not rerun for this pitch.

## Ranking everything by pitch value

Scores are editorial priorities for this pitch, not measured product scores. Suggested airtime overlaps where one demonstration proves several features.

| Rank | What you built | Pitch value | How to use it |
| --- | --- | --- | --- |
| 1 | Autonomous company: CEO decides, Ops delegates, employees act | 10/10 | Lead with the central experience. The audience should understand this within 20 seconds. |
| 2 | Personalities, stress, burnout, loyalty and trust influence behaviour and departures | 10/10 | Explain why the company is interesting: people react differently and pressure has consequences. |
| 3 | Interactive stress testing: preset events, custom headlines, true events and false rumours | 9/10 | Best short demo: introduce a false layoffs rumour and inspect a reaction. |
| 4 | User objectives, CEO briefs, cross-department requests, findings, dependencies and independent review | 9/10 | Give one concrete example: Sales research must reach Engineering before dependent work advances. |
| 5 | Work and business consequences: finite capacity, deadlines, defects, rework, contracts, cash, costs and stock | 9/10 | Show that decisions affect tracked outcomes. Open the stock chart or scorecard briefly. |
| 6 | Interactive 3D office, animated staff, public dialogue and generated private thoughts | 9/10 | Keep the office visible throughout. Show one employee saying one thing and thinking another. |
| 7 | Hybrid architecture: validated AI proposals, personality weighting and rule-based consequences | 8/10 | One plain sentence establishes technical depth: AI proposes; the engine enforces capacity and calculates consequences. |
| 8 | End-of-quarter results, AI recap, best move/biggest blunder and factual report fallback | 8/10 | Show a saved report to close the story. It connects the experience to reflection and learning. |
| 9 | Gossip propagation, distorted retellings, source trust, verification and press leaks | 8/10 | Explain alongside the rumour demo; avoid a separate technical tour. Ground truth stays hidden from employees. |
| 10 | Quarter fast-forward, ordinary playback speeds, pause, step, dialogue controls and synchronised presentation | 7/10 | Mention rapid experimentation if time permits. Fast-forward uses rules mode; it is not a two-minute live-AI quarter. |
| 11 | Twenty-four business situation families, incident response, containment, recovery and management disclosure | 7/10 | Establish variety with two examples, such as a client win and a supplier breach. Keep catalogue details for questions. |
| 12 | Live wellbeing, rumour-reach and scorecard views | 7/10 | Use these as evidence of consequences: retention, morale and trust alongside shareholder value. |
| 13 | Seeded engine, decision logs, policy comparisons, ablations and calibration scripts | 6/10 | Strong technical Q&A material. Same seed plus fixed model replies can reproduce outcomes; fresh live replies need not. |
| 14 | Durable journals, recovery, archived runs, retained report versions and Markdown/JSON exports | 6/10 | Supports inspectability and reliability. Mention that results are saved; leave storage mechanics for questions. |
| 15 | Validated schemas, retries, rules fallback, reconnect handling and automated checks | 6/10 | Useful credibility in Q&A. Quote only a test count verified for the exact version being presented. |
| 16 | Day/night lighting, office arrivals/departures, overtime, emotion effects, character babble, music and sound effects | 5/10 | Let the audience experience the polish. Overtime also provides a concrete example of pressure affecting wellbeing. |
| 17 | Keyboard controls, focus handling, desktop layouts and contextual employee panels | 4/10 | Demonstrate naturally through confident navigation. No separate speech needed. |
| 18 | Best Boss leaderboard and CEO comparison runner | 3/10 today | The displayed leaderboard is explicitly fictional demo data. Show only as an illustrative comparison interface, never as benchmark evidence. |

## Basic spoken pitch

The time slots include navigation and short pauses. Replace each contribution blank with one sentence of roughly eight words. Rehearse once with the actual presenter and trim if necessary.

### 0:00–0:20 — Hook

“Can an AI run a company without losing its people?

We built **Agentic Chaos**, an interactive office simulation where an AI-led company has to balance business performance with the people doing the work.”

### 0:20–0:45 — What it does

“Inside this office are eight agents: a CEO, an operations manager and six employees. Management makes decisions and assigns work. Employees have different personalities, relationships and levels of stress, burnout and trust.

Those differences influence whether they work, help a colleague, spread a rumour or eventually resign.”

*[Keep the office visible; select one employee.]*

### 0:45–1:20 — Short demo

“We can give the company an objective, such as investigating demand for a new service. The CEO creates a brief, Ops assigns tasks, and employees exchange findings that other work depends on.

We can also introduce a shock, like a false layoffs rumour. Employees do not know the hidden truth. Some may investigate; others may spread it.”

*[Use a rehearsed run to show the rumour and one employee’s public dialogue and generated private thoughts. Allow about ten seconds for the demonstration.]*

### 1:20–1:50 — Why the mechanics matter

“The consequences extend beyond conversation. Work takes time, staff have limited capacity, deadlines can be missed, and reviews can send tasks back for rework. Business outcomes feed into finances and the simulated share price.

Underneath, AI proposes decisions. Our engine validates them, applies personality and pressure, and calculates the consequences.”

*[Briefly show the stock chart or scorecard.]*

### 1:50–2:15 — Value

“At the end, a saved report brings together company results and staff wellbeing, with an AI recap when available.

The value is being able to explore leadership trade-offs: did the company deliver, did people stay, and what happened to trust? It is a playable sandbox for experimenting with AI management.”

*[Show a report from a completed run.]*

### 2:15–2:40 — Contributions

“We split the build across the team:

**________________** contributed **________________________________**.

**________________** contributed **________________________________**.

**________________** contributed **________________________________**.

**________________** contributed **________________________________**.”

### 2:40–3:00 — Close

“Agentic Chaos makes AI management visible: you can watch decisions move through an organisation and inspect the consequences.

Our question is simple: when an AI becomes the boss, what happens to the company—and to its people?”

## Demo preparation

1. Have the office open in a rehearsed run with readable employee dialogue. Use ordinary playback for the AI demonstration and confirm the mode badge.
2. Prepare one objective and one false-rumour example. If both take too long, show the existing objective briefly and spend the live interaction on the rumour.
3. Keep one completed report ready. Do not spend the pitch waiting for a full quarter or fresh AI report generation.
4. Use one employee detail view and one results view. Keep the office visible for most of the presentation.
5. Keep contribution sentences short and concrete: what each person actually delivered. The existing team-role document describes planned roles, not verified individual authorship.

## Claims to keep accurate

- The current Best Boss screen contains fictional sample results, explicitly labelled in both its data and interface. Do not claim a measured model winner.
- The CEO model dropdown currently changes frontend state and the displayed model label; it does not send a backend model-change request. Do not demonstrate it as live model switching.
- The two-minute-quarter setting uses the rules engine for management and employees, with an optional AI recap afterward. The README records a local 96.81-second run; this was not remeasured for this review.
- Objectives, research, engineering and financial outcomes occur inside the simulation. Agents do not conduct real market research or ship actual products.
- Present the product as an experimental simulation and playable sandbox. The repository does not establish that it predicts real employee behaviour or proves which AI would run a real company best.
- Private thoughts are generated character dialogue, not access to a model's internal reasoning.

## Main source references

- Product composition and controls: `office-sim/src/App.tsx`, `ObjectivePanel.tsx`, `EventComposer.tsx`, `Scorecard.tsx`, `QuarterReport.tsx`.
- Simulation and AI decisions: `office-sim/server/tick.ts`, `bias.ts`, `management.ts`, `tasks.ts`, `llm.ts`, `llm/config.ts`.
- Collaboration: `office-sim/server/company-tasks/` and `office-sim/shared/companyTasks.ts`.
- Business and information effects: `office-sim/server/events/catalog.ts`, `claims.ts`, `business.ts`, `price.ts`.
- Presentation and sound: `office-sim/src/three/`, `dialogueQueue.ts`, `usePresentation.ts`, `voice/`, `useBackgroundMusic.ts`.
- Reports and retained evidence: `office-sim/server/reporting.ts`, `quarter-summary.ts`, `run-store.ts`.
- Evaluation and comparison: `office-sim/server/scripts/ablate.ts`, `price-acceptance.ts`, `benchmark-quarter.ts`, `leaderboard.ts`, `office-sim/src/leaderboard/leaderboard.json`.
- Historical verification and scope: `README.md`, `docs/reactive-day-status.md`, `docs/events-implementation-status.md`, `docs/task-driven-company-implementation-plan.md`, `docs/share-price-implementation.md`, `docs/ui-overhaul-verification.md`.
