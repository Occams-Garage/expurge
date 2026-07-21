---
id: P-010
title: M7 dataset go-live (keypair, pin keys, host, first end-to-end fetch)
status: doing
created: 2026-07-19
area: broker-dataset
topics: [security-signing, dataset-distribution]
milestone: M7
decision_ref: 2026-07-09-m7-signed-dataset-extension-side, 2026-06-28-dataset-update-preference
---

The human-only half of M7 infra: generate and hold the keys, stand up the host, and
prove the first real fetch. Until this ships, `loadTrustedKeys()` finds no usable key,
`DatasetStatus.configured` stays `false`, and the bundled baseline is always used (that
inert state is intentional and AMO-safe). Depends on [[P-009-m7-infra-scaffolding]].
Source: `plan/dataset-delivery-runbook.md` steps 2, 3, 7.

- [ ] Generate two Ed25519 keypairs, primary (routine CI signing) and backup (offline, emergency re-sign + rotation); export each public key as raw 32 bytes, base64url
- [ ] Add the custom domain `data.expurge.com` (CNAME -> `dustinvk.github.io` + DNS record); verify HTTPS resolves at `https://data.expurge.com/`
- [ ] Confirm `data.` vs `updates.` subdomain before committing (a later change costs a permission-churn release); keep manifest `optional_host_permissions` matching `DATASET_HOST_PATTERN` verbatim
- [ ] Pin the two real public keys into `TRUSTED_PUBKEYS_RAW` in `src/shared/dataset.ts` (keep `keyid`s); rebuild and confirm `configured` flips to `true`
- [ ] Sign and publish the first real `brokers.json` + `brokers.sig.json` to Pages
- [ ] First end-to-end check in Firefox (`web-ext run` / `about:debugging`): version bumps from bundled(0) to published, second click reports "already have the latest" (304)
- [ ] Verify the three live guardrails against the host: tamper (no swap), rollback (no downgrade), expiry (keep current)
- [ ] Finalize + wire the first-fetch consent-prompt copy (legal review, Q-006 copy half; cadence already resolved)
