---
id: P-011
title: M8 persistence opt-ins (three toggles, cross-session resume, import JSON)
status: doing
created: 2026-07-19
updated: 2026-07-28
area: run-model
topics: [privacy, ux]
milestone: M8
decision_ref: 2026-06-28-persistence-inversion, 2026-07-27-m8-persistence-optins-build, 2026-07-28-m8-persistence-optins-phase2
---

Everything is ephemeral by default (`browser.storage.session`). M8 adds three
separately controlled opt-in toggles, all default OFF, that let a user persist
specific slices to `storage.local`. Run metadata is independent of profile
storage; rich results require profile storage. Delivered in two phases
(2026-07-27): Phase 1 is the backbone (profile-storage opt-in, cross-session
resume, Storage settings UI, import JSON); Phase 2 is run metadata, the
current-run-only rich-history flag, and the first-exposure banners. Source:
`plan/expurge-plan.md` §4a + §10,
`plan/expurge-progress.md` -> M8, `wherefore/log/2026-06-28-persistence-inversion.md`,
`wherefore/log/2026-07-27-m8-persistence-optins-build.md`, and
`wherefore/log/2026-07-28-m8-persistence-optins-phase2.md`. Follow
`design/STYLEGUIDE.md` and design tokens (no hard-coded colors).

Phase 1 (done):
- [x] Background area-routing: `loadRun`/`saveRun`/`loadProfile`/`saveProfile` route by the profile-storage opt-in (write-through with inactive-area cleanup, read-active-only, no fallback; `tab_id` never durable)
- [x] Cross-session resume: pure `rehydrateForResume` (open/deferred -> pending, keep verdicts, drop the dead windowId); rehydrate on `onStartup` and `onInstalled('update')`; user-gestured `RESUME_RUN`
- [x] Settings -> Storage sub-section: profile-storage toggle (Phase 1 wires this one only)
- [x] Import JSON (Settings -> Your data): validate the full profile shape, warn-and-overwrite if a profile exists (no merge), route via `SAVE_PROFILE`
- [x] Delete-all clears the new opt-in keys and resets to the ephemeral default; signed dataset NOT gated (it lives in `storage.local` unconditionally, signed data not PII)
- [x] `GET_RUN_STATE` serialized against the write queue; `readStoragePrefs` fail-safe to ephemeral default (no-wedge)
- [x] Green-bar: `npm run typecheck && npm test && npm run build` + `npm run coverage`, plus an xhigh code review + fixes

Phase 2 (code implemented):
- Implementation plan: `plan/m8-persistence-phase2.md`.
- [x] Run metadata: per-broker last-checked date + result, no PII; wire the #2 toggle + its persistence (independent of profile storage)
- [x] Rich hits/drafts history (current-run-only): wire the #3 toggle (rides the profile-storage opt-in) + its persistence + purge-on-opt-out
- [x] Contextual first-exposure banners: Run-done -> run-metadata; Results -> rich-history; Profile -> profile-storage
- [x] Automated verification: typecheck, tests, coverage, build, extension lint, and diff check
- [ ] Manual Firefox verification of the IO/UI paths (`web-ext run` / `about:debugging`): ephemeral default, resume after restart, toggle-flip migration, import, delete-all
