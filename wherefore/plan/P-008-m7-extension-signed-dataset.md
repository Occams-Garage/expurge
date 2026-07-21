---
id: P-008
title: "M7 extension-side: signed remote dataset core (inert until keys pinned)"
status: done
created: 2026-07-20
updated: 2026-07-20
area: broker-dataset
topics: [security-signing, dataset-distribution]
milestone: M7
decision_ref: 2026-07-09-m7-signed-dataset-extension-side, 2026-06-28-permissions-distribution-signing
---

Retroactive record of a shipped milestone: the extension half of M7, done 2026-07-09
and inert by design until the real keys are pinned. The infra half (publishing pipeline
plus go-live) is the remaining work in [[P-009-m7-infra-scaffolding]] and
[[P-010-m7-dataset-go-live]]. Source: `plan/expurge-progress.md` (M7, "Extension-side
DONE"); design in `plan/dataset-delivery.md`. Complete.

- [x] `src/shared/dataset.ts`: types, host constants, `BUNDLED_DATASET`, pure `decideDatasetUpdate()` (signature to shape to anti-rollback to expiry), `isAutoFetchDue()` (weekly), WebCrypto Ed25519 verify (Posture B, any pinned key validates)
- [x] `src/background/dataset-store.ts`: conditional `If-None-Match` GET, verify-before-parse, anti-rollback floor, expiry, fail-safe keep-last-good; `getActiveBroker(s)`, `getDatasetStatus()`, `setAutoFetch()`, `autoFetchIfDue()`
- [x] Background wiring: `buildItems` and the draft-gate lookup read the active dataset; CHECK_DATASET_UPDATE / GET_DATASET_STATUS / SET_DATASET_AUTOFETCH handlers
- [x] Settings "Broker data updates": status line, opt-in auto-check toggle (off by default), check-now button, host-permission grant in the gesture, privacy disclosure; controls disabled in a placeholder-key build (`configured: false`)
- [x] `src/shared/dataset.test.ts`: 18 tests incl. a real generate to sign to verify roundtrip, tamper / wrong-key / wrong-alg rejection, the decision matrix, and auto-fetch cadence
- [x] Inert-by-design confirmed: `TRUSTED_PUBKEYS_RAW` placeholders yield `configured: false`, so the bundled baseline is always used until go-live ([[P-010-m7-dataset-go-live]])
