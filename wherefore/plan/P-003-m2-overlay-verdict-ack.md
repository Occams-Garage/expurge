---
id: P-003
title: "M2: content-script overlay + four-way verdict + ACK contract"
status: done
created: 2026-07-20
updated: 2026-07-20
area: matching-overlay
topics: [webextensions, ux]
milestone: M2
decision_ref: 2026-06-28-page-classification, 2026-06-28-overlay-unknown-verdict, 2026-07-01-sidebar-run-navigation
---

Retroactive record of a shipped milestone that was later partly superseded. The verdict
model and the ACK contract persisted; the in-page shadow-DOM overlay was replaced by a
Firefox native `sidebar_action` in the 2026-07-01 sidebar migration. Source:
`plan/expurge-progress.md` (M2, and "overlay to sidebar migration"); full plan in
`plan/sidebar-nav.md`. Complete.

- [x] Shadow-DOM on-page overlay painting generic guidance only (never the user's data in the DOM)
- [x] Four-way verdict: hit / clear / unknown / skip (`unknown` a distinct verdict, not skip)
- [x] ACK contract: content script sends verdict, waits for the storage-write ack, then shows recorded; 6s timeout with 3 idempotent retries
- [x] Tab closed without a verdict counts as skipped, reason `tab_closed` (`tabs.onRemoved`)
- [x] Later superseded (2026-07-01): the overlay became a native sidebar checklist, the content script shrank to a headless challenge reporter, and the reinjection machinery plus the `scripting` permission were removed (`plan/sidebar-nav.md`)
