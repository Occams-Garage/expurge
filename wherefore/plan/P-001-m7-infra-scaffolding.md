---
id: P-001
title: M7 dataset infra scaffolding (sign.mjs, CI validate-sign-publish, data repo)
status: todo
created: 2026-07-19
area: broker-dataset
topics: [security-signing, dataset-distribution]
milestone: M7
decision_ref: 2026-07-09-m7-signed-dataset-extension-side, 2026-06-28-permissions-distribution-signing
---

The buildable half of M7 infra: the publishing pipeline that turns a `brokers.json`
into a signed, hosted pair. Extension side is already done and inert until keys are
pinned (see [[P-002-m7-dataset-go-live]]). Source: `plan/dataset-delivery-runbook.md`
(steps 1, 4, 5, 6) and `plan/dataset-delivery.md` §8. Decisions locked: Posture B,
host `data.expurge.com`, WebCrypto.

- [ ] Create the `DustinVK/expurge-data` public repo (separate blast radius; the signing secret lives only here)
- [ ] Enable GitHub Pages on it; layout `brokers.json` + `brokers.sig.json` at site root (DNS/HTTPS go-live is in [[P-002-m7-dataset-go-live]])
- [ ] Author the published `brokers.json` envelope shape (not a bare array): `dataset_version` >= 1, real `created` / `expires` (12mo) / `warn_after` (6mo)
- [ ] Write `sign.mjs`: sign the exact serialized bytes of `brokers.json` with a raw-bytes Ed25519 key, emit a raw 64-byte signature (base64url)
- [ ] Emit the detached `brokers.sig.json` envelope (`alg` / `target` / `sigs[]`; `keyid` matches the pinned `primary-2026` / `backup-2026`)
- [ ] Write the CI validate -> sign -> publish GitHub Actions workflow: validate schema + trust hygiene, bump `dataset_version`, sign with the CI-secret primary key, deploy both files to Pages, tag the release as the provenance record
- [ ] Pull the M9 CI schema validator ([[P-005-m9-ci-schema-validator]]) forward for the validate step, or stub it initially
