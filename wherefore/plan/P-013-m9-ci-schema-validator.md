---
id: P-013
title: M9 CI schema validator + trust-bit hygiene enforcement
status: todo
created: 2026-07-19
area: broker-dataset
topics: [verification, testing]
milestone: M9
decision_ref: 2026-06-28-broker-dataset-schema, 2026-06-28-verification-draft-gate
---

Mechanical guard on the dataset so malformed or over-trusted records cannot ship. This
is the validator the M7 CI pipeline pulls forward ([[P-009-m7-infra-scaffolding]]).
Source: `plan/expurge-progress.md` -> M9, `plan/expurge-plan.md` §5 + §5a. The
trust-bit rule is the crown jewel: a wrong opt-out address mails PII to the wrong place.

- [ ] Validate record shape: reject malformed brokers (missing `id` / `status` / `search` / `optout[]`, bad enum values)
- [ ] Enforce trust-bit hygiene: contributed records must be `trust: unverified`; only project-assigned records carry `verified`
- [ ] Assert `id` stability + uniqueness (slugs never change after shipping; hit records reference them)
- [ ] Validate `search.url` placeholder tokens resolve to known transforms; `requires[]` fields exist on the profile
- [ ] Wire it into both the extension repo CI and the `expurge-data` publish workflow (validate before sign)
- [ ] Cover it with tests; keep it in scope for the 90% coverage floor
