---
date: 2026-06-29
title: "Auto-fill opt-out forms deferred to v2"
areas: [opt-out-drafts, matching-overlay]
topics: [webextensions, privacy, ux]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Discussed whether content scripts could auto-fill opt-out web forms on broker sites. Technically feasible, but auto-submitting crosses into CCPA authorized-agent territory, so full automation is out for v1. A "pre-fill assist" — fill fields, user clicks Submit — is the v2 target shape.

## Decisions / outcomes
- Auto-fill (fill + submit) is explicitly deferred past v1 due to authorized-agent obligations.
- Pre-fill assist (fill fields only, human submits) is the right v2 shape: stays out of authorized-agent territory, reduces friction without legal exposure.
- If v2 uses static per-broker selector mappings in `brokers.json`, the maintenance burden of site redesigns is a known cost; LLM-based discovery is the alternative (see `2026-06-29-local-llm-field-discovery`).

## Why
CCPA's authorized-agent rules require written authorization and impose verification obligations when a service acts on a user's behalf. v1 deliberately keeps the user as the sender (mailto:/eml/copy-paste). Auto-submitting a form would cross that line regardless of how the fields were found.

The "never inject PII into the DOM" constraint (prevents page scripts from reading it) also needs explicit revisitation before any fill-based approach ships — not a blocker, but not automatic.

## Alternatives considered
- Static per-broker field mappings in `brokers.json` + content-script fill: technically works but brittle (sites redesign forms without notice).
- Full auto-submit: rejected — authorized-agent obligations.

## Open questions / follow-ups
- See Q-003 for the localhost/CORS question that governs the LLM-based variant.
- When v2 design starts: decide between static selector mappings vs LLM discovery (see `2026-06-29-local-llm-field-discovery`).