---
date: 2026-06-28
title: "Two templates: US general and California CCPA"
areas: [opt-out-drafts]
topics: [verification]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Two body templates ship in v1: a general US opt-out/deletion template and a California CCPA template, auto-selected by the user's state. The California template was briefly cut mid-discussion (CA has DROP) and reinstated: expurge users are exercising CCPA rights on people-search sites that DROP doesn't cover. California users also get a DROP informational notice framed as complementary. Resolves Q-004. See also: 2026-06-28-verification-draft-gate, 2026-06-28-broker-subject-field.

## Decisions / outcomes
- **Two templates**: (1) general US opt-out/deletion; (2) California CCPA. Auto-selected by user's state.
- **California template kept**: people-search sites are frequently CCPA-covered even when not DROP-registered. A Californian using expurge is exercising CCPA rights on exactly the sites DROP doesn't reach.
- **DROP informational notice** for CA users: framed as complementary ("you may also want this"), not as a redirect away from expurge.
- **Per-broker and per-state templates rejected**: maintenance sprawl as broker and state count grow.
- Final state is two templates. (One-template intermediate was a mid-discussion reversal; not the decision.)

## Why
The key legal nuance: people-search sites are often CCPA-covered independently of DROP registration. DROP and CCPA are complementary opt-out paths, not alternatives. A generic template for CA users would miss the specific CCPA leverage they have against these sites. The DROP notice ensures Californians are aware of both paths without expurge having to navigate the legal distinction in the template text itself. The pre-launch verification task exists because this legal claim (25 sites × DROP registration status) must be confirmed before shipping CCPA framing.

## Alternatives considered
- Single generic US template: rejected — misses CCPA leverage for CA users who have it.
- Per-broker templates: rejected — maintenance sprawl; every broker update would require template updates.
- Cut California template: rejected (mid-discussion intermediate) — DROP doesn't cover these sites; CCPA does.

## Open questions / follow-ups
- Q-010: Verify CCPA template legal language and confirm which of the 25 sites are DROP-registered vs CCPA-only before launch.
