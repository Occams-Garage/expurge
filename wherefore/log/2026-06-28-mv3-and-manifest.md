---
date: 2026-06-28
title: "MV3, Firefox 140+, and manifest declarations"
areas: [permissions]
topics: [webextensions, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The extension targets Manifest V3 (not MV2): the architecture already assumed the event-page model, `storage.session` is MV3-era, and AMO is heading toward MV3. Firefox minimum is 140+ to use Firefox's built-in data-collection consent UX and declare data practices in the manifest via Mozilla's data-taxonomy, including an explicit "no data collection" declaration per AMO policy 6.2.1. Resolves Q-005. See also: 2026-06-28-permissions-distribution-signing.

## Decisions / outcomes
- **MV3, not MV2.** Three things auto-resolved by this choice:
  - Host patterns → `optional_host_permissions` (not `optional_permissions` — a manifest-key error the build agent caught).
  - API permissions → `permissions` / `optional_permissions`.
  - Ephemeral run state → `browser.storage.session` (MV3-era API, fits the ephemeral-by-default persistence model exactly).
- **Firefox 140+ minimum version**: enables Firefox's built-in data-collection consent experience rather than a custom consent screen.
- **Manifest data-taxonomy declaration**: declares data practices via Mozilla's taxonomy, including an explicit "no data collection" declaration (AMO policy 6.2.1). Converts design intent into a manifest-level commitment reviewed at AMO.
- Data-taxonomy exact format = verify-against-live-docs before M0 (Q-008).
- permissions.request() user-gesture requirement in Firefox 140+ = verify before M6 (Q-009).

## Why
MV3 wasn't a deliberate early choice — it was implied by every other decision (event-page background model, `storage.session` for ephemeral run state). Naming it explicitly resolves the manifest-key placement ambiguity and aligns the codebase with AMO's direction. Firefox 140+ is the minimum that makes the data-taxonomy feature available; lower versions would require a custom consent flow that is weaker as a trust signal than Firefox's own UI.

## Alternatives considered
- MV2: not where AMO is heading; `storage.session` unavailable. Rejected.

## Open questions / follow-ups
- Q-008: Verify the exact data-taxonomy manifest format against current Mozilla docs before M0.
- Q-009: Verify whether permissions.request() requires a user gesture in Firefox 140+ before M6.
