---
date: 2026-07-27
title: "M8 persistence opt-ins Phase 1 built"
areas: [profile, run-model]
topics: [privacy, data-model]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Built Phase 1 of the opt-in persistence model from 2026-06-28-persistence-inversion: the profile-storage toggle, cross-session run resume, the Settings Storage sub-section, and session import. M8 is delivered in two phases; run metadata, rich history, and first-exposure banners are Phase 2. An xhigh code review then drove a round of correctness and privacy fixes before the work was finalized.

## Decisions / outcomes
- Deliver M8 in two phases. Phase 1: profile-storage opt-in, cross-session resume, Storage settings UI, import JSON. Phase 2: run metadata, rich history, contextual first-exposure banners.
- Rich hits/drafts history is current-run-only. It gates whether the current run's hits and opted-out timestamps persist; no cross-run archive (deferred to v2).
- Route run/profile storage by the profile-storage flag: write-through to the active area with inactive-area cleanup, read-active-only, no fallback.
- Migrate on a toggle flip by populate-new-home, then flip the pref last, then purge the old home. Explicit-area IO, never the pref-routed saveRun.
- Resume is user-gestured (RESUME_RUN), never automatic. A pure rehydrateForResume reverts open and deferred items to pending and drops the dead windowId.
- Rehydrate a persisted run on both onStartup and onInstalled('update'). An in-place extension reload clears session storage but does not fire onStartup.
- Serialize GET_RUN_STATE against the write queue so a poll cannot read a mid-mutation snapshot.
- Import restores the profile only in Phase 1, validating the full profile shape before any write. Opt-in flags live under their own storage.local key, separate from the send-method pref. readStoragePrefs is fail-safe to the ephemeral default.

## Why
No-fallback reads are a privacy invariant: falling back to storage.local while opted out would resurrect data the user opted out of. Flip-the-pref-last makes a mid-migration crash safe, since the pref still points at the intact old home and any orphan is swept by the next write. GET_RUN_STATE had to be serialized because the resumable screen keys off zero open/deferred items, and an unserialized poll could catch the transient window between a verdict save and the next batch opening, wrongly offering resume; this is acute with a single active broker. Fail-safe prefs preserve the no-wedge rule: a storage.local error must not throw from a verdict write and leave the run un-acked.

## Alternatives considered
- Fall back to the inactive area on load, rejected: it resurrects opted-out data.
- Detect resume from run state alone without serializing reads, rejected: the transient mid-verdict state is indistinguishable from a post-restart run and the panel then stuck (it stops polling).
- Cross-run history in Phase 1, deferred to v2: keeps the rich-history flag a light per-run gate rather than a new data model.

## Open questions / follow-ups
- Phase 2 remaining: run-metadata persistence, current-run rich-history, first-exposure banners.
- Manual Firefox verification still needed for the IO/UI paths (no headless Firefox harness, Q-014).
- See also: 2026-06-28-persistence-inversion.
