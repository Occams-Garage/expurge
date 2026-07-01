---
date: 2026-07-01
title: "Test suite: extract pure logic, cover shipped code"
areas: []
topics: [testing, webextensions]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Executing the Vitest plan surfaced that the draft whole-app test plan's top tiers target
unbuilt code. Reconciled it: test the shipped M0–M6 code now, and reserve the dataset-verify
(M7) and schema-validator (M9) tiers to be built test-first with those features. To make the
browser/DOM-bound code testable, extracted its pure logic into side-effect-free modules.
Result: 97 tests, 100% coverage on the covered modules, on branch `test/vitest-suite`.

## Decisions / outcomes
- Scope = shipped code (M0–M6). The plan's "crown jewels" (`verifyAndLoadDataset`, schema
  validator, `expurge-data`) don't exist yet → RESERVED (M7/M9), built test-first with the
  feature. Today's crown-jewel-rigor target is the **draft gate** (`evaluateGate`) plus opt-out
  templates: 100/95/100 coverage gate on `gate.ts` + `templates.ts`, 90/80 global floor.
- **Extract-for-testability over mock-import:** pull pure logic out of the browser/DOM-bound
  entrypoints (they register listeners / run `init()` at import) into side-effect-free modules —
  `src/background/coordinator.ts`, `src/content/classify.ts`, `src/options/aka-form.ts` — tested
  directly. Behavior unchanged; the modules bundle back into their entrypoints.
- **jsdom over happy-dom** for DOM tests: happy-dom throws when materializing `<iframe>`
  elements (the challenge-detection fixtures need them); jsdom builds them inertly.
- **`web-ext lint` is CI-only** (Node 22): addons-linter SIGBUSes on the local Node 25.8.1
  build. `.github/workflows/ci.yml`: typecheck → coverage → build → lint.

## Why
- The draft plan was written against the app AS DESIGNED; an audit found no `crypto.subtle`,
  no `fetch()`, no `brokers.json`, no `.github/` — only M0–M6 ships. Testing phantom modules is
  waste; the security-critical tier that DOES ship is the draft gate ("wrong address mails PII").
- The coordinator/overlay/form logic is pure but trapped in modules that touch browser/DOM at
  import. Extracting the pure parts gives clean, fast unit tests with no heavyweight
  polyfill/DOM mock, leaving the thin I/O wiring in the entrypoint. Preferred over
  `vi.mock`-importing the whole module (heavier, brittle, coupled to import-time wiring).

## Alternatives considered
- Build the M7 verify pipeline now, test-first: rejected — that's a feature milestone, not test
  setup; it conflates the two and pulls in M7's open decisions (dual-key posture, host, crypto).
- Mock-import entrypoints instead of extracting: rejected — heavier and more brittle.
- happy-dom: rejected mid-execution — iframe materialization throws.

## Open questions / follow-ups
- Extends the scope of `2026-06-30-vitest-test-runner` (pure `src/shared` → shipped app via
  extraction); that entry's Vitest / e2e-deferred decisions still stand. Q-014 (Firefox-runtime
  e2e) remains open.
- Remaining T4: the overlay PII-injection invariant — structurally guaranteed (the content
  script never receives the profile), so a regression lock, low priority. Next steps tracked in
  `plan/testing-plan.md`.
