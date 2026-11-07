# The Daily Grind UI overhaul

Implemented against `ui-overhaul-prompt.md`, with the subsequent reference-image update for the icon dock and visible stock price. Desktop is the acceptance scope; mobile was explicitly excluded by the user.

## Design

The pixel-art office fills the game window. The forest, timber floors, sprites and existing palette are preserved. Pixelify Sans stays in the artwork and clock; Space Grotesk is used for controls, dialogue and metrics. The initial view has a single clock, two Office wire entries, four square icon buttons centred on the left edge, and a CHAOS stock-price button at the top right. The icons open Simulation, Shake office, Rumour reach and Wellbeing; hover tooltips and accessible names identify each action. Expanded tools use quiet forest-coloured panels.

## Changes and ownership

- `App.tsx` composes the viewport, feed, contextual employee details and mutually exclusive tools. Dashboard sections, roster, resignation leaderboard, billboard and decorative footer are removed.
- `index.css` preserves the original room artwork and fits the three floors to the available desktop viewport. It styles the compact overlays, focus states and internally scrolling panels.
- `design/Office.tsx` retains all eight selectable sprites and connects the pressure marker to the existing stress threshold. Statements stay available in full in employee details.
- `GamePanel.tsx` implements a 348px contextual employee panel, viewport clamping, labelled metric bars, native modal menus, explicit keyboard focus wrapping, dismissal and focus restoration.
- `Workday.tsx` retains the existing day/hour mapping and provides the single compact clock, playback button and speed controls. `Controls.tsx` moves duration, advance, reset and new run to Simulation.
- `Company.tsx` supplies the separate Wellbeing and Rumour reach views, plus Reveal truth. Stock is removed from those views. `StockPrice.tsx` displays the live CHAOS price and opening percentage on the game window; clicking it opens `StockChart` in an exclusive graph dialog with the same dismissal and focus handling as the tools.
- `EventComposer.tsx` retains all seven presets, truth selection, submission feedback and errors, with functional hour-based copy.
- `announcement.ts` owns a replaceable 10-second wall-clock timer. `useSimulation.ts` calls it only for accepted new streamed frames. Initial/reconnected history does not notify; resets and new runs clear pending timers. No API schemas, simulation rules or server implementation changed.
- `hudModel.ts` projects feed records and simulation thresholds into display text. Each resignation replaces its action row, so it occurs once. History remains available in Office wire. Player-facing text uses hours and the original day/time mapping.
- `hud.test.ts` adds timer lifecycle, feed, metric-boundary and display-copy regression checks. `scripts/verify-ui.mts` provides browser acceptance checks with fixture-only API calls. `index.html` uses the game title.

## Verified

| Requirement | Evidence |
| --- | --- |
| 1440×900, 1366×768, 1280×720 | Chromium screenshots reviewed; document scroll dimensions equal viewport dimensions at every size. |
| All three floors and eight employees visible and selectable | Each sprite is inside the viewport, passes a pointer hit test, and opens its own employee panel at every desktop size. |
| Menus remain over the office; only one open | Browser checks for all four tools; office remains rendered behind each dialog. |
| Reference icon dock | Four icon-only square buttons match the reference order and are vertically centred at the left at every desktop size. |
| Visible stock price | CHAOS button remains at the top right; a streamed price of $63.45 is displayed with −36.55% and opens the graph at the same price. Stock is absent from Wellbeing and Rumour reach. |
| Escape, outside click, close button | All three dismissal paths checked for each menu and the standalone stock graph. Focus returns to its trigger. |
| Preserved controls | Browser checks confirm duration, advance one hour, reset, new run, speed and Play use their existing API endpoints and payloads. |
| Keyboard access | Initial focus, forward/backward focus wrapping in menus, keyboard scrolling of employee details, Escape and return to the selected sprite checked. |
| Employee details | 348px width, viewport bounds, name, role, action, dialogue, four labelled bars, values and status text checked. Long content scrolls inside the panel. |
| Announcement timer | Unit tests and a controlled browser clock verify visible at 9,999ms and dismissed at 10,000ms while playback is paused. |
| Replacement and dismissal | Replacing an announcement restarts the full duration. Manual dismissal cancels its timer. |
| Reset and reconnection | Reset clears notification state and timer; reconnect history neither replays historical announcements nor restarts the current notification timer. |
| Feed and resignations | Historical announcements remain accessible; a resignation produces exactly one feed entry. Actions retain highlight and inspect interactions. |
| Composer | Preset selection, default truth selection, successful API payload and queued feedback, and server-error feedback checked. |
| Rendered copy | Visible text, tooltips, accessible labels and meter descriptions checked in the game and all menus for forbidden engine terminology. Charts, feed times, queued messages and errors use hours/day/time. |
| Real server connection | Read-only browser session loaded eight employees over the real local SSE connection with no page overflow, notification replay or browser exceptions. |
| Build and tests | Production build passes. All 140 existing server and UI tests pass, including the SSE socket test. |

## Reproduce

From `office-sim`:

```sh
npm run build
node --import tsx --test 'server/**/*.test.ts' src/hud.test.ts
```

Start the Vite client, then run the desktop browser harness using a locally available Playwright installation:

```sh
node --import tsx scripts/verify-ui.mts
```

The harness accepts `PLAYWRIGHT_MODULE` (module name or absolute module path), `CHROMIUM_EXECUTABLE`, `UI_URL` and `UI_ARTIFACT_DIR`. Screenshots default to the operating system temporary directory under `daily-grind-ui`. API requests and EventSource messages use fixtures; this harness does not advance or reset the real server.

No outstanding desktop acceptance failures. Browser automation was run in Chromium; other browser engines were not included in this verification.
