# M7 infra runbook — signed dataset delivery

**Status:** the extension side of M7 is built and tested (see `plan/expurge-progress.md` → M7).
This runbook is the **human-only** half: it stands up the publishing side and pins the real keys.
It exists because the private key and the DNS/repo are yours to own — the extension can't (and
shouldn't) generate or hold them.

Until step 3 is done, `loadTrustedKeys()` finds no usable key → `DatasetStatus.configured` is
`false` → the Settings controls disable themselves and the bundled baseline is always used. That
inert-by-default state is intentional and safe: shipping the current build to AMO is fine; the
update feature simply announces itself as "not enabled in this build yet" until keys are pinned.

Decisions already locked (2026-07-09): **Posture B** (accept either pinned key) · host
**`data.expurge.dev`** (finalized 2026-07-12 — matches the extension id, HSTS-preloaded) ·
**WebCrypto** (no crypto dependency). Rationale in `plan/dataset-delivery.md`.

---

## Single source of truth for the host
`DATASET_ORIGIN` / `DATASET_URL` / `SIG_URL` / `DATASET_HOST_PATTERN` all live in
`src/shared/dataset.ts`. The manifest `optional_host_permissions` entry
(`https://data.expurge.dev/*`) must match `DATASET_HOST_PATTERN` **verbatim**. Change both
together if the subdomain moves. Subdomain finalized as `data.` (not `updates.`) on 2026-07-12 —
a later change costs a permission-churn release.

## 1. Stand up the data repo + host
- Create a dedicated public repo, e.g. `DustinVK/expurge-data` (separate blast radius from the
  extension source — the signing secret lives only here).
- Enable GitHub Pages. Add the custom domain `data.expurge.dev` (DNS `CNAME` record: `data` →
  `dustinvk.github.io`, the account Pages host — not the repo). Also add the account-level domain-
  verification TXT record GitHub issues (`_github-pages-challenge-dustinvk.expurge.dev`) to prevent
  cross-account takeover of `*.expurge.dev`. Verify HTTPS (Let's Encrypt) resolves at
  `https://data.expurge.dev/`. Note: `.dev` is HSTS-preloaded, so there is NO http fallback — the
  site is simply unreachable until the cert provisions (minutes to ~24h); that's expected.
- Layout: `brokers.json` and `brokers.sig.json` at the site root.

## 2. Generate keys
Two Ed25519 keypairs — **primary** (routine CI signing) and **backup** (offline; emergency
re-sign + key rotation). Export each public key as **raw 32 bytes, base64url** (that is exactly
what `importEd25519Key` expects).

```bash
# One keypair. Repeat for the backup, store its private key OFFLINE (never in CI).
openssl genpkey -algorithm ed25519 -out primary.pem
# raw 32-byte public key → base64url (strip the 12-byte SPKI/DER prefix, then base64url):
openssl pkey -in primary.pem -pubout -outform DER | tail -c 32 \
  | basenc --base64url | tr -d '='
```
(Any tool that yields the raw 32-byte public key works — Node `crypto`, `age-keygen`-style tools,
etc. The sign step below must produce a raw 64-byte Ed25519 signature, base64url.)

## 3. Pin the public keys in the extension
In `src/shared/dataset.ts`, replace the two `TRUSTED_PUBKEYS_RAW` placeholder values with the
real base64url public keys. Keep the `keyid`s (`primary-2026` / `backup-2026`) — they must match
the `keyid` fields you write into `brokers.sig.json`. Rebuild; `configured` flips to `true` and
the Settings controls enable. **Private keys never enter the repo or the XPI.**

## 4. Author `brokers.json` (published envelope)
The published file is the envelope, not a bare array (`BUNDLED_DATASET` in `dataset.ts` shows the
shape). Set `dataset_version` to a monotonic integer **≥ 1** (bundled baseline is 0, so any real
publish supersedes it), and real `created` / `expires` (12-month) / `warn_after` (6-month) dates.

## 5. Sign the raw bytes → `brokers.sig.json`
Sign the **exact serialized bytes** of `brokers.json` (never a re-serialized copy — verification
is byte-exact). Emit the detached envelope:
```jsonc
{ "alg": "ed25519", "target": "brokers.json",
  "sigs": [ { "keyid": "primary-2026", "sig": "<base64url raw 64-byte signature>" } ] }
```
Add the backup signature (out-of-band, from the offline key) only for an emergency co-sign.

## 6. CI: validate → sign → publish (in `expurge-data`)
On a tagged dataset release: validate the schema + trust hygiene (the CI validator is currently
scoped to **M9** — pull it forward here, or stub it initially), bump `dataset_version`, sign with
the primary key (a CI secret), write `brokers.sig.json`, deploy both files to Pages, tag the
release as the provenance record. See `plan/dataset-delivery.md` §8.

## 7. First real end-to-end check (Firefox)
Load the extension (`web-ext run` / `about:debugging`). Settings → **Broker data updates** →
enable "Check automatically" (grants the `data.expurge.dev` host permission) → "Check for updates
now". Expect: version bumps from bundled(0) to your published version; a second click reports
"already have the latest" (304 / not-newer). Then test the guardrails against the live host:
- **Tamper:** serve a `brokers.json` byte that the signature doesn't cover → "signature did not
  verify. Keeping your current list." (no swap).
- **Rollback:** serve an older `dataset_version` → "already have the latest" (no downgrade).
- **Expiry:** serve a past-`expires` dataset → "expired. Keeping your current list."

## 8. Pre-AMO
- Extension id `browser_specific_settings.gecko.id` = `expurge@expurge.dev` now matches the dataset
  host `data.expurge.dev` (host finalized 2026-07-12) — no id reconcile needed. Just confirm the id
  is the one you want to list under, since it ties AMO updates together.
- Disclose the opt-in update fetch in the AMO listing (the in-product disclosure already lives in
  Settings). Confirm `data_collection_permissions` stays `["none"]` (the fetch sends no user data:
  `credentials: 'omit'`, no identifiers).
- Strip the manifest `_notes` block (see `plan/sidebar-nav-follow-up.md` §7).
