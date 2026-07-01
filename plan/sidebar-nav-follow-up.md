# Sidebar-nav follow-ups

The overlay→sidebar migration is merged. None of these blocked the merge — they're the
items deliberately deferred from the code review, QA, and the plan, tracked here so they
don't get lost. Roughly priority-ordered within each section.

**References:** design → `wherefore/log/2026-07-01-sidebar-run-navigation.md`; build/review →
`wherefore/log/2026-07-01-sidebar-nav-built.md`; open question → **Q-016**; plan →
`plan/sidebar-nav.md`.

---

## 1. Challenge-flag lifecycle redesign — the main one (Q-016)

**Problem.** Challenge state lives as side-channel `expurge_challenge_<tabId>` keys in
`storage.session`, set/cleared by *four disconnected paths* (`CHALLENGE_DETECTED`,
`CHALLENGE_RESOLVED`, `tabs.onRemoved`, and a "must NOT be touched by `onUpdated`" rule that
lives only in a comment). This produces a class of "who clears the flag" bugs:

- **Load flicker (review #5):** `onUpdated(complete)` runs `pushActiveView` (reads
  `isChallenged`) racing the content script's `CHALLENGE_DETECTED`; if it wins, verdict/guidance
  flashes over a challenge page before the DETECTED push corrects it.
- **Orphan keys (review #14):** `handleStopRun` removes `expurge_tab_*` keys but leaves
  `expurge_challenge_<tabId>` for still-open tabs → a recycled tab id can read a stale
  `challenge=true` before its content script reports.
- **In-place reappearance gap (documented out-of-scope):** the content-script observer only
  arms on a challenge-present load and disconnects after RESOLVED, so a challenge that reappears
  *in place* (rate-limit re-gate, no navigation) is never re-reported → verdict buttons over a
  re-gated page.

**Direction.** Model challenge as **one content-script-owned structural signal per tab**,
reported authoritatively, so background never infers it from navigation or side-channels it.
Removes the `onUpdated`-must-not-touch-it ordering hazard, the orphan-key cleanup, and the
observer-rearm gap in one move.

**Effort:** medium — content-script observer lifecycle + background flag storage + possibly the
`SidebarFocus` shape. Pairs naturally with the tab-registry cleanup (§3).

---

## 2. Minor cleanup / polish (fast-follow, low risk)

- **Wordmark <24px (review #13, convention):** `src/sidebar/style.css` `.xpg-wordmark` is 20px;
  `design/STYLEGUIDE.md §4` says use the glyph below 24px. Bump to ≥24px or switch to the glyph.
- **`isMissing` duplicated ×4 (review #10):** the same `skipReason.startsWith('missing:')` test
  is in `sidebar/index.ts`, `coordinator.ts` (`progressOf`), and `options/index.ts` ×2. Extract
  one exported `isMissingSkip`.
- **Redundant progress refetch (review #9):** every pushed `SidebarView` already carries
  `progress`, but `renderProgress`/`refreshChecklist` refetch `GET_RUN_STATE` and recompute
  `progressOf` on every render. Read progress from the view (checklist still needs the item list).
- **Checklist fetch-race (review #8):** `refreshChecklist` is fire-and-forget; two rapid pushes
  can resolve out of order and paint a stale checklist. Add a generation/sequence token.

---

## 3. Altitude / structural (larger, optional)

- **Push-after-mutation choke-point (review #12):** "push after any run mutation" + the
  sticky-view rule is re-implemented at ~7 handler sites (`handleStartRun`, `handleStopRun`,
  `handleFocusItem`, `DELETE_ALL`, `CHALLENGE_*`, `onActivated`, `onUpdated`). A new mutation
  that forgets to push leaves the sidebar stale (the Start-race insurance is scar tissue).
  Consider one `pushForRun(run)` that every handler ends with.
- **tabId↔itemId registry:** both directions linear-scan `storage.session.get(null)`
  (`tabIdForItem`, `findWindowBrokerTab`) with ad-hoc prefix parsing. A single owned
  bidirectional map removes the repeated full-store scans — and is the natural home for the
  challenge flag from §1.

---

## 4. Sidebar state-sync gaps (minor)

- **REVERDICT / MARK_SENT don't push the sidebar:** editing an already-completed item from the
  options dashboard doesn't refresh the sidebar's `done`/`stopped` summary (hit count can drift).
- **windowId undefined → no pushes all run (review #15):** if `getLastFocused()/getCurrent().id`
  is ever undefined, `run.windowId` is undefined and every push early-returns. Latent (the
  options Start passes an explicit windowId); guard defensively.

---

## 5. Deferred features (planned, not bugs)

- **`load-error` view (M9):** `webNavigation.onErrorOccurred` was never wired and the
  `webNavigation` permission was dropped (re-add at M9). Broker load failures currently fall to
  manual Skip / tab-close. Add a `load-error` sidebar view + trigger when M9 broker expansion
  lands.
- **In-place challenge reappearance:** folded into §1.

---

## 6. QA coverage gaps (verify when the dataset grows)

- **Batch parallelism + `MAX_OPEN_TABS=15` ceiling:** unit-tested only; not manually exercisable
  with one broker (`selectBatch` opens one tab per broker). Verify manually once M9 adds brokers.
- **Resume after event-page spindown:** not manually forced — approximate via `about:debugging`
  → Terminate background mid-run, then trigger an event.
- **Real Cloudflare challenge:** intermittent; verify the `challenge` view and the per-load
  resolve on an actual interstitial when one is encountered.

---

## 7. Pre-AMO housekeeping (unrelated to this migration, but noted)

- **Strip the manifest `_notes` block** before AMO submission (it documents M7/M9 requirements;
  Firefox warns on unknown top-level keys).
