```
# Team Roles for 4 People
```

```
The MVP splits into four fairly independent lanes if you agree on
`shared/types.ts` in the first hour. After that, each person owns separate files
and rarely touches anyone else's.
```

```
## The four roles
```

```
### 1. Simulation Engine Lead (the rules)
**Owns:** `rules.ts`, `claims.ts`, `params.ts`, `rng.ts`, `tick.ts`
```

```
- Action resolvers, passive updates (stress, burnout, trust), quit check, gossip
hops and distortion
- The tick loop that wires event → turns → resolve → passive → quit → record
- Builds the **stubbed-LLM console runner** (agents that always pick `overwork`
or `work_normally`) so the rules can be tuned without spending credits
- Owns the hour-8 checkpoint: 16 ticks in the terminal, someone quits
```

```
*Best fit:* the strongest backend or algorithmic thinker. This is the critical
path.
```

```
### 2. LLM and Data Lead (the agents)
**Owns:** `llm.ts`, `data.ts`, `metrics.ts`
```

```
- OpenRouter adapter, system prompt, per-agent prompt builder, Zod parse,
fallback to `work_normally`
```

```
- Cast personas, traits and thresholds, the event list and the scripted scenario
- Prompt tuning so agents behave in character and their public lines differ from
their inner monologues
- Metrics: crack order, time to first quit, true vs false claim reach
- Tests 8 parallel calls against rate limits and picks the model
```

```
*Best fit:* someone comfortable with prompting and data modelling, and good at
writing character voices.
```

```
### 3. Frontend Lead (the visuals)
**Owns:** everything in `src/` (`App.tsx`, `AgentCard.tsx`, `Feed.tsx`,
`Chart.tsx`, `CrackOrder.tsx`)
```

```
- Agent cards with public line beside inner monologue, plus stress and burnout
bars
```

```
- Story feed, the metrics chart, the crack-order panel
- Works against **mock TickRecords** from hour 2 so the UI never waits for the
engine
- Handles layout, polish and a clear "quit" moment (card greys out, feed line
appears)
```

```
*Best fit:* the person with the best design eye. The demo is judged visually, so
this lane matters more than it looks.
### 4. Integration and Demo Lead (the glue and the pitch)
**Owns:** `index.ts`, `Controls.tsx`, `Injector.tsx`, `README.md`, the pitch
```

```
- Fastify server, the sim singleton (start/step/play/pause/inject), SSE with
history on connect
```

```
- Controls and the judge event injector
```

```
- Final integration, end-to-end testing, bug triage
```

- `README limitations, demo script, Q&A prep (ablations, ground truth, LLM roleplay bias)` 

```
- Runs the rehearsals on the venue network
```

```
*Best fit:* a generalist who is comfortable across the stack and can present.
## Dependencies between roles
```

```
Hour 0-1   All four: agree shared/types.ts and the TickRecord shape
```

```
Engine ───────► tick.ts ──────► Integration (index.ts calls tick)
LLM/Data ─────► data.ts, llm.ts ─► Engine (cast, events, getAgentTurn)
Frontend ◄───── mock TickRecords (from hour 2), real stream (from hour 12)
Integration ──► SSE stream ───► Frontend
```
```

```
Two handoffs matter most:
```

```
1. **Hour 1:** `types.ts` frozen. Changes after this go through a quick team
ping.
2. **Hour 12:** the stream goes live and the frontend swaps mock data for the
real SSE feed.
```

# `## Timeline by person` 

```
| Hours | Engine | LLM and Data | Frontend | Integration and Demo |
|---|---|---|---|---|
| 0-2 | `types.ts`, `params.ts`, `rng.ts` | `data.ts`: cast and events | Vite
setup, mock TickRecords | Repo, `.env`, Fastify skeleton |
| 2-8 | `rules.ts`, `claims.ts`, `tick.ts`, stub runner | `llm.ts`, prompts,
model test | Cards, feed, chart on mock data | SSE and sim singleton with stub
ticks |
| 8-12 | Tune with stub LLM; fix quits | Wire real LLM into tick; `metrics.ts` |
Crack order panel, quit animation | Controls, injector, play/pause |
| 12-18 | Tune crack order with real LLM | Prompt tuning for voice and behaviour
| Swap to live stream, polish | End-to-end testing, bug triage |
| 18-21 | Stretch: `verify_rumour`, replacements | Stretch: scandal claim,
`leak_to_press` | Stretch: trust graph | Demo script, README limitations |
| 21-24 | Freeze, fix last bugs | Freeze prompts | Final polish | Two full
rehearsals on venue network |
```

# `## Shared responsibilities` 

```
- **Everyone:** the hour-8 console checkpoint and the hour-18 full-run test.
- **Engine and LLM leads pair** at hours 8-12, since the first real LLM-driven
run is where rules and prompts collide.
```

```
- **Frontend and Integration pair** at hour 12 for the stream cutover.
```

```
- **Pitch:** Integration and Demo Lead writes it, but all four read it twice
before the event.
```

```
## If your team isn't balanced
```

```
- **No strong frontend person:** move `Chart.tsx` and `CrackOrder.tsx` to the
Integration lead, and keep the Frontend lead on cards and feed only.
- **No one confident in prompting:** the LLM lead pairs with the Integration
lead on prompts, since the persona voices are what judges notice.
- **Only 3 people:** merge Integration and Demo into Frontend, and have the LLM
lead also own `index.ts`.
```

# `## Rules for working together` 

```
1. One owner per file. If you need a change in someone else's file, ask them.
2. Commit small and often to `main`, and pull before starting each block, since
the file ownership above keeps merge conflicts rare.
```

`3. The mock TickRecord is the contract. If the real tick differs from it, fix the mock and the engine together.` 

```
4. A 10-minute sync at hours 4, 8, 12, 16 and 20 to surface blockers early.
```

```
I can write the shared `types.ts` and a mock `TickRecord` next so all four
people can start in parallel.
```

