# 3D view progress (VITE_VIEW=3d)

## Done
- Pass 1: R3F diorama behind `VITE_VIEW=3d` (default 2d). App.tsx lazy-loads `src/three/Office3D.tsx`
  in place of the 2D `<Office>`, with the same props (people/selected/onSelect/highlight).
  The existing HUD (wire, Workday, stock, tool rail, panels) is unchanged and overlays the canvas.
- `src/three/`: voxel.ts (box data → one merged mesh), world.ts (plot, street, cars, building,
  cutaway walls, meeting room, lounge, coffee bar, cooler, glass CEO office), layout.ts (seats
  by archetype), Agent3D.tsx (seated voxel figure, typing/breathing, bubbles), office3d.css.
- Bubbles (user decision): only the dialogue bar's current speaker gets one (App passes
  `dialogue.line` + `showThoughts`). Speech = white box w/ tail; thought cloud above it when thoughts on.

- Pass 2: nav.ts waypoint graph (aisles auto-chained by z, Dijkstra, no lib). Office3D maps each
  agent's latest TickRecord (App passes `records={latest}`, `speed={sim.speed}`) to a Behaviour:
  work=desk typing; overwork=red shirt+sweat+desk lamp; slack_off=sofa or cooler; complain/gossip/
  verify=walk behind target's chair (grr/psst/? tag, else coffee/meeting); leak=window+phone+blinking
  tag; interview=front path; quit=box, out the door, off along the pavement, monitor dark.
  Agents finish a walk and dwell 2 s before taking their newest behaviour (ticks outpace walking).

## Next
- Pass 3: restyle HUD for 3D (gold borders, sparkline, icon rail drawers, zoom buttons, compass?).
- Pass 4: perf at 1366×768, ASSETS_TODO.md / Higgsfield.

## Gotchas
- Test: VITE_VIEW=3d npm run dev. A stale 2D vite may own 127.0.0.1:5173; use the LAN IP if so.
- Real contract actions: work, overwork, slack_off, complain, gossip, verify, interview, leak
  (8, incl. interview). The brief's names differ; use shared/types.ts.
- Mock data flag is `VITE_USE_MOCKS=true` (no VITE_DATA). No Injector.tsx: inject UI is EventComposer.tsx.
- pnpm not on PATH: use `npx -y pnpm@9.15.0 ...`.
- Bubbles sit inside `.office-scene` (isolation: isolate) so the HUD always paints above them.
- Static world = 3 draw calls (solid/glow/glass). Add furniture as Box data in world.ts, not meshes.
- Font stays VCR OSD Mono (team switched to it in 31e17e0).
