---
date: 2026-06-28
title: "Drift detection: time-only in v1, failure deferred"
areas: [broker-dataset]
topics: [verification]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
Time-based expiry (warn at 6 months, gate at 12) is the sole v1 re-verification trigger. The observed-in-the-wild failure trigger (load_error/challenge skips from the run model) moves to v2, leaning toward a user-initiated report button, activating alongside the trusted-verifier tier. Partially corrects 2026-06-28-verification-workflow, which described both triggers as v1 features.

## Decisions / outcomes
- v1 has one trigger only: time-based expiry. Self-contained; no report mechanism needed; keeps the dataset honest at 25 sites.
- v2 adds a failure trigger: observed skips (`load_error` / `challenge`) become reportable via a user-initiated report button. Activates alongside the trusted-verifier tier when re-verification volume grows.
- v2 leaning: user-initiated (not automatic) reporting, consistent with no-silent-telemetry principle.

## Why
Two triggers in v1 would require a report mechanism that doesn't exist yet. Time-based expiry alone is self-contained and sufficient for a 25-site dataset maintained by one person. The failure trigger is the stronger signal, but implementing it correctly requires a report surface, data-handling decisions, and trust decisions about which reports to act on, all of which are better designed alongside the trusted-verifier tier they activate. Keeping v1 to one input (time) and one output (expiry gate) keeps the verification model atomic and auditable.

## Alternatives considered
- Both triggers in v1: rejected. Failure reporting needs infrastructure (report surface, trust model for submitted data) better co-designed with the verifier tier.

## Open questions / follow-ups
- v2 failure reporting design (report button shape, what data it sends, how maintainer processes it) deferred entirely.
