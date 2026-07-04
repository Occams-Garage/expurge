---
date: 2026-07-03
title: "Tab registry owns per-tab and challenge state"
areas: [run-model, matching-overlay]
topics: [webextensions, testing]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
The sidebar migration left per-tab run state (item mapping plus the bot-challenge flag) scattered as raw session-storage keys and ad-hoc scans across the background script. This session consolidated all of it behind one owned tab-registry module and made the content script the sole authority for the challenge signal. Shipped as PR #6; answers Q-016. An extra-high-effort code review then hardened it.

## Decisions / outcomes
- Own all per-tab state behind one tab-registry module. Every `expurge_tab_<id>` and `expurge_challenge_<id>` access, and every tab-to-item scan, routes through it.
- Keep two atomic session-key families, not one combined record. `removeTab` drops both keys and the Stop sweep clears both, so a recycled tab id cannot read a stale challenge flag.
- Split the registry into a pure resolver module plus a thin I/O wrapper. The resolvers are unit-tested; the polyfill-bound wrapper is coverage-excluded.
- Make the content script the single owner of the challenge signal, via an always-armed MutationObserver that reports both appearance and clearing.
- Report a challenge appearing on the leading edge immediately; debounce only the clearing direction, and arm that timer once without resetting it.
- Drop the redundant `tabs.onUpdated` push. The content report on every full-page load is the single post-load driver.
- Capture only an on-host details URL as a verdict's listingUrl; an off-host tab captures nothing.

## Why
- The old flag was set and cleared from four disconnected paths, and the Stop sweep missed the challenge keys, so a challenge key could orphan and a recycled tab id could read it as a stale challenge. One owner plus a two-key remove makes "no orphan keys" structural, not a convention.
- Two atomic keys beat one record because set and remove stay atomic. A single record needs a read-modify-write that reintroduces a TOCTOU under the serial-write queue.
- The pure/IO split is forced by tooling: webextension-polyfill throws at import in the node test environment, so anything unit-tested must live in a polyfill-free module. This mirrors the existing coordinator.ts and index.ts split.
- A trailing-only debounce resets on every mutation, so a page mutating faster than the window never fires it and in-place detection starves. Leading-edge appearance plus a non-resetting clear timer fixes both directions.
- Removing `onUpdated` kills a push that raced the content report and flashed verdict buttons over a challenge page. The cost is that an off-host full-page navigation gets no push (content injects on-host only), so the offsite view is delayed; the on-host listingUrl guard is the real protection, since the risk is a wrong URL landing in an opt-out draft.

## Alternatives considered
- One combined `{itemId, challenged}` record per tab, rejected: needs read-modify-write and reintroduces TOCTOU.
- A single tab-registry module as first specced, rejected: the pure resolvers would not be node-testable because the polyfill throws at import.
- Keeping `tabs.onUpdated`, rejected: its push raced the content report and caused the verdict-over-challenge flash.

## Open questions / follow-ups
- Q-016 is answered and built. Resolve it on PR #6 merge, per project convention (temp/next-steps.md).
- Off-host stale verdict view (review finding #2) deferred: verdict buttons persist when a tab goes off-host in place, mitigated by the listingUrl guard; the full view-push fix is left for later.
- Real Cloudflare challenge detection is a separate finding. See also: 2026-07-03-turnstile-detection-gap.
