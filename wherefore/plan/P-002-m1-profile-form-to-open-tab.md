---
id: P-002
title: "M1: profile form to URL render to open tab"
status: done
created: 2026-07-20
updated: 2026-07-20
area: run-model
topics: [webextensions]
milestone: M1
decision_ref: 2026-06-28-profile-model, 2026-06-28-permissions-flow, 2026-06-28-profile-intake-ux
---

Retroactive record of a shipped milestone: the first end-to-end slice, profile in to a
broker search tab out. Source: `plan/expurge-progress.md` (M1). Complete.

- [x] Profile intake form (initial popup form) capturing the raw atomic fields
- [x] `deriveFields()` and `renderUrl()`: `{placeholder|transform}` token expansion with the four transforms (slug / q / upper / raw)
- [x] `permissions.request()` for the broker host, fired inside the user gesture
- [x] START_RUN wiring: background opens the rendered search URL in a tab
