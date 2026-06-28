---
date: 2026-06-28
title: "Broker dataset schema design"
areas: [broker-dataset]
topics: [data-model, verification]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The broker dataset ships as JSON with an interface-agnostic schema. The engine is a generic substitution/instruction follower with zero broker-specific branching — the dataset is the only thing that grows. Two orthogonal status axes (operational and trust) are kept deliberately separate.

## Decisions / outcomes
- `id` is a stable slug, primary key, never changes after ship (hit records reference it).
- `status` (active | broken | disabled): operational toggle. Records never deleted; retiring = `disabled`.
- `tier` (1–3): drives ordering and future filters; tier 1 checked first.
- `search.url`: template with `{placeholder|transform}` tokens. Most fragile field; quarantined by `broken` status.
- `search.requires[]`: missing any field → skip with reason `missing:<field>`, feeds coverage nudge.
- `search.exposes[]`: descriptive only, never gates anything.
- `optout`: ordered list of channels (list position = preference, no explicit order field).
- `channel.kind` (`dedicated_optout | general_contact | form_required`): safety field preventing silent fallback to `sales@` inboxes.
- `channel.verified / last_checked / source`: verification is **per-channel**, not per-broker.
- Two status axes kept separate: `status` (attempt or not) vs channel `verified` (act or not).
- Transforms: small fixed lookup table (`slug`, `q`, `upper`, raw default). Not a templating language.
- `matched_as` on hit records (which name variant produced the hit).

## Why
Interface-agnostic schema means no broker-specific code paths; adding a broker is a data change only. The two-axis status separation is intentional: a broken search URL shouldn't imply a broken opt-out channel — the two concerns fail independently. `kind` is a safety field, not a convenience: a wrong opt-out address mails PII to the wrong inbox.

## Alternatives considered
- Single status field covering both operational and trust: rejected because the two axes fail independently and must be toggled independently.

## Open questions / follow-ups
- None.
