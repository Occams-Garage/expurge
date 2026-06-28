---
date: 2026-06-28
title: "Channel trust: three-value enum, not boolean"
areas: [broker-dataset]
topics: [verification, data-model]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The channel trust field is a three-value enum (`trust: unverified | verified | broken`), not a boolean. `broken` preserves provenance on a once-verified channel that later failed — distinct from `unverified` (never checked). Channel-level `trust: broken` (opt-out path failed) is explicitly distinct from broker-level `status: broken` (search URL failed): the two failure modes have different causes, different fixes, and different owners. See also: 2026-06-28-broker-dataset-schema, 2026-06-28-verification-workflow.

## Decisions / outcomes
- `trust` field: three-value enum — `unverified | verified | broken`.
- `broken` = once verified, subsequently observed to fail. Preserves the verification history; the verifier's work is not silently erased.
- `unverified` = never checked. The two states are intentionally distinct in provenance.
- **Channel `trust: broken`** = opt-out path failed (wrong address, form gone, site changed). Lives on the channel.
- **Broker `status: broken`** = search URL failed (layout changed, page dead). Lives on the broker record.
- These are the two halves of the search-vs-optout split: intentionally separate.

## Why
A boolean `verified` collapses `broken` into `unverified`, erasing the distinction between "never checked" and "was good, something changed." That distinction matters for prioritization: a `broken` channel is an urgent re-verification task with known prior state; an `unverified` channel is a first-time verification task. Keeping the two `broken` fields separate (channel vs broker) enforces the earlier design principle that search and opt-out fail independently and should be tracked independently.

## Alternatives considered
- Boolean `verified`: rejected — `broken` collapses into `unverified`, losing provenance and re-verification priority.

## Open questions / follow-ups
- None.
