# Roadmap

The milestone vocabulary that plan items reference via their `milestone:` field. Each
milestone is a coherent slice of the v1 Firefox extension. Full narrative in
`plan/expurge-plan.md` (§11 phasing); live status in `plan/expurge-progress.md`. This
file is the stable index of milestone IDs; it is not an item and the plan loader ignores
it.

## Done (built and buildable)

- **M0**: Manifest + build skeleton (esbuild, TS, webextension-polyfill, dist/).
- **M1**: Profile form to URL render to open tab (permissions.request, START_RUN).
- **M2**: Content script overlay + four-way verdict + ACK contract. Superseded by the
  sidebar migration (2026-07-01); the overlay is now a Firefox native `sidebar_action`.
- **M3**: Draft gate + three send surfaces (evaluateGate, buildDraft, mailto / .eml /
  copy-paste), plus listing-URL capture and the TPS form_required opt-out card.
- **M4**: Single-broker robustness: challenge detection, stop control, no-wedge across
  all clearing paths.
- **M5**: Multi-broker batching + AKA name-variant fan-out (broker x name-variant unit),
  serial write queue, badge.
- **M6**: Options page as primary UI (Run / Results / Profile / Settings); popup stripped
  to a run control panel.
- **M7 (extension side)**: Signed remote dataset core: `src/shared/dataset.ts` (Ed25519
  verify via WebCrypto, `decideDatasetUpdate`, `BUNDLED_DATASET`),
  `src/background/dataset-store.ts`, Settings "Broker data updates" UI. Inert until real
  keys are pinned, by design.

## Remaining

Plan items live in `wherefore/plan/`.

- **M7 (infra)**: Stand up the publishing side and pin the real keys. Decisions locked
  2026-07-09: Posture B, host `data.expurge.com`, WebCrypto. Runbook:
  `plan/dataset-delivery-runbook.md`.
  Items: [[P-001-m7-infra-scaffolding]], [[P-002-m7-dataset-go-live]].

- **M8**: Persistence opt-ins: three independent toggles (all default OFF) that promote
  ephemeral state to `storage.local`, plus cross-session resume and import JSON.
  Items: [[P-003-m8-persistence-opt-ins]].

- **M9**: Full dataset + launch polish: ~25 verified brokers, CI schema validator, the
  per-broker challenge-resolve gate, pre-launch legal verify, deferred hardening, and AMO
  submission.
  Items: [[P-004-m9-populate-verified-brokers]], [[P-005-m9-ci-schema-validator]],
  [[P-006-m9-challenge-resolve-gate]], [[P-007-m9-ccpa-drop-legal-verify]],
  [[P-008-m9-deferred-cleanups-hardening]], [[P-009-m9-amo-submission-prep]].

## Out of v1 scope

Deferred by design so the desktop confirm UX is not shaped for two interaction models at
once (`plan/expurge-plan.md` §11 v2). No plan items; tracked as future work.

- **v2**: Firefox mobile (Android), Chrome port, registered-brokers blind-send flow,
  easier/automated matching (local-LLM extraction Q-003, human-in-the-loop MCP assist),
  per-broker extraction hints, background auto-fetch enhancements.
- **Later**: Follow-up / re-check scheduling, broader dataset growth.
