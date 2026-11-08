# Prompt: Overhaul the office simulation UI

Rebuild the existing UI around one principle: **the office scene is the game; everything else supports it.** Implement the overhaul, preserving the simulation behaviour, backend contracts, and existing pixel-art office style.

## Layout and hierarchy

- Make **Agentic Chaos** fill the browser viewport. Use the available width and height, keeping all three office floors and every character visible and clickable.
- Eliminate page scrolling in both directions. Resize the scene responsively rather than cropping it or hiding overflowing controls.
- Keep the office visible behind secondary interfaces. Submenus and expanded history may scroll internally.
- Replace the dashboard layout with compact overlays and button-accessed menus. Remove the large header, standalone timeline, bottom sections, and decorative footer.
- Preserve the pixel artwork and palette. Use readable text for controls and metrics; avoid oversized headings, excessive borders, and dashboard cards.

## Game overlays and menus

**Time and controls**

- Place a small, transparent time overlay at the top centre of the game window. Show the day and clock time once.
- Remove the large workday progress section and duplicated clocks.
- Keep Start/Pause and speed controls compact near the clock.
- Put duration, advance-one-hour, reset, and new-run controls in a **Simulation** submenu.

**Office wire**

- Position a compact event feed in the **top-left corner**, over the scene.
- Show the latest few entries, newest first. Provide an expand/collapse control for internally scrollable history.
- Include actions, announcements, rumours, and resignations in this feed.
- Remove **Who cracks first?** entirely. Resignations already appear in the feed: retain those entries without introducing duplicates.
- Preserve feed interactions that highlight or inspect relevant employees.

**Announcements**

- Replace the persistent billboard with a compact notification near the top centre, below the clock.
- Display newly received announcements for **10 seconds**, then dismiss them automatically. Include a close button.
- Use elapsed real time for dismissal, including while the simulation is paused.
- If another announcement arrives, replace the visible notification and restart its timer. Preserve every announcement in Office wire.
- Do not replay historical announcements on initial load or reconnection. Clear notification state and timers on reset.

**Secondary tools**

- Add a compact bottom-right menu with clearly labelled buttons:
  - **Shake office:** opens the existing event composer, retaining presets, truth selection, submission feedback, and error handling.
  - **Company:** opens wellbeing, rumour-reach, and stock information.
  - **Simulation:** opens run settings and secondary controls.
- Move Reveal truth into the relevant submenu.
- Open only one secondary menu at a time. Support closing with Escape, a close button, or an outside click.
- Keep the default scene uncluttered and avoid positioning overlays over employee interaction targets.

## Employee details and metrics

- Remove **The people** section and its roster cards. Access employee details by selecting characters in the office.
- Replace the large centred inspector with a compact contextual panel, approximately **320–360px wide** on desktop and constrained to the viewport on smaller screens.
- Position it near the selected employee where space allows; clamp it within the game window.
- Show name, role, current action, public statement, private thought, and metrics. Keep long content inside the panel with internal scrolling.
- Make metrics immediately understandable:
  - Use full labels: **Stress, Burnout, Trust in management, Workload**.
  - Show a consistent bar, numeric value out of 100, and a short status label.
  - Make the direction clear: high stress, burnout, and workload indicate pressure; high trust is favourable.
  - Combine colour with text so meaning does not depend on colour alone.
  - Derive statuses from actual values and existing simulation thresholds. Do not invent a separate loyalty metric or change simulation rules.
- Preserve keyboard access and visible focus. Use correct focus handling for popovers and modal menus.

## Copy requirements

- Remove every player-facing mention of **tick/ticks**, including tooltips, chart axes, accessible labels, queued-event messages, and displayed errors.
- Present simulation progress as day/time or duration in hours, using the existing time mapping. Internal identifiers and API fields may remain unchanged.
- Remove decorative slogans, filler, section subtitles, and theatrical placeholder copy. Examples include “One very long workday,” “Every little action leaves a trace,” and “A public face. A private breaking point.”
- Use short, functional labels and factual states such as **No events yet**, **Paused**, **Queued**, and **Connection lost**.
- Preserve meaningful simulation dialogue and event content. Remove UI filler without stripping the game’s actual narrative.
- Keep technical diagnostics in the Simulation submenu.

## Verification and completion

- Check desktop layouts at **1440×900, 1366×768, and 1280×720**, plus a narrow mobile viewport.
- Confirm there is no page scrolling, the whole office remains visible, and every character is selectable.
- Verify menu dismissal, keyboard navigation, compact employee details, and readable metric states.
- Verify announcement dismissal after 10 seconds, replacement, manual dismissal, reset cleanup, and reconnection behaviour.
- Confirm resignations appear once in Office wire and historical events remain accessible.
- Audit all rendered copy, tooltips, and accessible labels for tick terminology and unnecessary filler.
- Run the existing build and relevant tests. Report the changes, verification results, and any remaining limitations.
