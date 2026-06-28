---
date: 2026-06-28
title: "Run model, overlay UX, and storage"
areas: [run-model, coverage-report]
topics: [webextensions, data-model]
stories: []
status: superseded
supersedes:
superseded-by: 2026-06-28-persistence-inversion
superseded-date: 2026-06-28
---

SUPERSEDED 2026-06-28 -> see 2026-06-28-persistence-inversion. Storage defaults reversed (ephemeral by default, opt-in to persist). Kept for history, not current.

## Summary
v1 run model is open-and-confirm with an on-page overlay: extension opens broker tabs in paced batches, content scripts inject an overlay for user verdicts, background script collects results. Storage is `browser.storage.local` — local-first, never transmitted. Several sequencing and messaging details remain open.

## Decisions / outcomes
- Broker tabs opened in paced batches (default 5, tunable) — avoids wall-of-tabs and single-at-a-time slog.
- Content script: reads DOM, runs deterministic matcher, injects overlay (match summary + confidence + confirm/clear/skip).
- Verdicts messaged from content script back to background script, stored in hits store.
- Hits keyed by runs so re-checks stack over time. Outcomes from closed set: `hit | clear | unknown | skipped (with reason)`.
- `matched_as` on each hit (which name variant produced the hit).
- Drafts generated in JS, saved via `downloads` API or `mailto:`. Extension never touches attachments.
- Storage: `browser.storage.local`. Profile and hits never transmitted.
- Export/import is a v1 feature (storage is browser-profile-bound; users need portability to back up and migrate).
- Coverage report counts brokers (not fan-out searches). Shows checked/listed/clear/couldn't-tell + not-checked breakdown with actionable nudge (e.g. "add ZIP to cover 7 more").
- Not-checked breakdown: missing-info, unverified, broken, "available but not enabled" (ungranted domains).

## Why
Paced batches balance speed against looking like a flood. The deterministic matcher keeps results reproducible and confidence scores meaningful. Local-only storage is the privacy guarantee. Export/import is a functional requirement, not a nice-to-have: without it, losing or migrating the browser profile loses all run history.

## Alternatives considered
- ML/LLM extraction for messy result pages: deferred to v2 (see Q-003). Extension-to-localhost reachability needs confirmation before committing.

## Open questions / follow-ups
- Q-001: Tab-open sequencing and trigger, content-script ↔ background messaging contract, behavior when user closes a tab mid-run, challenge-page detection and graceful handling.
- Q-003: Can an extension reach `http://localhost:11434` (Ollama) for local-LLM extraction? Needs localhost host permission and Ollama CORS config. Deferred to v2, but viability needs confirming before committing to the design.
