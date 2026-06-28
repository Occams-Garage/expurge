---
date: 2026-06-28
title: "Persistence inverted to opt-in, ephemeral by default"
areas: [profile, run-model]
topics: [privacy, data-model]
stories: []
status: active
supersedes: 2026-06-28-run-model-storage-coverage, 2026-06-28-run-model-mechanics
superseded-by:
superseded-date:
---

## Summary
This reverses the initial spec (stored-by-default with a delete escape hatch). Default is now ephemeral: nothing persists across a browser close unless the user opts in. Three independent opt-in toggles replace the single storage default. Run state still survives MV3 spindown for everyone, but cross-session resume requires the profile-storage opt-in. This is a no-asterisk promise: out of the box, expurge persists nothing and transmits nothing. Corrects storage claims in 2026-06-28-run-model-storage-coverage and 2026-06-28-run-model-mechanics.

## Decisions / outcomes
- **REVERSAL of initial spec**: default is ephemeral. Persistence is opt-in, not opt-out-of-delete.
- **Three independent opt-in toggles, all default off:**
  1. **Profile storage** ("remember my info on this device"): profile in-memory by default, gone at browser close. Opt-in → stored in `storage.local`. OS-protected, NOT extension-encrypted in v1 — do not imply encryption; passphrase-at-rest is a clean v2 upgrade scoped to this toggle. This toggle also enables cross-session run resume (resume needs the profile to exist).
  2. **Run metadata** (per-broker: last-checked date + last result, no PII): separate lighter opt-in; offered after the first run when the concept is concrete; framed with its privacy boundary inline. Deliberately kept separate so a user can have progress-memory without storing their identity.
  3. **Rich hits/drafts history**: session-scoped for ephemeral users; persists only under the profile-storage opt-in.
- **Run-state scope (reconciliation)**: ephemeral ≠ run state can vanish mid-session. MV3 event page spin-down is always survived (session-scoped run state, in storage). Browser close is survived only under the profile-storage opt-in. Ephemeral users get a session-scoped run; opt-in users get cross-session resume.
- **One intentional data-exit point, disclosed proactively**: data leaves the device only when the user sends an opt-out request (that's the purpose, not a leak). Stated plainly, not discovered. Run metadata never transmitted regardless of toggle. "Store locally" must never become "send us."
- **Consequence for re-verification signals**: the in-the-wild drift signal (from observed `load_error`/`challenge` skips) only comes from opt-in-metadata users who choose to report it. No silent telemetry, ever.
- **Export/import**: v1 feature, but now applies to opt-in users only (ephemeral default has nothing to export).

## Why
A tool that helps people not be stored elsewhere shouldn't store them by default without asking. Stored-by-default requires a delete escape hatch, which mirrors broker UX. Ephemeral-by-default requires an explicit save, which mirrors what the tool is philosophically about. Three independent toggles matter because the privacy boundaries are genuinely different: storing profile identity is a different decision from storing per-broker metadata. Conflating them forces a false choice.

## Alternatives considered
- Stored-by-default with delete escape hatch (original spec): reversed — it's the same posture as the brokers and requires burying the delete option somewhere.
- Single "remember everything" toggle: rejected — lumps identity storage with metadata storage; a user can reasonably want one without the other.

## Open questions / follow-ups
- Passphrase-at-rest for profile storage: clean v2 upgrade, scoped to this opt-in, no schema migration needed.
