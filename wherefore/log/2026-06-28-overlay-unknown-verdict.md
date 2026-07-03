---
date: 2026-06-28
title: "Four-button overlay with unknown verdict"
areas: [matching-overlay]
topics: [data-model]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
The overlay offers four verdicts: hit / clear / unknown / skip. `unknown` ("I looked and can't tell if it's me") is a real, distinct outcome that closes the orphaned-case gap and feeds a disambiguation nudge. This makes the age-not-DOB tradeoff recoverable. Corrects the three-button framing in 2026-06-28-page-classification (that entry says hit/clear/skip; the correct set is hit/clear/unknown/skip). See also: 2026-06-28-profile-model.

## Decisions / outcomes
- Four verdicts: hit / clear / unknown / skip.
- `unknown` = "I looked at the page and cannot determine if this listing is me." Distinct from `skip` (user chose not to look, or ran out of time).
- `unknown` verdicts feed a disambiguation nudge: "add your middle name or ZIP to narrow this down."
- `unknown` is a first-class outcome in the hits store and coverage report, not a variant of skip.
- This closes the age-not-DOB cost: common-name ambiguity that produces `unknown` becomes actionable rather than a permanent dead end.

## Why
Without `unknown`, a user who genuinely can't tell is forced to guess (polluting the hits store) or skip (losing the attempt). `unknown` captures the real epistemic state and routes it to a specific remedy. The disambiguation nudge is what makes the age-not-DOB design choice safe: ambiguous results have a path to resolution rather than an invisible ceiling on precision.

## Alternatives considered
- Three buttons (hit/clear/skip), with `unknown` collapsing into skip: rejected. Loses the disambiguation path; `unknown` has a specific remedy that skip does not.

## Open questions / follow-ups
- None.
