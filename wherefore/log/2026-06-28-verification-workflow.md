---
date: 2026-06-28
title: "Verification workflow, trust model, and CI enforcement"
areas: [broker-dataset]
topics: [verification, security-signing]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Verification is a fixed 8-item checklist scoped to exactly what the draft step mechanically trusts — nothing more. Trust bits are project-assigned and CI-enforced; no PR can claim a record is verified. Re-verification uses hard expiry (warn at 6 months, gate at 12), computed live from `last_checked` with no background job. The `verified_by` provenance field is added from day one as a cheap hedge against future trust-tier rotation. See also: 2026-06-28-verification-draft-gate.

## Decisions / outcomes
- **8-item checklist** (identical for maintainer and every contributor): opt-out target, kind, method-really-works, required subject, requester requirements, ID requirements, search sanity check, receipt. Channel verified only when items 1–6 and 8 hold.
- **Checklist scope principle**: a verifier checks only the things that cause real harm if wrong. This keeps the checklist short, repeatable, and resistant to scope creep.
- **Search is a sanity check, not a formal flag**: wrong search URL is self-correcting (user sees dead page); wrong opt-out target mails PII to the wrong inbox. Harm is asymmetric. Search gets a does-it-resolve glance during the pass plus `status: broken` as its safety valve — no own `verified` flag. General rule: build heavy trust machinery only for the failure that actually causes harm.
- **Trust bits** (`verified`, `source`, `last_checked`, `verified_by`): project-assigned, never honored from a PR. Contributed records always land `unverified` regardless of what the PR claims. Contributors may submit all other fields.
- **v1 is maintainer-only verification**. Delegation buys nothing at 25 sites and adds trust overhead.
- **`verified_by` from day one**: provenance field recording who verified each channel. In v1 it always says the maintainer. When a trusted-verifier tier is added later, records from a now-distrusted verifier can be found and re-checked — human analogue of key rotation. Designed-for but not built: trusted-verifier set; two-person ratification (only if ever justified). Both become policy changes, not schema migrations, because the field exists.
- **Hard expiry, not soft**: warn at 6 months, expire (gate stops passing) at 12. Soft expiry (keep working, just flag) rejected as the silent-drift failure. Expiry computed live from `last_checked` — no background job, no async flag drift. Expired channels stop satisfying the gate but are never deleted or reset (provenance preserved). User-facing: "needs re-checking, temporarily unavailable," never a silent vanish.
- **Two re-verification triggers**: approaching-expiry (time) and observed-in-the-wild failure (`load_error` / `challenge` skips from the run model — the stronger signal, already collected).
- **Re-verification load** is the activation signal for the trusted-verifier tier.
- **Verification mechanics v1**: hand-edit JSON. The 25-site launch pass is requirements-gathering for any future tooling. Optional one-line stamp helper if hand-editing chafes. Full guided-checklist tool deferred until the verifier tier activates.
- **CI validator from day one**: double duty — schema correctness (malformed records) and trust enforcement (fails any non-maintainer diff touching trust bits; requires contributed records to carry `verified: false/null`). Makes "project assigns verification, never a PR" mechanically unmergeable, not a review-time promise.
- **v2 submission intake caveat** (recorded now): web form + LLM pre-filtering can widen the front of the funnel but cannot perform verification. A lower-friction identity-less intake is a more attractive vector for malicious records. Submissions from any source land unverified; a human still does the checklist. Automation may filter, never assign trust.

## Why
The checklist is scoped to exactly what causes harm if wrong — wrong opt-out target, wrong kind, unworkable method — because a longer checklist is a checklist no one follows correctly. The hard expiry exists for the same reason the strict draft gate does: a verified claim that silently degrades is more dangerous than one that explicitly expires. CI enforcement converts a policy into a mechanical property; review-time promises erode. `verified_by` is the cheap-now hedge: it costs one field today and avoids a schema migration and a "which records can we trust?" audit later. The v2 intake caveat is written now because the pressure to automate verification will grow with scale, and the line must be clear before the tool exists.

## Alternatives considered
- Soft expiry (flag but keep working): rejected — silent drift is the failure mode for a safety-critical claim.
- Background job to flip expiry flags: rejected — async state creates drift; live computation from `last_checked` keeps the gate and the data in sync.
- Per-contributor verified claims honored from PRs: rejected — same trust-assertion shape as the signing keys; an unreviewed external claim cannot set a security-critical bit.

## Open questions / follow-ups
- None for v1 verification. Full guided-checklist tool and trusted-verifier tier deferred to when re-verification load justifies them.
