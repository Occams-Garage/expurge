---
date: 2026-06-28
title: "User profile field model"
areas: [profile]
topics: [data-model, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The profile stores only raw atomic fields; derived fields are computed at runtime and never stored stale. Age (not DOB) is the v1 sensitivity choice. Derivation is pure formatting: it only composes atoms upward and never makes judgment calls.

## Decisions / outcomes
- Raw fields: `first`, `last`, `city`, `state` (required for any match); `middle`, `zip`, `age` (optional); `emails[]`, `phones[]`, `relatives[]`; `also_known_as[]` for former/maiden names and user-typed nicknames.
- Derived fields computed at runtime only: `name` (first+last), `name_full` (first+middle+last, collapses when no middle), `citystate`, `citystatezip`.
- Age, not DOB, for v1. DOB deferred.
- **Derivation purity rule**: pure deterministic formatting, composes atoms upward only, never decomposes, never makes judgment calls. Nicknames, "St." vs "Saint", maiden names → user-entered or resolved in the confirm step.
- `also_known_as` fan-out: each aka entry substitutes into the same broker's search template as an additional search. Coverage counts brokers, not name-variant searches. `matched_as` records which variant hit.

## Why
Storing a DOB is a worse honeypot than an age; age + city does almost all matching work at a fraction of the sensitivity. The derivation purity rule is the privacy tool's safety constraint: false negatives (missing a real listing) are more dangerous than false positives. Silent guesses in derivation cause false negatives. Common-name users in big metros will hit more "is this you?" ambiguity — the human resolves this in the confirm step, not the tool.

## Alternatives considered
- Store DOB: rejected for v1 (higher sensitivity, no precision gain worth it yet).
- Derived nicknames or "St." normalization: rejected (judgment calls belong to the user or confirm step, not derivation).

## Open questions / follow-ups
- None.
