---
id: P-008
title: M9 deferred cleanups and real-broker hardening
status: todo
created: 2026-07-19
area: run-model
topics: [webextensions, typescript]
milestone: M9
---

The consciously-deferred code-review findings and integration hardening that come due
once the full broker set lands ([[P-004-m9-populate-verified-brokers]]). Several are
contingent on a broker with a shape the current set lacks (SPA, second form channel).
Source: `plan/expurge-progress.md` "Known code TODOs" + "Consciously deferred" tables,
and the M7 display-path deferral.

- [ ] Full run across the real brokers; fix bugs surfaced
- [ ] Migrate the sidebar/options display-path broker lookups from compile-time `BROKERS` to the active dataset (identical today with only the bundled set; diverges once remote lands)
- [ ] Wire `browser.webNavigation.onErrorOccurred` for load-error detection (declared in manifest, not yet handled in background)
- [ ] Replace the REINJECT_OVERLAY 1-tab fallback with `openOrRecoverBatch()` (respect BATCH_SIZE)
- [ ] Handle SPA / History API navigation when a broker using pushState is added (overlay/sidebar survives client-side route change)
- [ ] Improve AKA name parsing (last-space split so "Mary Jane Smith" is not first="Mary" last="Jane Smith")
