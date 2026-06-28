---
date: 2026-06-28
title: "Firefox mobile deferred to v2"
areas: [run-model, opt-out-drafts]
topics: [webextensions]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Firefox mobile (Android) is deferred to v2. The v1 engine (dataset, matcher, storage, signing, draft generation) is built portable so mobile is an additive layer, not a rebuild. What needs a mobile-specific design is the run/confirm UX; deferral protects the desktop decisions from being reopened prematurely. See also: 2026-06-28-run-model-mechanics.

## Decisions / outcomes
- Firefox mobile: deferred to v2. Firefox-only desktop for v1.
- Engine built portable in v1 (pure JS, WebExtensions APIs, storage); mobile is an additive UI layer when it comes.
- Desktop run model **stands unchanged** — batched-parallel-tabs, overlay ergonomics from the run-model branch are NOT reopened. Deferral protects those decisions.
- Mobile will likely need: sequential one-site-at-a-time flow (not batched tabs); overlay must be thumb-reachable without covering content. Left for the v2 design branch.
- **Phantom-requirement cleanup**: the mobile-specific `.eml`-fallback guardrail (fall back off `.eml` on mobile) is NOT built in v1 — mobile doesn't exist in v1. Recorded to prevent premature build.
- `mailto`'s justification was partly mobile-motivated, but the decision stands on its desktop merits regardless.

## Why
The confirm/run UX is the most iteration-heavy part of the product. Designing it for two interaction shapes simultaneously (desktop parallel-tabs, mobile sequential-single-site) risks compromising both. Deferral lets the desktop UX be designed and iterated cleanly. The engine is portable by construction — deferral costs nothing architecturally.

## Alternatives considered
- Design for mobile from v1: rejected — confirm UX is the hardest design problem and benefits most from single-shape focus first.

## Open questions / follow-ups
- Mobile confirm UX design (sequential flow, thumb overlay) deferred entirely to v2 branch.
