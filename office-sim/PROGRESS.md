# 3D view progress (VITE_VIEW=3d, default 2d)

## Done
- Pass 1: App.tsx lazy-loads `src/three/Office3D.tsx` instead of the 2D `<Office>`. voxel.ts bakes box data
  into 3 merged meshes; world.ts = diorama; layout.ts = seats by archetype; Agent3D.tsx = voxel figure.
  Bubble only over the dialogue bar's current speaker (App passes `dialogue.line`, `showThoughts`).
- Pass 2: nav.ts waypoint graph (aisles auto-chained by z, Dijkstra). Office3D maps each agent's latest
  TickRecord (`records={latest}`, `speed={sim.speed}`) to a Behaviour: desk / overwork (red shirt, sweat,
  lamp) / sofa or cooler / visit target (grr, psst, ?) / leak at window / interview on path / quit walk-out.
  Agents finish a walk and dwell 2 s before taking their newest behaviour (ticks outpace walking).
- Pass 3: `.view-3d` on <main> scopes navy/gold restyle (office3d.css). Rail = People / Shake / Charts /
  Settings (three/Hud3D.tsx: PeopleDrawer, ChartDrawer with crack order). StockPrice `sparkline` prop
  (3D only, last 20 recorded prices). Zoom +/− and hint inside Office3D.
- Pass 4: drei PerformanceMonitor drops dpr 1.5→1 on fps decline. Compass (rotates with camera, click =
  reset view). Higgsfield had no generations → ASSETS_TODO.md (5 hero assets). M1: 60 fps, p95 17 ms.

## Next
- Feature freeze from 05:30. Flip default to 3D only on the user's say-so (VITE_VIEW=3d).
- Optional: pull Higgsfield GLBs per ASSETS_TODO.md once generated.

## Gotchas
- Test: VITE_VIEW=3d npm run dev. A stale 2D vite may own 127.0.0.1:5173; use the LAN IP if so.
- Background tabs pause rAF: agents look frozen until the tab is focused (FPS meter shows no number).
- Real actions (shared/types.ts): work, overwork, slack_off, complain, gossip, verify, interview, leak.
- Mock flag is VITE_USE_MOCKS=true. Inject UI is EventComposer.tsx. pnpm: `npx -y pnpm@9.15.0`.
- Drawers are modal <dialog>s: the first outside click only closes the open one.
- Static world = 3 draw calls; add furniture as Box data in world.ts, not meshes.
- Font stays VCR OSD Mono (team choice).
