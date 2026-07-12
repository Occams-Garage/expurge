---
date: 2026-07-09
title: "M7 signed dataset: extension side built"
areas: [broker-dataset, permissions]
topics: [security-signing, dataset-distribution, webextensions, privacy]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
Confirmed the three open M7 decisions and built the extension half of the signed remote broker
dataset. The publishing side (repo, keys, CI, DNS) stays a human runbook. The verify pipeline,
active-dataset getter, and Settings UI are implemented and unit-tested, including a real Ed25519
roundtrip. The feature is inert by design until real signing keys replace the pinned placeholders.

## Decisions / outcomes
- Build only the extension side this session. Publishing infra (repo, keygen, sign, CI, DNS) is deferred to a human runbook because the private key and domain are the owner's to hold.
- Confirm Posture B. A dataset is trusted if any one pinned key validly signs it.
- Commit the update host to `data.expurge.com`, a custom domain on Pages from day one. Not `dustinvk.github.io`, not `occamsgarage.dev`.
- Single-source the host as `DATASET_HOST_PATTERN` in `src/shared/dataset.ts`; the manifest `optional_host_permissions` entry must match it verbatim.
- Use native WebCrypto Ed25519. No crypto dependency.
- Verify the exact fetched bytes and parse only after the signature validates.
- Set the anti-rollback floor to the raw stored version, ignoring expiry, so an expired remote still bars a downgrade to an older signed dataset.
- Serve the bundled baseline whenever the stored remote is missing or past expiry.
- Declare the update host as an optional permission, requested by a user gesture at opt-in. This reverses the earlier manifest note that wanted a required host permission to bypass CORS.
- Read the active dataset in run construction (`buildItems`) and the draft gate only. Leave the sidebar and options display-path broker lookups on the compile-time list until M9.
- Store the dataset in `storage.local` unconditionally, outside the M8 persistence opt-ins.
- Ship placeholder public keys. `loadTrustedKeys` finds no usable key, so `configured` is false, the Settings controls disable, and the bundled baseline is always used.

## Why
Trust travels in the signature, not the host, so a free shared host is safe once the exact
downloaded bytes are verified against a key baked into the reviewed build. Posture B beats 2-of-2
for a solo project: CI publishes with the primary key while the offline backup covers emergency
re-sign and rotation, and the blast radius is bounded by the 12-month expiry plus anti-rollback. A
custom domain from day one avoids a permission-churn release later, since the host string is baked
into the granted permission and the owner controls expurge.com. WebCrypto needs no dependency on
the Firefox 140 floor and adds fewer AMO review surfaces than a bundled library. The anti-rollback
floor and the serve-for-use question are different: an expired remote must still block a downgrade
even though the engine falls back to bundled for actual use. Run construction and the draft gate
decide whether a remote-only broker is scanned and drafted at all, so they must read the active
dataset; display-path name lookups are cosmetic and premature to migrate with one bundled broker.
The dataset is signed public data, not PII, so the persistence opt-ins do not apply to it.
Placeholder keys let the current build ship safely: the update feature announces itself as not
enabled until real keys are pinned.

## Alternatives considered
- Posture A (2-of-2), rejected: every release needs the offline key present, which fights CI automation, and losing either key bricks updates.
- Host on `dustinvk.github.io` or `occamsgarage.dev`, rejected: the domain is expurge.com, and a custom domain from day one avoids a later permission-churn release.
- Bundled `@noble/ed25519`, rejected: WebCrypto is native on the FF140 floor and adds no dependency to review.
- Migrating the display-path lookups to the active dataset now, rejected: premature with a single bundled broker; deferred to M9.
- Gating the dataset behind the M8 persistence opt-ins, rejected: it is not user data.
- Hashing then signing the hash (the original 2026-06-28 sketch), rejected in favor of signing the raw bytes: Ed25519 hashes internally, and signing the literal bytes sidesteps canonicalization drift.

## Open questions / follow-ups
- Q-019: finalize the dataset host identity before AMO (exact subdomain, and whether the extension id changes to match expurge.com). (resolved 2026-07-12 → `data.expurge.dev`, id unchanged; see `wherefore/questions/Q-019-dataset-host-identity.md`)
- Infra half pending: repo, keygen, key-pinning, sign script, CI, DNS. See `plan/dataset-delivery-runbook.md`.
- Display-path broker lookups still read the compile-time list; migrate at M9.
- First-fetch consent-prompt copy still needs legal review (Q-006 stays partial).
- See also: 2026-06-28-permissions-distribution-signing (this implements it; refines "sign the hash" to "sign the raw bytes"). Q-002 resolved and Q-006 partial sit under it.
