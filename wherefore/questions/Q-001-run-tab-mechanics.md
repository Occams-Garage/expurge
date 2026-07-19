---
id: Q-001
question: What is the tab-open sequencing and trigger, the content-script/background messaging contract, the behavior when a user closes a tab mid-run, and how is a challenge page detected and handled gracefully?
status: resolved
areas: [run-model]
topics: [webextensions]
asked_date: 2026-06-28
asked_slug: 2026-06-28-run-model-storage-coverage
resolution: Paced-automatic one-batch ceiling; storage-as-source-of-truth with idempotent acks; tab_closed counts as skip; challenge pages handled via MutationObserver.
resolution_slug: 2026-06-28-run-model-mechanics
---
