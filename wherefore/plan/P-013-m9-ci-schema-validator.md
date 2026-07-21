---
id: P-013
title: M9 CI schema validator + trust-bit hygiene enforcement
status: doing
created: 2026-07-19
updated: 2026-07-21
area: broker-dataset
topics: [verification, testing]
milestone: M9
decision_ref: 2026-06-28-broker-dataset-schema, 2026-06-28-verification-draft-gate
---

Mechanical guard on the dataset so malformed or over-trusted records cannot ship. This
is the validator the M7 CI pipeline pulls forward ([[P-009-m7-infra-scaffolding]]).
Source: `plan/expurge-progress.md` -> M9, `plan/expurge-plan.md` §5 + §5a. The
trust-bit rule is the crown jewel: a wrong opt-out address mails PII to the wrong place.

Pulled forward for the M7 pipeline ([[P-009-m7-infra-scaffolding]]). Landed in the canonical
standalone repo `Occams-Garage/expurge-data`: `scripts/validate.mjs` (schema + hygiene, pre-existing
in that repo) plus `scripts/trust-guard.mjs` (author-gated trust rule, merged in 2026-07-21) whose
pure `checkTrustDiff()` is unit-tested. Green under `node --test`. Two boxes remain genuinely undone
(noted inline).

- [x] Validate record shape: reject malformed brokers (missing `id` / `status` / `search` / `optout[]`, bad enum values) -- `scripts/validate.mjs`, incl. channel method/kind/trust enums and an http(s)/absolute `search.url` check
- [x] Enforce trust-bit hygiene: contributed records must be `trust: unverified`; only project-assigned records carry `verified` -- `scripts/trust-guard.mjs` (maintainer-gated diff, PR-time) + `validate.mjs` verified->provenance hygiene
- [x] Assert `id` uniqueness + slug format -- NOTE: cross-release *stability* (a slug never changing after shipping) is not diff-checked yet; needs a check against the last published version
- [ ] Validate `search.url` placeholder tokens resolve to known transforms; `requires[]` fields exist on the profile -- PARTIAL: `validate.mjs` enforces an http(s) absolute URL, but token-transform and profile-field vocab checks still need the extension's `src/shared/transforms.ts` + `Profile` shared over
- [x] Wire it into the `expurge-data` publish workflow (validate before sign) -- `release.yml` + `pr-validate.yml`. NOTE: the extension-repo CI still relies on `brokers.test.ts` for its TS-const broker; wiring the shared validator there is deferred until the dataset is JSON-sourced
- [x] Cover it with tests -- `test/` (build->sign->verify roundtrip, validate behavioral, trust-guard pure) via `node --test`; the extension's 90% vitest floor does not apply to this separate zero-dep repo
