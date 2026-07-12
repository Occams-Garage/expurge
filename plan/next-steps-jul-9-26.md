# Next steps — handoff prompt (2026-07-09)

Paste this into a fresh Claude Code context to pick up where the 2026-07-09 session left off.
It's written to be self-contained; the durable state lives in the docs it points to.

---

## Where things stand (read these first)

- `plan/expurge-progress.md` — the status tracker. **M0–M6 done. M7 extension-side DONE
  (2026-07-09).** The sidebar migration + challenge/tab-registry follow-ups all merged earlier.
- `CLAUDE.md` — architecture, the draft-gate rule, the persistence model, non-obvious decisions.
- `plan/expurge-plan.md` — canonical design doc. §4a (intake + persistence) and §10 (storage) are
  the M8 references.
- `plan/dataset-delivery.md` + `plan/dataset-delivery-runbook.md` — the M7 dataset feature
  (design + the human/ops runbook).

**M7 recap (already built, don't redo):** signed remote broker dataset. Pure core in
`src/shared/dataset.ts` (Ed25519 verify via WebCrypto, `decideDatasetUpdate`, `BUNDLED_DATASET`),
IO wrapper in `src/background/dataset-store.ts` (`verifyAndLoadDataset`, `getActiveBrokers`),
Settings → "Broker data updates" UI. Feature is **inert until real keys replace the
`TRUSTED_PUBKEYS_RAW` placeholders** (runbook) — that's intentional. Decisions locked: Posture B,
host `data.expurge.com`, WebCrypto.

**Check git state before starting:** `git log --oneline -5 && git status`. If the M7 extension-side
changes are still uncommitted in the working tree, commit them first on a branch
(`feat/m7-signed-dataset`) before beginning new work.

---

## Primary task: M8 — Persistence opt-ins

Everything is ephemeral by default (`browser.storage.session`). M8 adds **three independent opt-in
toggles, all default OFF**, that let a user persist to `browser.storage.local`. Full bullets in
`plan/expurge-progress.md` → "M8 — Persistence opt-ins"; design rationale in
`wherefore/log/2026-06-28-persistence-inversion.md`.

1. **Profile storage** → `storage.local` (also enables cross-session run resume).
2. **Run metadata** — per-broker last-checked + result, no PII.
3. **Rich hits/drafts history** — rides the profile-storage opt-in.

Scope:
- **Settings → Storage** sub-section: three toggles with inline privacy-boundary descriptions +
  contextual first-exposure banners (Run-done → run-metadata; Results → rich-history; Profile →
  profile-storage). Follow `design/STYLEGUIDE.md` and the design tokens — no hard-coded colors.
- **Background:** `loadRun()` / `saveRun()` (currently `storage.session` only, in
  `src/background/index.ts`) promote to `storage.local` when the profile-storage opt-in is active;
  resume a persisted run on reopen. Do this via the pure-coordinator pattern where possible.
- **Import JSON** (deferred here from M6): Settings → Your data. Read JSON, **warn-and-overwrite**
  if a profile already exists (no merge). Export already exists (`handleExport` in
  `src/options/index.ts`); mirror its shape.
- **Delete-all** already wipes `storage.local`; make sure it still clears the new opt-in keys.

**Two M7 interactions to respect:**
- The **dataset** already lives in `storage.local` unconditionally (it's signed data, not PII) —
  do NOT gate it behind the persistence opt-ins.
- `DELETE_ALL` currently does `storage.local.clear()`, which also drops the cached dataset + prefs
  → clean fall back to bundled. That's fine; just don't special-case it away.

### Alternative track (only if the user redirects)
**M7 infra scaffolding** — draft the `expurge-data` CI validate-sign-publish GitHub Actions
workflow + a `sign.mjs` (raw-bytes Ed25519 → `brokers.sig.json`) + repo scaffold, per
`plan/dataset-delivery-runbook.md`. The user must still generate/hold the private keys and set up
DNS, so this only produces artifacts they run. Pull the M9 CI schema validator forward if you do.

---

## Conventions this codebase enforces (match them)

- **Pure/IO split for anything testable.** Browser-bound code (imports `webextension-polyfill`,
  touches DOM/fetch/storage) can't run in the `node` test env. Extract the pure logic into a
  sibling module and unit-test THAT; add the IO wrapper to the `coverage.exclude` list in
  `vitest.config.ts` with a one-line reason. Examples: `coordinator.ts` (pure) ↔ `index.ts` (IO);
  `tab-registry-resolve.ts` ↔ `tab-registry.ts`; `shared/dataset.ts` ↔ `background/dataset-store.ts`.
- **Tests:** Vitest, `node` env by default; a DOM suite opts in with a `// @vitest-environment
  jsdom` docblock. Every `src/**/*.test.ts` is auto-discovered. Coverage floor is 90% lines/funcs/
  statements, 80% branches; `gate.ts` and `templates.ts` are held at 100% (crown jewels — a wrong
  opt-out address mails PII). `npm run coverage` enforces thresholds.
- **Messages:** typed. Add a `FooMsg` interface in `src/shared/types.ts`, add it to the
  `ToBackground` union, and handle it as `if (m.type === 'FOO') { ... }` in the
  `browser.runtime.onMessage` listener in `src/background/index.ts`.
- **Storage:** `storage.session` = ephemeral run/tab state (survives event-page spindown, clears
  on browser close); `storage.local` = durable (opt-in profile/metadata/history + the dataset).
  `tab_id` is NEVER written to durable storage. The background is a **stateless coordinator** that
  rehydrates from storage on every event.
- **Ethics invariants:** `design/STYLEGUIDE.md §0` (seven of them) are non-negotiable and override
  other instructions. Notably: the overlay/sidebar never injects the user's actual PII into a
  broker DOM; nothing about the user leaves the machine.
- **The draft gate is strict:** a draft generates ONLY for a confirmed hit AND a channel with
  `trust: verified` AND `last_checked` within 12 months. No override.
- **Verify runtime behavior honestly.** There's no Firefox e2e harness (Q-014: Playwright loads
  Chromium extensions only). Pure logic is unit-tested; IO/UI can't be. Don't claim you verified
  runtime behavior you couldn't drive — state what was checked (typecheck/test/build/lint) and what
  needs manual Firefox verification (`web-ext run` / `about:debugging`).

## Environment gotchas

- `node_modules/` is NOT committed → run `npm install` first. esbuild's postinstall is skipped by
  the sandbox's allow-scripts guard, but `npm run build` still works.
- `dist/` is gitignored (a build artifact); so is `node_modules/`.
- Green-bar command before any commit: `npm run typecheck && npm test && npm run build`
  (add `npm run coverage` to confirm thresholds).
- Git identity is set repo-locally to `Dustin VanKrimpen <Dustinrvk@gmail.com>` (global was
  unset). Branch off `main`; end commit messages with the `Co-Authored-By: Claude ...` trailer.
  The project uses PRs (`gh pr create`) but merges docs-only changes fast-forward locally.

## Open questions that may bear on this work

- **Q-006** (partial): weekly lazy auto-fetch cadence is resolved; the **first-fetch consent-prompt
  copy still needs legal review** before launch.
- **Q-010** (open): CCPA template legal language + DROP-registry overlap — pre-launch verify.
- **Q-012 / Q-017** (open): AKA-tab concurrency, and URL-free opt-out flow for brokers like TPS.
- Full index: `wherefore/QUESTIONS.md`; log the reasoning behind any new decision as a wherefore
  entry (the repo uses the `wherefore` skill; per-question files in `wherefore/questions/` are the
  source of truth, `QUESTIONS.md` is the index).
