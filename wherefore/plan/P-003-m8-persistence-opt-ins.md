---
id: P-003
title: M8 persistence opt-ins (three toggles, cross-session resume, import JSON)
status: todo
created: 2026-07-19
area: run-model
topics: [privacy, ux]
milestone: M8
decision_ref: 2026-06-28-persistence-inversion
---

Everything is ephemeral by default (`browser.storage.session`). M8 adds three
independent opt-in toggles, all default OFF, that let a user persist to
`storage.local`. Source: `plan/expurge-plan.md` §4a + §10, `plan/expurge-progress.md`
-> M8, `wherefore/log/2026-06-28-persistence-inversion.md`. Follow `design/STYLEGUIDE.md`
and design tokens (no hard-coded colors).

- [ ] Settings -> Storage sub-section: three toggles with inline privacy-boundary descriptions (profile storage; run metadata, no PII; rich hits/drafts history, rides the profile opt-in)
- [ ] Contextual first-exposure banners: Run-done -> run-metadata; Results -> rich-history; Profile -> profile-storage
- [ ] Background: `loadRun()` / `saveRun()` promote to `storage.local` when the profile-storage opt-in is active (keep the stateless-coordinator pattern; `tab_id` never durable)
- [ ] Cross-session resume: a persisted run rehydrates on reopen (`open` items revert to `pending`, verdicted items keep verdicts)
- [ ] Import JSON (Settings -> Your data): read JSON, warn-and-overwrite if a profile exists (no merge); mirror `handleExport` shape
- [ ] Confirm delete-all still clears the new opt-in keys; do NOT gate the signed dataset (it lives in `storage.local` unconditionally, it is signed data not PII)
- [ ] Green-bar: `npm run typecheck && npm test && npm run build` + `npm run coverage` (thresholds hold)
