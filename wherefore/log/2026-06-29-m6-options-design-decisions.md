---
date: 2026-06-29
title: "M6 options page design tradeoffs"
areas: [run-model, opt-out-drafts, coverage-report]
topics: [ux, webextensions, data-model]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Grilling session on the M6 options-page and popup-redesign implementation surfaced six intentional design tradeoffs, all accepted for M6 with clear deferral points. See also: 2026-06-29-m6-grilling-bugs (bugs found in the same session).

## Decisions / outcomes
- **2s full-rebuild polling**: broker table in Run section rebuilds from scratch every 2s during active run. Diffing deferred — ≤25 broker rows, no interactive elements inside table rows, DOM replacement has no UX consequence.
- **Results mid-run re-render**: poll re-renders Results section if visible, collapsing open draft panels. Acceptable edge case — expected flow is run → complete → view results; polling stops on completion so panels are only at risk during a small mid-run window.
- **Mark-as-sent is one-way**: after clicking "Mark as sent", draft panel is inaccessible and there is no undo. Draft is deterministic (same profile + channel = same output); mail client Sent folder is the actual record.
- **Run again resets optedOutAt**: starting a new run creates fresh WorkItems with no prior sent marks. Session-only `optedOutAt` was never going to survive a browser restart; per-run history belongs in M8 persistence opt-ins.
- **Export uses `saveAs: true`**: shows OS Save As dialog. EML downloads use `saveAs: false` (routine workflow step); export is a deliberate archival act that warrants letting the user choose destination.
- **DELETE_ALL leaves orphaned broker tabs open**: enumerating tab keys and calling `tabs.remove()` deferred to M8 with the rest of session-cleanup work.

## Why
All six are "simple now, improve later" calls. The options page first reaches real users in M9 alongside the full broker dataset. Diffing, undo, or tab-cleanup before that ships optimises prematurely — the tradeoffs are bounded by the single-broker prototype dataset M6 runs against.

## Alternatives considered
- DOM diffing for broker table rows: rejected — more code, no visible benefit with ≤1 broker in the current dataset.
- Undo for mark-as-sent: rejected — draft is reproducible from stored profile + broker state; the authoritative send record is in the user's mail client.

## Open questions / follow-ups
- None.
