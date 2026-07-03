---
date: 2026-07-01
title: "Sidebar replaces on-page overlay for run nav"
areas: [matching-overlay, run-model, broker-dataset]
topics: [ux, webextensions, privacy]
stories: []
status: active
supersedes: 2026-06-30-overlay-tab-vs-overlay
superseded_by:
superseded_date:
---

## Summary
Decided (via a grilling session) to replace the per-tab shadow-DOM overlay with a Firefox native `sidebarAction` sidebar that acts as a persistent, run-wide checklist and drives navigation itself. Resolves Q-013. The sidebar keeps the broker page fully visible, is window-level (survives tab switches and new tabs for free), and lets us delete the reinjection / PING / Restore-Overlay machinery.

## Decisions / outcomes
- Sidebar, not overlay: window-level checklist grouped In progress / Waiting / Done; generic guidance only (data-injection invariant intact).
- Keep paced batch loading (Model B): sidebar is a control surface over multiple open tabs; `coordinator.ts` pure logic mostly survives.
- First-class `deferred` state: non-terminal, frees the batch slot, keeps the tab open, revisited at the end. No per-site "loaded" detection.
- Focus-coupled single active item: verdict/defer/skip act on the focused broker tab; after each action background drives focus to the next pending item; deferred pile sits behind a one-click "revisit".
- Defer is its own control, active-tab only, distinct from Skip (which stays terminal).
- Sidebar opens from the Start-run click (popup/options), synchronously.
- Run pinned to one window; `windowId` threaded through so batch tabs open there.
- Soft ceiling `MAX_OPEN_TABS = 15` so "defer everything" can't open the whole broker list at once.
- New `search.guidance` string (per-broker results-page note), rides the signed dataset, no new trust bit, rendered via `textContent`.
- Content script drops to a headless challenge reporter (`CHALLENGE_DETECTED` / `CHALLENGE_RESOLVED`); all UI moves to the sidebar.

## Why
An overlay drawn over the page obscures the listing and, being per-tab, needs constant reinjection across a 5-tab batch. A sidebar is window-level: open once, present on every tab, no reinjection. The reframe (persistent checklist + always-available Skip/Defer + per-broker instructions) simply can't live in a per-tab overlay. Batch loading stays because slow sites (Spokeo loading bars) must load in parallel while the user works others, which a single reused tab physically can't do. "Revisit at the end" avoids per-site load detection (which would break the no-per-site-extraction rule). Opening the sidebar from the Start click sidesteps the `sidebarAction.open()` gesture requirement (same precedent as Q-009). `search.guidance` renders as `textContent` because remote-dataset text flowing into our privileged sidebar context is an XSS vector.

## Alternatives considered
- Model A, single reused stage tab: rejected. Can't hold a half-loaded slow page while working other brokers, and forces a full `coordinator.ts` rewrite.
- Sidebar as the primary app UI: not this. That was rejected earlier (`2026-06-28-ux-architecture`) for the popup/options app. Here the sidebar is only the in-run checklist; popup stays launcher, options stays the full app.
- Full-height DOM strip (overlay variant): still overlaps the page and keeps the per-tab reinjection problem.

## Open questions / follow-ups
- Q-015: Does `sidebarAction.open()` require a user gesture in Firefox 140, and does calling it synchronously in the Start handler (before the async `START_RUN` round-trip) satisfy it? Designed around; needs live-doc confirmation.
- `load-error` sidebar view deferred: no trigger wired (`webNavigation.onErrorOccurred` was removed per `2026-06-29-cloudflare-challenge-handling`; manual Skip covers it for now).
- See also: `2026-06-29-cloudflare-challenge-handling`. Its `detectChallenge` / hostname-guard / tab-close decisions carry forward; only "Restore Overlay" is retired by this entry.
