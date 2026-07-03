---
date: 2026-06-30
title: "AKA name used in opt-out draft body"
areas: [opt-out-drafts]
topics: [data-model]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
Opt-out drafts for AKA name-variant hits were always generated using the primary profile name. Brokers match removal requests against the name in the listing, so sending the wrong name would cause the request to fail. The fix: GET_DRAFT derives a modified profile substituting the AKA's first/last before calling buildDraft.

## Decisions / outcomes
- GET_DRAFT handler in background.ts checks `hitItem.nameVariant`. For AKA hits it passes a shallow-cloned profile carrying the first/last resolved at run time and frozen on the WorkItem (`hitItem.variantFirst` / `hitItem.variantLast`) to `buildDraft`. It does NOT re-parse the mutable `also_known_as` list. (`also_known_as` is now structured `AkaName[]` with separate first/last, so there is no split-on-space; the earlier "look up `also_known_as[idx]`, split on the first space" mechanism is superseded; see 2026-06-30-aka-structured-name-fields.)
- Primary hits (nameVariant === 'primary') use the profile as-is, no change.
- All other fields (city, state, age, etc.) remain from the primary profile since opt-out templates use those for matching too.

## Why
A broker listing shows "Hilary Fisher": the opt-out email must say "my name is Hilary Fisher," not "Dustin VanKrimpen." Sending the primary name when the listing is an AKA would fail the broker's identity match and likely result in no removal.

## Alternatives considered
- Store separate profiles per name variant: rejected. Over-engineered: the AKA is just a first/last override; all other fields stay the same.

## Open questions / follow-ups
- Updated 2026-06-30: the draft mechanism was revised by the structured-names work: the
  AKA name now comes from the frozen `variantFirst`/`variantLast` on the WorkItem and
  `also_known_as` is structured `AkaName[]`. The decision (use the AKA's name in the draft,
  not the primary) is unchanged. See 2026-06-30-aka-structured-name-fields.
