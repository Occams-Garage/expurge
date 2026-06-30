---
date: 2026-06-30
title: "Run control is stop-only; pause dropped"
areas: [run-model]
topics: [ux, webextensions]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The original M6 run-control design (2026-06-28-run-section-states, 2026-06-28-ux-architecture) specified **pause/resume** alongside stop as first-class run controls. The shipped implementation has **stop only** — there is no pause/resume in the code (`STOP_RUN` exists; no `PAUSE_RUN`). This entry records that stop-only is the accepted design, not an unfinished implementation. Corrects the pause portions of those two entries.

## Decisions / outcomes
- **Stop is the only mid-run control.** `STOP_RUN` marks all `open` + `pending` items as `skipped` / `run_stopped`. There is no resume from a stopped run; restarting is a fresh "Run again".
- **No paused state.** The run state machine has no paused status; the background coordinator does not have to persist/rehydrate a "paused" flag across MV3 event-page spindown.
- Pause/resume is not deferred to a later milestone — it is dropped from the plan.

## Why
Pause's original justification (run-section-states §Why) was the no-wedge rule: "a user who is overwhelmed or who spots a problem needs a way to intervene without closing the browser." Stop already satisfies that — the user can intervene at any time without closing the browser. Pause added a persistent paused-state to the run state machine (must survive event-page spindown, must not auto-unpause when the batch clears) for marginal benefit over stop + "Run again". Removing it simplifies the coordinator with no loss against the requirement that motivated it.

## Alternatives considered
- Keep pause/resume as specified: rejected — extra state-machine complexity (durable paused flag, "stay paused" semantics, resume path) for a capability stop + "Run again" already covers.

## Open questions / follow-ups
- None. Corrects: 2026-06-28-run-section-states, 2026-06-28-ux-architecture (pause portions only; the rest of both entries remains accurate).
