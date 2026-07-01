---
date: 2026-06-30
title: "Structured first/middle/last for other names"
areas: [profile]
topics: [data-model, ux]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The free-text "Other names" field (`also_known_as`) became structured First/Middle/Last
rows, and a code review of that change drove a batch of data-model and UX fixes. Bottom
line: additional names now require both first and last, incomplete rows are blocked on
save with feedback, legacy free-text data migrates into structured fields consistently,
and a set of accessibility/UX bugs in the dynamic-row form were fixed.

## Decisions / outcomes
- `also_known_as` is now `AkaName[] {first; middle?; last}` (was `string[]` "First Last").
  `last` is REQUIRED — a searchable name needs both first and last.
- Incomplete AKA rows (data present but missing first or last) BLOCK save with an inline
  error and focus the missing field — not silently dropped, not kept-and-skipped.
- `normalizeAkas` is the single migration bridge (no storage versioning): legacy free-text
  splits into first (first token) / last (last token) / middle (everything between), so a
  migrated "Jane Marie Smith" equals a fresh `{first:Jane, middle:Marie, last:Smith}`.
  Entries missing first or last (incl. single-token) are dropped; hardened so non-string
  fields can't throw.
- Middle is captured/stored but NOT yet used in search URLs — deferred to broker-dataset work.
- Dynamic-row form fixes: Enter adds a row (not submit); ≥1 row guaranteed when the form is
  shown; restored group aria-label; 44px remove target; focus follows add/remove; inputs
  `min-width:0`; export stamps a schema version; `readAkaRows` routes through `normalizeAkas`.

## Why
- The only active broker (TruePeopleSearch) requires first+last, so a name missing either
  is unsearchable — blocking with feedback beats silent data loss or storing useless
  "missing" skip rows, and requiring last mirrors the primary name (no trailing-space names).
- One normalizer with no versioning keeps form-read and stored-data canonicalization from
  drifting; splitting legacy names structurally makes migrated and fresh records identical.
- Tradeoff: search for migrated multi-token names narrows from full-name to first+last —
  accepted because it is now consistent with fresh entry, and using middle in search (#3)
  will restore full coverage for both uniformly.

## Alternatives considered
- Keep incomplete rows and let the run mark them "missing first/last": rejected — useless
  skip rows and needs derived-name trimming; blocking needs no data-model change.
- Storage versioning for the migration: rejected — one idempotent normalizer is simpler.
- Bulk multi-line name paste (like the old textarea): deferred — one-at-a-time is fine for
  the typical 1–3 names.

## Open questions / follow-ups
- Use middle in broker search URLs (deferred to broker-dataset work; structural capture now
  makes it purely additive later).
- Bulk multi-line name paste as a possible future enhancement.
- Related: `2026-06-30-aka-name-in-drafts` — its GET_DRAFT note ("split `also_known_as[idx]`
  on the first space") is now stale; drafts use the frozen `variantFirst/variantLast` and
  the field is structured. See also: `2026-06-30-vitest-test-runner` (the "no test harness"
  finding drove the test setup).
