# Whole-application test strategy — Vitest, risk-graduated, sequenced to build status

> This revises the earlier draft: it keeps its architecture and harness design, corrected
> against the actual codebase. Only **M0–M6 ships today**, so the draft's crown-jewel tiers
> (dataset Ed25519 verify, schema validator) target unbuilt M7/M9 code and are **reserved**
> to be built test-first with those features.

## Context
No tests, no CI, no runner (finding #13). The draft is the right *framework* —
risk-graduated rigor, walking-skeleton sequencing, a reusable harness, a two-project Vitest
config, `web-ext lint` as a CI gate, per-glob coverage, `fast-check`, E2E deferred. But an
audit shows its Layer 1 (`verifyAndLoadDataset`), Layer 2 (schema validator in `expurge-data`),
and the paths `dataset/verify.ts` / `run/coordinator.ts` / `content/overlay.ts` do **not
exist**: no `crypto.subtle`, no `fetch()` in `src/`, no `brokers.json`, no `expurge-data`
repo. Decision: **test shipped code now**; reserve the dataset/schema tiers for M7/M9.

## Guiding principles (kept from the draft)
- Rigor where a bug is a security/PII bug; graduated down. Coverage is not spread evenly.
- Walking skeleton first: harness + one green test + CI on day one, then widen.
- One runner (Vitest), two projects: pure-logic in `node`, DOM/mocked in `happy-dom`.
- **Reconciliation rule (added):** a tier is built only when its target code exists.

## Runner & dependencies
Vitest with two projects. Installed **now**: `vitest`, `@vitest/coverage-v8`, `happy-dom`,
`@testing-library/dom`, `@testing-library/user-event`, `fast-check`, `web-ext`. **Reserved**
(install with the tier): `msw` (M7 dataset fetch mocking). Tests use explicit imports from
`vitest`; `*.test.ts` under `src/**` are typechecked by `tsc` but never bundled (esbuild
uses explicit entry points).

## Tiers — sequenced by build status

### Now — shipped (M0–M6)
- **T1 · Draft gate — crown-jewel rigor** (`gate.ts`, node). `evaluateGate` (not_hit;
  no_verified_channel; first verified+unexpired wins; expired/broken skipped);
  `channelExpiryState` (warn ≥6mo, expired ≥12mo). Today's "wrong address mails PII" path → 100%.
- **T2 · Opt-out generation + core transforms** (node). `templates.ts` (state→CCPA/general,
  substitution, `mailto:`/`.eml`/copy surfaces, CA DROP notice — assert structure, not the
  `TODO Q-010` legal copy). `transforms.ts` (`normalizeAkas` incl. `fast-check` property tests
  locking #4/#6; `renderUrl`). `brokers.ts` (`getBroker`, `BROKERS` invariants).
- **T3 · Coordinator** (node + `browserMock`). `buildItems`, verdict/skip reducers
  (idempotent, no-wedge), rehydration from `storage.session`, tab-closed → skipped, permission
  grant asserts the exact origin (never `<all_urls>`). Needs the extraction below.
- **T4 · Overlay + options form** (`happy-dom`). `detectChallenge` + results/details classify;
  the **PII-injection invariant** (overlay DOM never contains a profile field); options form
  (incomplete-row blocks save + focus, Enter adds a row, ≥1-row floor, save→reload — locks
  #1/#2/#5/#9/#12). Needs the extraction below.
- **T5 · Lint + CI.** `web-ext lint --source-dir dist` as a mandatory gate; `ci.yml` runs
  `typecheck`, `coverage`, `build`, `lint:ext`.

### Reserved — build test-first with the feature
- **R1 (M7) · Dataset verify pipeline** — the draft's full Layer-1 matrix (valid primary/backup,
  tampered→last-good, wrong key, both invalid, rollback, expiry, malformed-after-verify, 304,
  network-error keep-last-good, fetch hygiene, RFC 8032 vectors). Lands with `signing.ts` +
  MSW; coverage gate `src/shared/dataset/**` = 100/95/100.
- **R2 (M9) · Schema validator + `fast-check`** — in `expurge-data` (doesn't exist yet) with
  its own `dataset-ci.yml` trust-bit gate.

## Refactor-for-testability note (small, surgical — Phase 3)
`buildItems` + verdict/skip reducers are pure but trapped as private fns in
`background/index.ts` (registers listeners at import); `detectChallenge`/classification are
trapped in `content/index.ts`. **Recommended:** extract each into a side-effect-free module
(`src/background/coordinator.ts`, `src/content/classify.ts`) the entrypoint imports and wires —
then T3/T4 test pure functions directly and only the thin dispatch layer uses `browserMock`.
Alternative (no source change): `vi.mock`-import the whole module (heavier, more brittle).

## Coverage policy
`gate.ts` + `templates.ts` at 100 lines / 95 branches / 100 functions; global floor 90/80.
Coverage `include` is scoped per phase (`src/shared/**` now; widen with T3/T4). Reserve
`src/shared/dataset/**` = 100/95/100 (add when the dir exists).

## Phasing / definition of done
- **Phase 1 (skeleton, green CI) — DONE:** deps, `vitest.config.ts`, T1 gate + T2
  transforms/templates/brokers, `ci.yml` live.
- **Phase 2 (extraction + coverage) — DONE:** 2a coordinator (`src/background/coordinator.ts`),
  2b content classify (`src/content/classify.ts`), 2c the "Other names" form
  (`src/options/aka-form.ts`) — each extracted from its browser/DOM-bound entrypoint and
  covered directly. Swapped happy-dom → jsdom (iframe fidelity).
- **Remaining T4:** the overlay PII-injection invariant. Low marginal value — the content
  script never receives the profile (GET_ITEM returns only `exposes`/progress), so the overlay
  is structurally PII-free; a test needs the large overlay renderer extracted. Optional.
- **Reserved:** R1 with M7 (dataset verify), R2 with M9 (schema validator).

## Execution status (2026-07-01)
- Branch `test/vitest-suite` off `feature/aka-structured-names`. Four commits (Phase 1, 2a, 2b, 2c).
- **97 tests, 7 files, green.** `npm run coverage` → 100% stmts/functions/lines and 100%
  branches across `src/shared/**` + `coordinator.ts` + `classify.ts` + `aka-form.ts`;
  thresholds enforced (gate.ts/templates.ts 100/95/100). `npm run typecheck` green;
  `node build.mjs` clean (no `*.test.ts` in `dist/`; extracted modules bundle into their
  entrypoints).
- **Local caveat:** `web-ext lint` (addons-linter) crashes with SIGBUS on this machine's
  Node 25.8.1 build (vitest/tsc are fine). CI pins Node 22 (`ci.yml`), where it runs normally.
  Verify the lint gate there rather than locally on Node 25.

## Next steps (pick up cold from here)

Branch `test/vitest-suite` is at commit `9c5851b` — 97 tests, 100% coverage, nothing pushed.

### A. Finish tier T4 (this branch or a follow-up)
1. **Overlay PII-injection invariant.** Extract the overlay renderer from
   `src/content/index.ts` (`createOverlayShell`, `buildGuidancePanel`, `buildVerdictPanel`,
   `buildChallengePanel`) into e.g. `src/content/overlay.ts`, then in jsdom render each panel
   from an `ItemInfoMsg` and assert the (shadow) DOM contains only the generic `exposes`
   strings — never a profile field. Note: structurally guaranteed today (the content script
   never receives the profile — `GET_ITEM` returns only `exposes`/progress), so this is a
   regression lock, not a live bug hunt. Largest remaining extraction; low marginal value.
2. **Options + background integration (optional, brittle).** The message-dispatch layer in
   `background/index.ts` and `options/index.ts`'s `init()`/`handleProfileSave` wiring aren't
   covered — the pure logic underneath them is (coordinator, aka-form). To cover the wiring,
   build the deferred helpers `tests/helpers/browserMock.ts` (`vi.mock('webextension-polyfill')`
   backed by an in-memory `tests/helpers/fakeStorage.ts`), load the real `options/index.html`
   into jsdom, import the entrypoint, and drive it. Heavier and more coupled to import-time
   wiring — weigh against the value, since the core logic is already unit-tested.

### B. Reserved — build test-first with the feature
3. **R1 (M7) — dataset Ed25519 verify pipeline.** When implementing `verifyAndLoadDataset`
   (`plan/dataset-delivery.md` §6), co-author the full Layer-1 matrix: valid primary/backup
   sig, tampered→last-good-untouched, wrong key, both invalid, anti-rollback, expiry,
   malformed-after-verify, 304 no-op, network-error keep-last-good, fetch hygiene (no
   creds/params), RFC 8032 known-answer vectors. Add `tests/helpers/signing.ts` (Ed25519
   keypair + `makeSignedDataset`) and MSW (`npm i -D msw`) for the fetch. Add coverage gate
   `src/shared/dataset/**` = 100/95/100 to `vitest.config.ts`.
4. **R2 (M9) — schema validator + `fast-check`.** Lives in the (not-yet-created) `expurge-data`
   repo with its own `dataset-ci.yml` trust-bit gate; `fast-check` fuzzes invariant violations.

### C. Infra / housekeeping
5. **Unbreak local lint.** Add `.nvmrc` = `22` (matches CI) so `npm run lint:ext` runs locally;
   or leave lint as CI-only and document it. The Node 25.8.1 SIGBUS is the only local gap.
6. **Widen coverage `include`** in `vitest.config.ts` as tiers land (currently `src/shared/**`
   + `coordinator.ts` + `classify.ts` + `aka-form.ts`).
7. **PR.** Open `test/vitest-suite` → its base once `feature/aka-structured-names` is settled
   (it branched off the feature branch, so sequence the merges: feature first, then this).
8. **Commit the plan docs?** `plan/testing-plan.md` and `plan/dataset-delivery.md` are still
   untracked working docs — track them if they should live in history.
