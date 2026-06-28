---
date: 2026-06-28
title: "Dataset update preference: manual-by-default"
areas: [broker-dataset, permissions]
topics: [dataset-distribution, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The auto-vs-manual dataset fetch is a user-controlled setting in the options page, defaulting to manual/opt-in. The first fetch ever is gated behind an explicit one-time consent prompt that sets the preference and discloses the request sends nothing about the user. This decision is final but not yet written back into the plan doc (§12 item 2 still shows as open there). See also: 2026-06-28-permissions-distribution-signing.

## Decisions / outcomes
- Options page setting: auto (on a schedule) or manual (button-triggered). Default: manual.
- First fetch gated behind a one-time explicit consent prompt that sets this preference and discloses the request carries no user data.
- Setting label scoped to "broker list updates" specifically — kept visually and conceptually distinct from Firefox's own extension auto-update (user manages that in Firefox, not in expurge).
- Plan doc §12 item 2 still says open; needs to be written back.

## Why
A privacy tool that phones home without asking is self-undermining. Manual default means the first network contact is always user-initiated and disclosed. The consent prompt doubles as the preference picker so users don't configure it separately after the fact. The label distinction from Firefox's own updater matters: conflating the two would confuse users about what they're controlling.

## Alternatives considered
- Default auto: rejected — a privacy tool should not phone home without explicit opt-in.

## Open questions / follow-ups
- Q-006: What cadence should the automatic schedule run on, and what is the exact consent-prompt copy?
