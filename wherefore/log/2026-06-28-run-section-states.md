---
date: 2026-06-28
title: "Run section: four states, pause/stop controls, one-row-per-broker monitor"
areas: [run-model]
topics: [webextensions, ux, data-model]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

CORRECTION 2026-06-30: pause/resume was dropped; run control is stop-only. See 2026-06-30-stop-only-run-control. The rest of this entry (four states, monitor, pacing, badge) remains accurate.

## Summary
The Run section of the options page moves through four states: welcome/pitch (no profile), ready (profile set, no active run), active (run in progress), and done (run complete). Pause and stop are first-class controls during active runs. The run monitor shows one row per broker with AKA variants folded in. See also: 2026-06-28-ux-architecture, 2026-06-28-run-model-mechanics.

## Decisions / outcomes

### Four Run section states

Welcome/pitch state (no profile set):
- Shown on first open (via onInstalled) and any time no profile exists.
- Content: brief pitch (what expurge does, why it's safe, what happens next), single CTA: "Set up your profile →" which navigates to the Profile section.
- No form in the Run section. Getting people to fill in their profile is a separate task; the Run section does not duplicate it.

Ready state (profile set, no active run):
- Shows profile summary (first, last, city, state; no sensitive fields displayed, but confirmation of what's set).
- "Start run" button. No auto-start.
- If a prior run exists: shows a link to Results and a "Run again" option (which starts a new run, not a resume).

Active run state:
- Run monitor (see below) fills most of the section.
- Pause button: stops opening new batches; current open batch finishes naturally. Run stays in a paused state until manually resumed. Does NOT auto-unpause when the batch clears. "Stay paused" is the correct semantics.
- Stop button: marks all `open` and `pending` items as `skipped/run_stopped`. Shows "Close open tabs?" confirmation inline (not modal). The run is over; there is no resume from a stopped run.
- Progress indicator: "N of M checked" (N = verdicted + skipped, M = total items).

Done state:
- Summary: "Found on X sites. Not found on Y. Z couldn't be checked." (uses broker-units, not item-units for AKA fan-out).
- "View Results →" navigates to Results section.
- "Run again" button: starts a new run with the current profile (not a resume). Useful for re-checking after a first run with incomplete permissions or after time has passed.
- Low-key dataset update notice if auto-update is disabled (see 2026-06-28-first-fetch-consent).
- Contextual banner for persistence opt-ins shown first time a user reaches the done state with specific hit/history data to preserve (see 2026-06-28-persistence-inversion).

### Run monitor (active state)
- One row per broker, not one row per work item. AKA name-variants for a broker are folded into the broker's row (e.g., "TruePeopleSearch · 3 variants" with sub-status on hover or expand).
- Status per row: pending / checking (open) / hit / clear / unknown / skipped (with reason).
- Rows ordered: currently checking first, then pending, then completed.
- No scrolling in the monitor during a small run; if broker count exceeds viewport, the list scrolls. No "current batch only" view. The full list is always visible.

### Pacing defaults
- Default batch size: 5 tabs open at once.
- Next batch does not open until the current batch is fully cleared (every item verdicted, skipped, or parked).
- No configurable pacing in v1: batch size is a fixed internal constant, not a user setting.

### Badge (toolbar icon)
- During active run: hit count shown as a badge integer.
- Zero hits: no badge (blank, not "0").
- Run complete: badge clears (returns to no badge state).
- The badge is the only popup-visible indicator during a run; it's informational, not actionable.

## Why
Four distinct states prevent the Run section from being a blank page before a profile exists (welcome/pitch fills that gap) and from showing a stale "Start run" after a run completes (done state is visually distinct). Pause/stop as first-class controls are necessary for the no-wedge rule: a user who is overwhelmed or who spots a problem needs a way to intervene without closing the browser. "Stay paused" is the correct behavior for pause (not "auto-continue when batch clears") because the user paused for a reason. One row per broker keeps the monitor scannable at 25 brokers without requiring the user to understand the AKA fan-out model.

## Alternatives considered
- Start run from popup: rejected. The profile form is not in the popup; a run can only be started after profile setup, which belongs in the options page.
- Per-AKA-variant rows in monitor: rejected. Too many rows for a user who has multiple AKA entries; folds into the broker row instead.
- Auto-unpause when batch clears: rejected. Users who pause are pausing for a reason; auto-unpause defeats that.

## Open questions / follow-ups
- None.
