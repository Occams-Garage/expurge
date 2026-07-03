---
date: 2026-06-28
title: "AMO compliance review: four build constraints"
areas: [permissions]
topics: [webextensions, privacy]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
Current AMO policies (last updated April 2026) were reviewed against the design: no violations found, and the design is unusually well-aligned. Four standing build constraints were extracted and apply to every milestone. This entry is additive: the review confirmed existing decisions rather than reversing any. See also: 2026-06-28-mv3-and-manifest, 2026-06-28-permissions-distribution-signing.

## Decisions / outcomes
Four standing build constraints, each applying to every milestone:
1. Consent UI must be a focused tab, not a popup. Decline must be as easy to reach as accept (no asymmetric decline).
2. Opt-out send qualifies for implicit single-use consent under AMO policy; do not over-prompt for consent at send time.
3. The overlay must never inject the user's profile data into the page DOM. Overlay UI must be entirely self-contained.
4. Permissions request only what's necessary: no remote code execution, nothing persisted from private browsing sessions.

## Why
Recording compliance constraints explicitly ensures they survive as requirements through the build rather than being rediscovered at AMO review time. Constraint 3 (no profile data in DOM) is non-obvious: injected DOM content is accessible to the page's JavaScript, creating a data-exfiltration surface that would violate both the privacy promise and AMO policy. Making it a named build constraint is more reliable than relying on reviewer discovery.

## Open questions / follow-ups
- Q-009: Confirm whether permissions.request() requires a user gesture in Firefox 140+ before M6.
