---
date: 2026-06-30
title: "Results page redesigned: broker-grouped layout"
areas: [coverage-report, matching-overlay]
topics: [ux, data-model]
stories: []
status: active
supersedes: 2026-06-28-results-section
superseded-by:
superseded-date:
---

SUPERSEDES 2026-06-28-results-section (four verdict-category groups replaced by broker-grouped layout). Kept for history, not current.

## Summary
Results page redesigned from four flat verdict-category lists (Listed / Couldn't tell / Skipped / Not found) to one collapsible section per broker site. Each section header shows hit/not-found/skipped counts and opt-out status; rows show all name variants. Three bugs fixed simultaneously: clear items from hit brokers were silently dropped; primary name rows had no label; unknown items had no re-verdict path.

## Decisions / outcomes
- **Broker-grouped layout**: one collapsible section per broker (expanded by default). Header shows: broker name, summary counts (`3 hits · 1 not found`), opt-out status (`not started` / `1/3 sent` / `all sent`). "Not checked" brokers at the bottom, collapsed.
- **All variants visible**: within each broker group, items are sorted hits → unknowns → clears → skipped. All name variants shown, no deduplication.
- **Primary name labeled**: `nameForVariant()` is used for every item row (including primary), which returns `"First Last"` for primary and the AKA string for AKA variants. The previous design only added a label for AKA rows.
- **brokersWithHit filter removed**: the old filter excluded clear items from brokers that had any hit — with only one broker in the dataset this made "Not found" permanently empty. No such filter in the new layout; every item appears in its broker group.
- **Unknown re-verdict inline**: "Couldn't tell" item rows show an "Open listing →" link (if `listingUrl` was saved) and Yes/No re-verdict buttons. Re-verdicting as hit moves the item to a hit row with a draft panel without re-rendering the whole page.
- **Mark-as-sent keeps panel accessible**: clicking "Mark as sent" or "Mark as submitted" updates the button label to "Sent ✓"/"Submitted ✓" and updates the broker group header opt-out status in-place, but the draft panel toggle remains clickable. This reverses the M6 decision in 2026-06-29-m6-options-design-decisions ("draft panel inaccessible after marking") — the panel is now re-openable in case of accidental marking.
- **Opt-out status header update**: `refreshBrokerGroupHeader()` updates only the header's status span after mark-as-sent, avoiding a full re-render that would close open panels.

## Why
The natural user question is "what happened with site X?" not "which sites hit me?" Broker grouping matches that mental model. Per-item rows are required because a user with multiple AKA variants may have separate hits on the same broker that each need their own opt-out request. The previous per-broker-dedup made those invisible. "Not found" invisible with one broker was a critical bug for testing — and wrong in production too. Unknown re-verdict avoids forcing the user to restart a full run just to reclassify one uncertain result. Panel re-access after mark-as-sent prevents accidental-click data loss: the draft is deterministic, re-sending is harmless, and no undo mechanism was ever built.

## Alternatives considered
- Keep verdict-category groups, fix filtering bug: rejected — the groups still don't answer "what happened with TruePeopleSearch?" and don't scale to multiple hits per broker.
- Re-render full page on mark-as-sent to update header: rejected — closes any open draft panels, bad UX when the user is mid-workflow.

## Open questions / follow-ups
- Q-012: Should multiple AKA tabs for the same broker site open simultaneously, or one at a time? See also: 2026-06-30-aka-name-in-drafts.
