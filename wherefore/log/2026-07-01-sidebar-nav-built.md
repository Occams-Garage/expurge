---
date: 2026-07-01
title: "Sidebar-nav built, reviewed, QA'd"
areas: [matching-overlay, run-model]
topics: [ux, webextensions, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Built the overlay→sidebar migration (design in 2026-07-01-sidebar-run-navigation) across ~26 commits on `feat/sidebar-nav`, then ran an extra-high multi-agent code review and Firefox QA. Several decisions emerged during build/review that the pre-build design didn't have; captured here. 164 tests green; branch PR-ready bar a deferred challenge-flag redesign.

## Decisions / outcomes
- **Eight sidebar views, all pure-derived by `deriveView`** — the design's six plus **`stopped`** (honest "checked X of Y", excludes abandoned `run_stopped` items; distinct from `done`'s "all clear") and **`offsite`** (no verdict controls when the broker tab wanders off-host, so a listing can't be "confirmed" on google.com; gated on `isOnHost`, which also catches a lookalike host sitting at the results pathname).
- **Interactive clickable checklist** via one `FOCUS_ITEM{itemId}` message + a pure `promoteToOpen` (deferred→open) transition — rows jump to a tab, revisit = FOCUS_ITEM on the first deferred. The sidebar exceeds the old overlay.
- **Challenge state is content-script per-load authoritative**: the content script reports DETECTED/RESOLVED on *every* load; background never infers challenge from navigation. This fixed an on-host Cloudflare interstitial race that briefly showed verdict controls over a "checking your browser" page.
- **Verdict ACK/retry contract restored in the sidebar** (`sendVerdictAck`: 6s/3-retry, never "recorded" without an ACK) + a `handleVerdict` no-wedge guard for idempotent retries. The content-strip had silently dropped the CLAUDE.md ack contract — a HIGH-severity data-loss bug the extra-high review caught but the per-slice reviews missed.
- **Sticky-view contract**: don't push a sidebar update when focus moves to a non-broker tab; checklist is window-scoped (cleared on `no-run`). Sidebar refreshes on external mutations (Stop→`stopped`, Delete-all→`no-run`).
- **Privacy hardening**: self-hosted the fonts (dropped the Google Fonts CDN across all surfaces); removed the now-dead `scripting` and `webNavigation` permissions.
- **Sidebar UX**: `open_at_install:false` (no auto-open on load) + a "Show scan panel" re-open button. Q-015 empirically confirmed (double gesture works in Firefox 140).

## Why
Building surfaced states the design underspecified: a stopped run isn't "done" (don't claim "all clear"); an off-host tab must not offer verdict controls (a bogus hit / wrong opt-out target). The challenge race and the dropped ACK contract both came from splitting the old overlay's logic across background + a stripped content script. The review's recall pass (10 finder angles over the whole branch) caught the ACK data-loss bug precisely because per-slice reviews trust each slice's own framing — an independent whole-branch pass doesn't.

## Alternatives considered
- **Show `done` after a Stop** — rejected: overclaims ("all clear") when the user abandoned items; added the honest `stopped` view.
- **Fix the off-host verdict-view via the challenge flag alone** — insufficient (off-host non-challenge pages, lookalike hosts); gated on `isOnHost` structurally instead.
- **Guess challenge state from `tabs.onUpdated`** — rejected: misfired on on-host interstitials, clearing the flag the content script had just set on the same load.

## Open questions / follow-ups
- Q-016: Should challenge state be modeled as content-script-owned structural state (one signal) instead of side-channel `expurge_challenge_<tabId>` session keys cleared by four disconnected paths? (Deferred review cluster, plus the in-place challenge-reappearance gap.)
- Minor review cleanup deferred (not blockers): checklist fetch-race, redundant progress refetch, `isMissing` duplicated ×4, no push-after-mutation choke-point, wordmark rendered <24px.
- See also: 2026-07-01-sidebar-run-navigation (the pre-build design + rationale).
