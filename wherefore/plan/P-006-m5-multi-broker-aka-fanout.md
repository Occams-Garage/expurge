---
id: P-006
title: "M5: multi-broker batching + AKA name-variant fan-out"
status: done
created: 2026-07-20
updated: 2026-07-20
area: run-model
milestone: M5
decision_ref: 2026-06-30-aka-structured-name-fields, 2026-06-28-run-model-mechanics
---

Retroactive record of a shipped milestone: expanded the run unit to (broker x
name-variant) with paced batching. Source: `plan/expurge-progress.md` (M5). Complete.

- [x] `buildItems()` fans out primary + `also_known_as[]` variants across all active brokers (one item per broker x name-variant)
- [x] Missing required field pre-verdicted as skip, reason `missing:<field>`
- [x] `serialWrite` queue prevents TOCTOU races when tabs return verdicts concurrently
- [x] `matchedAs` populated on hit; `browser.action` badge shows the hit count
- [x] Popup run monitor: per-broker table with rolled-up status badge + AKA count; coverage note for brokers not in the run and the missing-field skip count
