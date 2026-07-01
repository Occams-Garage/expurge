---
date: 2026-06-30
title: "Vitest for unit tests; e2e deferred"
areas: []
topics: [testing, webextensions]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The repo has no tests, no runner, and no CI (review finding #13), and `normalizeAkas` — the
un-versioned migration bridge — had zero coverage. Decided to add Vitest with v8 coverage
over the pure `src/shared` modules, on a new branch off `feature/aka-structured-names`.
Playwright e2e is wanted but deliberately deferred.

## Decisions / outcomes
- Unit runner: **Vitest** (+ `@vitest/coverage-v8`), co-located `*.test.ts`, with
  `test` / `test:watch` / `coverage` npm scripts.
- First coverage scope: the pure `src/shared` modules only — `normalizeAkas` in depth,
  plus `renderUrl`, the draft gate, template serializers, `getBroker`. These import cleanly
  in Node; `background`/`options` need browser+DOM mocks and are deferred.
- Playwright e2e: planned, scaffolded LATER — not in this batch.
- Branch off `feature/aka-structured-names` (main has no `normalizeAkas` yet).

## Why
- Vitest over `node:test`+`tsx`: better coverage ergonomics now and the smoothest ladder to
  eventual browser/e2e testing (jsdom → Vitest Browser Mode on Playwright → `@playwright/test`),
  accepting a larger dependency tree versus the repo's minimalism.
- e2e deferred because true Firefox-runtime extension e2e is a tooling spike: Playwright
  officially loads only Chromium extensions, and this is a Firefox MV3 extension (background
  is a `scripts` event page; Chrome MV3 wants `service_worker`). `web-ext`/geckodriver aren't
  set up. Near-term e2e would be Chromium-driven UI testing of the options/popup pages.

## Alternatives considered
- `node:test` + `tsx`: rejected for now — leaner (one devDep) and on-brand for the repo's
  supply-chain-conscious minimalism, but weaker coverage/DX and no smooth path to browser tests.

## Open questions / follow-ups
- Q-014: how to run true Firefox-runtime extension e2e given the tooling gap.
- Follow-ons: jsdom + browser-mock DOM tests for the options page; extract `buildItems` from
  `background/index.ts` (logically pure but trapped) into a shared module for testability;
  GitHub Actions CI (none today — the CLAUDE.md "CI enforces trust bits" line is aspirational/M9).
- Plan detail at `temp/test_plan.md`. See also: `2026-06-30-aka-structured-name-fields`.
