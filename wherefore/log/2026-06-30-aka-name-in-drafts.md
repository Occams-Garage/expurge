---
date: 2026-06-30
title: "AKA name used in opt-out draft body"
areas: [opt-out-drafts]
topics: [data-model]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Opt-out drafts for AKA name-variant hits were always generated using the primary profile name. Brokers match removal requests against the name in the listing, so sending the wrong name would cause the request to fail. The fix: GET_DRAFT derives a modified profile substituting the AKA's first/last before calling buildDraft.

## Decisions / outcomes
- GET_DRAFT handler in background.ts checks `hitItem.nameVariant`. If it starts with `aka_`, it looks up `profile.also_known_as[idx]`, splits on the first space into first/last, and passes a shallow-cloned profile with those values to `buildDraft`.
- Primary hits (nameVariant === 'primary') use the profile as-is — no change.
- All other fields (city, state, age, etc.) remain from the primary profile since opt-out templates use those for matching too.

## Why
A broker listing shows "Hilary Fisher" — the opt-out email must say "my name is Hilary Fisher," not "Dustin VanKrimpen." Sending the primary name when the listing is an AKA would fail the broker's identity match and likely result in no removal.

## Alternatives considered
- Store separate profiles per name variant: rejected — over-engineered. The AKA is just a first/last override; all other fields stay the same.

## Open questions / follow-ups
- None.
