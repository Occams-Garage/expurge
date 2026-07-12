# expurge — Signed Broker Dataset Delivery (GitHub Pages)

**Status:** decisions resolved (2026-07-09) · **extension side BUILT & TESTED** · publishing/infra
side pending (human runbook).
**Scope:** v1 remote-update delivery path for `brokers.json`
**Owner:** Occam's Garage

> **Decisions locked (2026-07-09), superseding the "open decisions" framing below:**
> 1. **Posture B** — accept either pinned key (§5.2).
> 2. **Host: `data.expurge.dev`** — a custom domain on Pages from day one (§3.4 Option B), NOT
>    `dustinvk.github.io` or `occamsgarage.dev`. Chosen over `data.expurge.com`/`.app`
>    (2026-07-12) because it matches the extension id (`expurge@expurge.dev`) and is HSTS-preloaded.
>    Origin is single-sourced in code as `DATASET_ORIGIN` / `DATASET_HOST_PATTERN` in
>    `src/shared/dataset.ts`; the manifest `optional_host_permissions` entry must match verbatim.
> 3. **WebCrypto** — native `crypto.subtle` Ed25519, no crypto dependency (§10.3).
>
> The extension-side implementation (verify pipeline, active-dataset getter, Settings UI) is done
> and unit-tested — see `plan/expurge-progress.md` → M7. The remaining human/ops steps (repo,
> keygen, key-pinning, sign script, CI, DNS) are in **`plan/dataset-delivery-runbook.md`**. The
> `dustinvk.github.io` / `occamsgarage.dev` strings below are the pre-decision proposals; read
> them as `data.expurge.dev`.

---

## 1. Goal & non-goals

**Goal.** Deliver an updated, Ed25519-signed broker dataset to installed extensions without shipping a new XPI, while keeping the privacy and trust model intact:

- nothing fetched unless the user opts into updates (per the local-first pillar);
- trust is assigned by the project's signature, never by the transport;
- the bundled baseline `brokers.json` remains the always-present fallback and the extension works fully offline.

**Non-goals (v1).**

- No server-side logic of any kind. Pages serves static files only.
- No automated broker drift detection (deferred to v2).
- No telemetry, no per-user URLs, no identifiers in the request.

---

## 2. Core design principle: trust travels in the signature, not the host

The dataset is plain data verified against a public key that ships *inside* the extension. That single fact is what makes a free, shared, "untrusted" host like GitHub Pages safe to use:

- A network attacker, a compromised CDN edge, or a typo-squatted mirror can change the bytes, but cannot produce a valid Ed25519 signature.
- On the **bundled** path, AMO already signs the whole XPI, so the dataset signature there is just provenance.
- On the **update** path the dataset leaves the XPI entirely — AMO's signature no longer covers it — so the Ed25519 verification is doing the real, load-bearing integrity work. This asymmetry is the entire justification for the signing apparatus.

**Consequence for the schema:** every field in `brokers.json` must stay purely *declarative* (URLs, field maps, email subject/body templates, trust flags, `verified_by` provenance). No field may ever be evaluated as logic — no `eval`, no `Function`, no selectors executed as script, no remote CSS/JS. The moment a fetched field becomes executable, it is "remote code" under Mozilla policy and the add-on becomes blockable.

---

## 3. Hosting layout

### 3.1 Use a separate data repository

Recommended: publish the dataset from a dedicated repo, e.g. **`DustinVK/expurge-data`**, with Pages enabled.

Rationale (these track the project's stated values, not ceremony):

- **Blast radius.** The dataset signing key lives as a CI secret. Keeping it in a repo whose *only* job is publishing signed data minimizes the number of workflows, actions, and write-access surfaces that sit next to that secret. This mirrors the existing "backup key in a separate blast-radius store" reasoning.
- **Cadence decoupling.** Broker re-verification and dataset releases move on a different clock than extension code. A separate repo gives the data its own history, issue tracker (good home for the v2 maintainer verification workflow), and release pipeline.

Single-repo alternative: serve from `DustinVK/expurge` via a `/docs` folder or an Actions deploy. Simpler, but the signing secret then shares a repo with the extension source and all its workflows. Acceptable for a true solo project; the separate repo is the cleaner long-term posture.

### 3.2 URL structure

```
https://data.expurge.dev/brokers.json        # the dataset          (RESOLVED host)
https://data.expurge.dev/brokers.sig.json     # detached signatures
```

Single origin, no cross-host redirect (unlike GitHub *Releases*, whose download URL bounces to `release-assets.githubusercontent.com` and would force a second host permission). Fastly-backed CDN, free Let's Encrypt TLS, ETag/`Last-Modified` support for cheap conditional checks.

### 3.3 Host permission

Declare exactly the one origin/path, scoped tightly, in `optional_host_permissions` — never `<all_urls>`:

```json
"optional_host_permissions": ["https://data.expurge.dev/*"]   // RESOLVED — matches DATASET_HOST_PATTERN
```

Granted at the moment the user first opts into updates, so a user who never enables updates never grants it.

### 3.4 Custom domain decision — make it now, not later

If you ever move to `data.occamsgarage.dev`, the host permission string changes, which means an extension update **and** a fresh per-user permission prompt. Pick the host you'll commit to up front:

- **Option A:** commit to `dustinvk.github.io` for v1, accept that a future domain move costs one permission-churn release.
- **Option B (preferred if a custom domain is at all likely):** stand up `data.occamsgarage.dev` on Pages from day one (free; just a CNAME + DNS) and pin that origin now. The signature makes the domain's "prestige" irrelevant to trust, but committing early avoids the churn.

---

## 4. Published artifacts

### 4.1 `brokers.json`

Version and lifetime metadata live *inside* the file so they are covered by the signature and cannot be spoofed independently of the data:

```jsonc
{
  "schema_version": 1,
  "dataset_version": 17,          // monotonic integer; drives anti-rollback
  "created": "2026-06-30T00:00:00Z",
  "expires": "2027-06-30T00:00:00Z",  // 12-month hard expiry
  "warn_after": "2026-12-30T00:00:00Z", // 6-month soft warning
  "brokers": [ /* existing channel-list schema, trust enum, verified_by, ... */ ]
}
```

`brokers.json` is the **canonical published artifact**. The extension signs and verifies the *exact bytes of this file* — never a re-serialized copy (see §5.1).

### 4.2 `brokers.sig.json` (detached, dual-key)

A detached signature envelope keeps verification byte-exact and lets you carry both keys in one fetch:

```jsonc
{
  "alg": "ed25519",
  "target": "brokers.json",
  "sigs": [
    { "keyid": "primary-2026", "sig": "base64url(signature over the raw bytes of brokers.json)" },
    { "keyid": "backup-2026",  "sig": "base64url(...)" }   // present only when co-signed
  ]
}
```

Detached (separate file) rather than a `{payload, sig}` wrapper specifically so "what is signed" is the literal downloaded bytes, sidestepping all JSON canonicalization concerns. The extra request is cheap and conditionally cacheable.

### 4.3 Optional index (deferred)

A tiny `index.json` (`{ dataset_version, hash, url }`) checked before the full download is an optimization for when the dataset grows large. **Not needed for v1** — a conditional `GET` on `brokers.json` (304 on no change) is already near-zero cost.

---

## 5. Signing

### 5.1 What to sign

Sign the **raw serialized bytes** of the published `brokers.json`. Verification is then: `fetch → get bytes → Ed25519.verify(bytes, sig, pubkey) → only then JSON.parse`. Re-serializing before verifying reintroduces canonicalization drift, which either breaks verification or — worse — opens a gap between the bytes you verified and the object you parsed.

### 5.2 Dual-key posture — **open decision, pick one**

Both public keys are pinned in the extension (`primary` in CI secrets, `backup` in the separate hardware/offline store). What differs is the verification rule:

- **Posture A — require both (2-of-2).** Forging a dataset needs *both* keys. Strongest integrity. Cost: every release needs the offline key present, which fights CI automation (you don't want the hardware key in CI), and losing either key bricks updates until an extension update ships a new pinned set.
- **Posture B — accept either, primary used routinely (recommended for v1).** CI publishes automatically with the primary key. The backup key exists to (a) sign an emergency dataset if the primary is compromised and (b) authorize key rotation. Smoother ops, plays nicely with Actions. Cost: a primary-key compromise *alone* can forge a dataset until you ship an extension update revoking it — bounded in practice by the hard 12-month expiry and the anti-rollback check (§6.4).

**Recommendation:** Posture B for v1. The blast radius is small (≤25 brokers, opt-in updates, baseline fallback, expiry + rollback guards), and the operational simplicity matches a solo project. Revisit a 2-of-2 or a signed key-rotation chain in v2 if the broker count or contributor count grows.

### 5.3 Key pinning & rotation hooks

- Embed both raw public keys in the extension as constants, each tagged with its `keyid`.
- The `keyid` in the sig envelope lets you rotate without ambiguity: ship a new key in an extension update, keep verifying the old one for a deprecation window, then drop it.

---

## 6. Extension fetch & verify flow

Lives in `src/shared/` alongside the existing dataset logic; driven by the background coordinator.

### 6.1 Permission grant timing

User toggles "check for broker updates" → request `optional_host_permissions` for the data origin → only then is any fetch possible.

### 6.2 Conditional request

Store the last `ETag`. Send `If-None-Match`; a `304` ends the check having transferred nothing. This is the common case.

### 6.3 Verify-before-parse + anti-rollback + swap

```ts
// Pinned at build time
const PUBKEYS: Record<string, CryptoKey> = { /* primary-2026, backup-2026 */ };

async function verifyAndLoadDataset(): Promise<LoadResult> {
  const res = await fetch(DATASET_URL, {
    credentials: "omit",
    headers: lastEtag ? { "If-None-Match": lastEtag } : {},
  });
  if (res.status === 304) return { changed: false };
  if (!res.ok) return { changed: false, error: res.status }; // keep last-good

  const bytes = new Uint8Array(await res.arrayBuffer());   // verify these exact bytes
  const sigEnv = await (await fetch(SIG_URL, { credentials: "omit" })).json();

  // 1. signature: accept if ANY pinned key validly signs (Posture B)
  const ok = await anyValid(sigEnv.sigs, bytes, PUBKEYS);  // crypto.subtle.verify "Ed25519"
  if (!ok) return { changed: false, error: "bad_signature" }; // keep last-good, do NOT swap

  // 2. parse only after verification passes
  const dataset = JSON.parse(new TextDecoder().decode(bytes));

  // 3. anti-rollback: never accept an older or equal signed version
  if (dataset.dataset_version <= currentVersion()) return { changed: false };

  // 4. expiry sanity
  if (Date.parse(dataset.expires) < Date.now()) return { changed: false, error: "expired" };

  // 5. swap active dataset only now; persist new ETag + version
  await commitDataset(dataset, res.headers.get("ETag"));
  return { changed: true, version: dataset.dataset_version };
}
```

Firefox 140+ supports **Ed25519 in WebCrypto** (`crypto.subtle.importKey`/`verify` with `"Ed25519"`), so no crypto dependency is required. If you prefer a small, auditable, AMO-review-friendly dependency instead, `@noble/ed25519` (pure JS, no network) is the clean alternative — bundled, never fetched.

### 6.4 Why anti-rollback matters

Without the `dataset_version <= current` reject, an attacker (or a stale edge) can serve an *old-but-validly-signed* dataset that reinstates broker channels you've since marked `broken`. Expiry guards against *indefinitely* old data; the rollback check guards against *pinning* you to a specific older version. Keep both.

### 6.5 Fail-safe behavior

Any failure — network error, bad signature, rollback, expiry — leaves the **currently active dataset untouched** and falls back to last-good (ultimately the bundled baseline). A tampered or missing update degrades to "no change," never to "no data."

### 6.6 Fetch hygiene (privacy model)

- `credentials: "omit"` — no cookies.
- No query params, no identifiers, no fingerprinting headers. Everyone fetches the identical static URL.
- The request reveals only "an expurge user checked for updates at time T from this IP" to the host/network — and nothing more. That residual is inherent to any update check and is why the feature is opt-in.

---

## 7. Mozilla / AMO compliance

- **Remote data is allowed; remote code is forbidden.** Fetching JSON is fine; the dataset must remain declarative and be consumed by code already in the XPI. (Confirmed against current Add-on Policies / Extension Workshop.)
- **Consent.** The update fetch is user-initiated and opt-in, satisfying the data-transmission consent expectations. Disclose it plainly in the listing and in-product.
- **Reviewable source.** AMO source review requires a reproducible build; keep the signing/publish workflow and key-pinning constants legible. Pinned public keys in source are expected and fine; private keys never appear in the package.
- **Scoped permissions.** Single declared host in `optional_host_permissions`, granted at opt-in time. No `<all_urls>`.

---

## 8. Release pipeline (CI)

In `expurge-data`, on a tagged dataset release:

1. Validate `brokers.json` against the schema and trust rules (the existing CI validator: correctness + trust enforcement + expiry sanity).
2. Bump `dataset_version` (monotonic) and set `created` / `expires` / `warn_after`.
3. Sign the raw bytes with the **primary** key (CI secret) → write `brokers.sig.json`.
    - For a co-signed/emergency release, add the backup signature out-of-band from the offline key.
4. Publish `brokers.json` + `brokers.sig.json` to Pages (Actions deploy).
5. Tag the release in git as the immutable provenance record.

Routine flow is fully automated with the primary key; the offline key is only touched for rotation or emergency co-signing.

---

## 9. Cost

Zero for v1. GitHub Pages is free for public repositories, includes Fastly CDN and free Let's Encrypt TLS, and the relevant limits (100 GB/month soft bandwidth, 1 GB site cap, 10 builds/hour) are orders of magnitude beyond a tens-of-KB JSON file checked mostly via `304`s. The only optional spend is a custom domain (§3.4), and even that is independent of trust.

> Note: Pages may not be used to run a commercial business / SaaS backend. Serving a static signed dataset to an open-source, non-commercial extension is squarely the intended use — just keep it static.

---

## 10. Open decisions — RESOLVED (2026-07-09)

1. **Dual-key verification posture** (§5.2) — ✅ **Posture B** (accept either pinned key; primary
   signs routinely in CI, backup is offline for emergency re-sign + rotation).
2. **Host commitment** (§3.4) — ✅ **`data.expurge.dev`**, a custom domain on Pages from day one
   (Option B). Pinned now to avoid a future permission-churn release. Picked over `.com`/`.app`
   (2026-07-12): matches the extension id `expurge@expurge.dev` and is HSTS-preloaded (HTTPS-only).
3. **Ed25519 implementation** — ✅ **WebCrypto** (`crypto.subtle`, no dependency), given the
   Firefox 140+ floor.

---

## 11. Implementation checklist

- [ ] Create `expurge-data` repo; enable Pages (and custom domain if chosen).
- [ ] Generate primary keypair (CI secret) + backup keypair (offline/hardware store).
- [ ] Pin both public keys + `keyid`s in the extension.
- [ ] Add `dataset_version` / `created` / `expires` / `warn_after` to `brokers.json`.
- [ ] Write the sign step (raw-bytes detached signature → `brokers.sig.json`).
- [ ] Add the Actions validate-sign-publish workflow.
- [ ] Implement `verifyAndLoadDataset()` in `src/shared/` (verify → rollback → expiry → swap → last-good fallback).
- [ ] Wire the opt-in toggle to the `optional_host_permissions` grant.
- [ ] Add conditional-request (`ETag`) handling.
- [ ] Disclose the update fetch in the AMO listing and in-product.

---

## 12. Deferred to v2

- Broker drift detection as an additional re-verification trigger.
- `index.json` pointer optimization if the dataset outgrows a single cheap `GET`.
- Signed key-rotation chain / 2-of-2 signing if broker or contributor count grows.