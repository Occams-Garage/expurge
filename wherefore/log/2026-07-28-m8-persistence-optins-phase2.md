---
date: 2026-07-28
title: "M8 persistence opt-ins Phase 2 implemented"
areas: [profile, run-model, coverage-report]
topics: [privacy, data-model, ux, testing]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Implemented Phase 2 of the opt-in persistence model: lifecycle-aware current-run storage,
PII-free run metadata, the rich-history choice, and contextual one-time offers. The default
remains ephemeral, and no cross-run history archive was added.

## Decisions / outcomes
- Completed runs persist only when profile storage and rich history are both on. Incomplete runs
  may persist under profile storage for cross-session resume.
- Run metadata remains independent of profile storage and stores only broker id, stable completion
  time, and a closed-set result. Its writes cannot wedge run advancement.
- All three storage choices are reflected in Settings. Rich history remains normalized off without
  profile storage, while run metadata remains independent.
- Profile, Run done, and Results offers inform only. They mark seen on visible render, navigate and
  focus the matching Settings control, and persist exactly three non-sensitive seen booleans.
- Preference, metadata, and prompt state converge across options tabs with stale-read guards.
  Delete all resets the durable keys and page-local mirrors.
- Automated verification passed: typecheck, 330 tests, coverage (98.99% statements, 100% lines),
  build, and extension lint (zero errors, 12 warnings). Each implementation slice received a
  separate review and fix pass.

## Why
Run metadata, profile identity, and full results have different privacy boundaries, so they remain
separate choices. Lifecycle-aware routing preserves resume without retaining completed rich data
unless the user explicitly chose it. One-time contextual offers explain those choices without
turning an informational banner into consent.

## Open questions / follow-ups
- The manual Firefox matrix remains pending: ephemeral default, restart/resume, toggle migration,
  metadata backfill and purge, cross-tab convergence, banner focus/dismiss behavior, import, and
  Delete all.
- Q-014 remains open; automated unit/build checks do not replace Firefox runtime verification.
- See also: 2026-06-28-persistence-inversion and 2026-07-27-m8-persistence-optins-build.
