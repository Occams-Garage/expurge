---
date: 2026-06-28
title: "Draft send mechanism: three surfaces, user-preferred"
areas: [opt-out-drafts]
topics: [webextensions, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The extension generates opt-out requests but never sends them and never touches attachments — the user always sends from their own mail surface. This is the legal posture (send-it-yourself, not authorized agent) and the mechanism question are the same question. All three send surfaces (mailto, .eml download, copy-paste) are always available on every request; the user picks a preferred default in settings. See also: 2026-06-28-verification-draft-gate.

## Decisions / outcomes
- Extension generates, never sends, never touches attachments. User sends from their own mail client or webmail. Keeps v1 in send-it-yourself territory and out of authorized-agent obligations.
- **Three surfaces always available** on every request:
  - `mailto`: opens compose window in registered handler; cannot carry attachments; has body length/encoding limits.
  - `.eml` download: supports attachments and long bodies; inert for webmail-only users.
  - Copy-paste: universal floor; the only surface that works for webmail-only users (Gmail in a browser); always one click away.
  - Surfaces fail in opposite conditions — offering all three is resilience, not redundancy.
- Per-user preferred-method setting (options page). Default: mailto. User's stated preference picks the surface; guardrails handle cases where the preferred surface can't work.
- Platform constraint (not a design failure): browser extensions have no API to hand a fully-formed message directly to a mail client.
- **ID-required brokers**: instructions are sequenced to avoid the redact-then-discover-dead-mailto trap. Order: open the request → confirm the compose window opened first → then redact and attach. `.eml` retained as the robust alternative for longer ID-broker bodies.
- **Attach-instruction placement**: instructions live in BOTH the draft body (bracketed line near the top, so they survive copy-paste into webmail) AND the extension UI next to the send buttons (showing the specific `redact[]` fields). Both, not either.

## Why
The legal posture determines the mechanism: an extension that sends on the user's behalf would be an authorized agent with different obligations. Send-it-yourself avoids this entirely. Three surfaces exist because each fails for a different user profile — one surface would exclude a population. The sequenced ID-attachment instruction protects the user from sensitive redaction work followed by discovering the mailto handler doesn't exist. Instructions in both the body and the UI ensure they survive whichever path the user takes.

## Alternatives considered
- Single send surface: rejected — surfaces fail in opposite conditions; any single surface excludes a population.
- Situational default (context-dependent surface selection): rejected — user's stated preference is cleaner and resolves the ambiguity.

## Open questions / follow-ups
- None. (Q-007 resolved by this discussion.)
