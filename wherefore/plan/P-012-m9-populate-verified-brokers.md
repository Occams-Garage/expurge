---
id: P-012
title: M9 populate ~25 verified brokers in brokers.json
status: todo
created: 2026-07-19
area: broker-dataset
topics: [verification, data-model]
milestone: M9
decision_ref: 2026-06-28-broker-dataset-schema, 2026-06-28-verification-workflow
---

Grow the dataset from one broker (TruePeopleSearch) to ~25 hand-curated people-search
sites, every channel personally verified with trust bits stamped. Records are never
deleted. Source: `plan/expurge-progress.md` -> M9, `plan/expurge-plan.md` §3 + §5.
Each new broker must also pass the challenge-resolve gate ([[P-014-m9-challenge-resolve-gate]])
before it is enabled.

- [ ] Curate the ~25-site list; assign stable `id` slugs (never change after shipping)
- [ ] For each broker: author `search.url` template + `requires[]` + `exposes[]` + `search.guidance`
- [ ] For each broker: personally verify each optout channel, stamp `trust: verified` with `last_checked` / `source` / `verified_by` (project-assigned only; CI enforces contributed records land unverified)
- [ ] Build the optional stamp helper CLI: `verify <broker-id> <channel>` sets `last_checked` / `verified_by` / `trust`
- [ ] Generalize `buildFormCard()` beyond TPS-specific steps once a second `form_required` broker is added (role dropdown / hCaptcha steps)
- [ ] Re-verify the standing TPS form channel (verified 2026-06-28) as part of the sweep
