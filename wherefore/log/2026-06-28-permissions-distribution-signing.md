---
date: 2026-06-28
title: "Permissions, distribution, and dataset signing"
areas: [permissions, broker-dataset]
topics: [security-signing, dataset-distribution, webextensions, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The extension avoids `<all_urls>` in favor of optional per-domain permissions granted at runtime via Firefox's native consent prompt. The dataset ships bundled in the extension plus a signed remote update layer (Ed25519, dual-key). The server holds data but no trust — a compromised server costs availability at worst, never integrity.

## Decisions / outcomes
- No `<all_urls>`. Permissions declared as `optional_permissions`, requested via `browser.permissions.request()`.
- New broker domain → Firefox native per-domain consent prompt. Decline → "available but not enabled" in coverage report; never silently checked.
- Dataset distribution hybrid: bundled baseline (works offline from day one, fully trusted) + signed remote update layer for between-release refreshes without store review.
- Data changes (URL templates, opt-out addresses, verification refreshes) ride the no-review path; a new broker domain still needs runtime permission but not a store review.
- Signing: Ed25519. Hash `brokers.json` → sign hash → detached `.sig`. Verify via `crypto.subtle.verify` before trusting any field. Verify failure → reject download, fall back to last-known-good.
- **Public keys are source code**: committed in plaintext as `TRUSTED_PUBKEYS` constant, baked into every reviewed build. Not a per-release parameter, not secret.
- Two keys: primary (CI secret) + backup (separate blast radius: HSM or isolated account/vault, NOT the same CI secrets store).
- Compromise response is two-phase: switching to backup is seamless (extension already trusts both, no release needed); revoking dead key requires a release (trust list lives in reviewed package, must not be server-mutable).
- Recovery procedure written at setup time, not left as a someday-doc.

## Why
`<all_urls>` would force a privacy tool to claim "read your data on all websites" — self-defeating for the target user. Per-domain optional permissions let the AMO listing honestly say the extension only reads sites the user approved. Asymmetric signing is required (not checksums): a compromised server can swap both a file and its hash, but cannot forge a signature without the private key. Two keys in separate blast radii ensure signing can survive a build-pipeline breach. Public keys in source code means the trust root is the reviewed extension itself, not a server.

## Alternatives considered
- `<all_urls>`: rejected on first principles — contradicts the product's core privacy promise.
- Checksum-only for remote updates: rejected — doesn't prove authorship; a compromised server defeats it.
- Single signing key: rejected — a CI pipeline breach (likeliest path) leaves no recovery option.

## Open questions / follow-ups
- Q-002: Should the remote dataset fetch be triggered manually ("check for updates" button) or automatically on a schedule?
