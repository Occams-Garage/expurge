---
date: 2026-06-28
title: "Verification model and draft gate"
areas: [opt-out-drafts]
topics: [verification, data-model, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Verification is per-channel with a two-tier trust model: the check step is lenient (wrong search URL wastes only a click), but the draft step is strict (only a verified channel can produce a draft, no override). The gate protects users from the project's own dataset errors mailing PII to the wrong address.

## Decisions / outcomes
- Verification lifecycle per channel: unverified → verified → broken. A human opens the real opt-out page and stamps `last_checked` + `source`.
- Stale tracking: verified channel untouched ~6 months flagged for re-verification.
- Check step lenient: unverified brokers skipped by default; a setting can include them.
- **Draft step strict: only verified channel → draft. No override. Non-negotiable.**
- Channel selection: walk optout list in order, take first channel that is usable in v1 (email) and verified.
- `form_required` verified channel → instruction card (URL + values to paste), not email.
- `general_contact` verified email → usable but flagged best-effort.
- Draft gate composed check: broker is a confirmed hit AND selected channel is verified. If nothing verified → no draft; broker shows in coverage as such.
- ID handling shapes draft body only, never gates it. `required: false` → don't mention ID. `required: true` → instruct user to attach self-redacted copy from their own client. Tool never stores, redacts, or reads an ID document.

## Why
A wrong opt-out address mails PII to the wrong inbox. The strictness of the draft gate is the tool's core trust guarantee — users must be able to assume that a generated draft went to a human-verified destination. The check step can be lenient because a wrong search URL costs only a click. The ID posture (no local redaction helper, no attachment handling) eliminates one of the most dangerous capabilities a tool like this could accidentally accumulate.

## Alternatives considered
- Per-broker verification (not per-channel): rejected — channels fail independently (URL changes while email stays valid).
- Allow draft from unverified channel with a warning: rejected — warning fatigue defeats the safety guarantee.

## Open questions / follow-ups
- Q-004: How many email body templates? Leaning 2–3 (generic CCPA + California-specific), but count not yet fixed.
