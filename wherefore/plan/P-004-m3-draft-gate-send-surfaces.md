---
id: P-004
title: "M3: draft gate + three send surfaces"
status: done
created: 2026-06-28
updated: 2026-06-28
area: opt-out-drafts
topics: [verification]
milestone: M3
decision_ref: 2026-06-28-verification-draft-gate, 2026-06-28-draft-send-mechanism, 2026-06-28-email-templates
---

Retroactive record of a shipped milestone: the draft path, gate plus output surfaces,
including the two M3+ extensions (listing-URL capture and the TPS form_required card).
Source: `plan/expurge-progress.md` (M3, M3+). Complete.

- [x] `evaluateGate()` / `channelExpiryState()`: draft only when confirmed hit AND channel `trust: verified` AND `last_checked` within 12 months (WARN_MONTHS=6, EXPIRE_MONTHS=12)
- [x] Channel selection: walk `optout[]` in order, take the first verified, unexpired channel
- [x] `buildDraft()` discriminated union (EmailDraft or FormDraft); three send surfaces: `mailtoUrl` / `toEml` / `toCopyText`
- [x] Two email templates: US general opt-out and CA CCPA (bodies flagged for Q-010 legal review)
- [x] M3+ listing-URL capture: results-page guidance panel, navigate-to-details flow, paste fallback, `listingUrl` in the draft body
- [x] M3+ TPS form_required opt-out: corrected channel record, `buildFormCard()` instruction card (fields table, walkthrough, open-form button)
