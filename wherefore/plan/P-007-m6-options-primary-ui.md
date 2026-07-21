---
id: P-007
title: "M6: options page as primary UI + popup redesign"
status: done
created: 2026-06-29
updated: 2026-06-30
topics: [ux]
milestone: M6
decision_ref: 2026-06-29-m6-options-design-decisions, 2026-06-28-ux-architecture, 2026-06-30-results-broker-grouped
---

Retroactive record of a shipped milestone: promoted the options page to the primary
surface and stripped the popup to a run-control panel. Source:
`plan/expurge-progress.md` (M6). Complete.

- [x] `options_ui.open_in_tab: true`; `onInstalled` opens the options page
- [x] Four-section options page (Run / Results / Profile / Settings) with 2s polling and a run state machine
- [x] All 10 Profile fields; SAVE_PROFILE / GET_PROFILE handlers
- [x] Results: verdict groups with inline draft panels, `general_contact` amber callout, mark-as-sent (`optedOutAt`), MARK_SENT / DELETE_ALL
- [x] Settings: preferred send method in `storage.local`, broker coverage list, export JSON
- [x] Popup stripped to a run-control-panel (open dashboard / restore overlay / stop)
