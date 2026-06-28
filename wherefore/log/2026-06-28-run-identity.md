---
date: 2026-06-28
title: "Run identity: UUID plus scratch tab_id"
areas: [run-model]
topics: [data-model, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
A run is identified by a UUID plus a separate `created_at` timestamp (not sequential). `tab_id` is live-session scratch — never written to durable storage. On resume, open items drop their tab and revert to pending; verdicted items keep their verdicts. This makes recycled-tab-ID privacy hazards structurally impossible.

## Decisions / outcomes
- **Run ID = UUID** (random, not sequential). Sequential IDs reveal ordering and run count to anyone reading storage.
- `created_at` is a separate timestamp field, not derived from the ID.
- `tab_id` lives in session-scoped run state (`storage.session`) only — never written to `storage.local` or any durable store.
- **Resume behavior**: open items (tab was live when session ended) → drop `tab_id`, revert to `pending`, reopen fresh. Verdicted items → keep verdict, untouched.
- Recycled-tab-ID privacy hazard is structurally impossible: no durable record ever holds a tab ID, so there is no stale mapping to exploit.

## Why
Firefox recycles tab IDs across sessions. If `tab_id` were written to durable storage, a resumed run could associate an old tab ID with whatever URL Firefox assigned it next — a privacy hazard where a broker URL could appear associated with an unrelated site. Keeping `tab_id` in `storage.session` means the data doesn't exist after browser close. UUID run IDs prevent inference of run history by anyone with storage access. Discard-on-resume is the minimal correct behavior: reopen what wasn't finished, preserve what was decided.

## Alternatives considered
- Sequential run IDs: rejected — reveals run count and ordering.
- Persisting `tab_id` to `storage.local`: rejected — creates a recycled-tab-ID privacy hazard on resume.

## Open questions / follow-ups
- None.
