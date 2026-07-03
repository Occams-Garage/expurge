---
date: 2026-06-29
title: "M6 grilling: three bugs found"
areas: [run-model, opt-out-drafts]
topics: [webextensions, data-model]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
Grilling session on M6 found three bugs before the commit was made. All three are targeted fixes; no architectural changes required. See also: 2026-06-29-m6-options-design-decisions (design tradeoffs from the same session).

## Decisions / outcomes
- renderFormDraftInPanel missing MARK_SENT handler: form-card draft panel rendered a "Mark as submitted" button with no click handler. Fix: thread `brokerId` through `renderDraftInPanel → renderFormDraftInPanel`; wire handler mirroring the email draft's mark-sent block (sends MARK_SENT, updates toggle button to "Sent ✓").
- DELETE_ALL outside serialWrite: `session.clear()` ran outside the write queue. A concurrent VERDICT mid-flight could read run state, DELETE_ALL clears session, then VERDICT writes the mutated run back, resurrecting a deleted run. Fix: wrap `session.clear()` in `serialWrite`.
- Dead CSS in popup/style.css: form-card, draft-box, field-row, copy-area, and send-button styles remained after popup was stripped to a run-control-panel. Fix: remove dead classes; keep layout, wordmark, btn variants, run-progress, popup-actions.

## Why
All three caught before committing. The serialWrite race has a real (if narrow) window: VERDICT processing is async and multiple concurrent broker tabs make the interleaving plausible in a multi-broker run. The form-card MARK_SENT omission was a copy-paste gap between email and form render paths. Dead CSS is maintenance debt with no runtime impact but would confuse future edits to the popup stylesheet.

## Alternatives considered
- None. All three have single correct fixes.

## Open questions / follow-ups
- None.