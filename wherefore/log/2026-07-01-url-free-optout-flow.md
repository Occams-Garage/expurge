---
date: 2026-07-01
title: "URL-free opt-out: profile-nav friction (parked)"
areas: [opt-out-drafts, matching-overlay, run-model]
topics: [ux, data-model]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
Noticed that some brokers' opt-out forms (e.g. TruePeopleSearch's `/removal`) don't need the direct listing URL, so the run's "navigate to your profile page to confirm" step (which exists mainly to capture that URL) is pure friction for them. Weighed whether to lighten it; no change for now, parked as an open question.

## Decisions / outcomes
- No change: keep the current navigate-to-details confirm flow for all brokers (one uniform path). Revisit via Q-017.

## Why
The profile-navigation exists for two reasons (expurge-plan §7): capture the direct listing URL (many opt-out processes need it to identify the record) and let the user verify their full profile before confirming. Reason 1 doesn't apply to URL-free, self-service-removal brokers like TPS: for those the navigation is friction, not value. But changing it needs a per-broker "opt-out needs the listing URL?" signal plus a run-model branch (verdict buttons on the results page), and it isn't worth doing mid-stream. The opt-out itself is already decoupled (TPS is a `form_required` channel whose post-run instruction card points at `/removal`), so this is purely about run friction, not correctness.

## Alternatives considered
- Confirm on the results page for URL-free brokers (skip profile-nav + URL capture): the likely direction if picked up; keeps the coverage report.
- Skip the run's search entirely and send the user straight to `/removal` for such brokers: least friction, but loses coverage data and the "only opt out where listed" discipline; the removal form's own search largely duplicates the run's.

## Open questions / follow-ups
- Q-017: For brokers whose opt-out doesn't need the listing URL (e.g. TPS), should the run confirm on the results page (skip profile-nav) or skip its search entirely, vs the current navigate-to-profile flow?
