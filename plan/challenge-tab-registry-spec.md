# Spec: challenge-flag redesign + tab registry

Branch `refactor/challenge-tab-registry` off main (post-merge — `git checkout main && git pull`,
then branch). Follow-up from the merged sidebar-nav migration: **Q-016** + review findings
§1/§3. Folds the two together because the challenge flag needs a structural home and the tab
registry is it. No behavior change on the happy path — this removes a class of challenge-flag
lifecycle bugs and the ad-hoc tab↔item scans.

## What it fixes (all one root cause: per-tab state is scattered and unowned)
- **Orphan challenge keys:** `handleStopRun` removes `expurge_tab_*` keys but NOT
  `expurge_challenge_*` → a recycled tab id can read a stale `challenge=true`.
- **In-place challenge reappearance:** the content observer arms only on a challenge-present
  load and disconnects after one clear, so a challenge that appears after a clean load
  (rate-limit re-gate, no navigation) is never reported → verdict buttons over a gate.
- **"Who clears the flag":** challenge is set/cleared by four disconnected paths held together
  by a comment ("`onUpdated` must not touch it"). Fragile.
- **tabId↔itemId scanned both directions ad-hoc:** `itemIdForTab` (keyed), `tabIdForItem` and
  `findWindowBrokerTab` both `storage.session.get(null)` + linear-scan `expurge_tab_`.

## Part A — one owned tab registry (`src/background/tab-registry.ts`, new)
Centralize ALL per-tab state access behind one module. Keep **two atomic session key families**
(recommended over a single `{itemId, challenged}` record — atomic set/remove avoids the
read-modify-write TOCTOU a single record would add; only go single-record if you route challenge
writes through `serialWrite`):
- `expurge_tab_<tabId>`       = itemId   (unchanged)
- `expurge_challenge_<tabId>` = true     (unchanged)

Module API (replaces the scattered access):
- `putTab(tabId, itemId)` — set the item key
- `removeTab(tabId)` — remove **BOTH** keys ← fixes orphan challenge keys
- `itemForTab(tabId): itemId | null`
- `tabForItem(itemId): tabId | null` — the reverse scan, now in ONE place
- `tabsInWindow(windowId, run)` — the `findWindowBrokerTab` scan, ONE place
- `setChallenge(tabId, on)` / `isChallenged(tabId)`

Extract the pure resolution bits — `tabForItem(snapshot, itemId)`,
`brokerTabInWindow(snapshot, tabs, run)` — as pure functions over a plain
`Record<tabId, {itemId}>` snapshot so they're unit-testable (mirrors `coordinator.ts`). The
storage read/write is the thin imperative wrapper.

Then in `background/index.ts`: replace every `expurge_tab_`/`expurge_challenge_` literal,
`itemIdForTab`, `tabIdForItem`, `findWindowBrokerTab`, `challengeKey`, `setChallengeFlag`,
`isChallenged` with the module. **Crucial:** everywhere a tab is retired (`onRemoved`,
`handleStopRun`'s tab-key sweep, `handleVerdict`'s post-close removal, `handleSkip`) call
`removeTab(tabId)` so the challenge key can never orphan.

## Part B — content script owns the challenge signal authoritatively (`src/content/index.ts`)
Today the observer arms only when the page loads challenged and disconnects after one clear.
Make it **always-armed and change-driven**:
- On load: report current state (`CHALLENGE_DETECTED` if `detectChallenge()` else
  `CHALLENGE_RESOLVED`) — unchanged.
- Keep a persistent `MutationObserver` on `document.documentElement` that tracks the
  last-reported state and, on a debounced change, reports the transition (DETECTED when a
  challenge appears, RESOLVED when it clears) — never disconnecting, de-duped by comparing to
  last-reported. Closes the in-place-reappearance gap in BOTH directions.
- Keep the `__expurgeReporterBound` idempotency latch.

Net: the content script is the single per-tab owner of the challenge signal; background only
stores what it's told (`setChallenge`) and drops it with the tab (`removeTab`).

## Part C — kill the load flicker (review #5) — OPTIONAL, verify first
`onUpdated(complete)` currently pushes with the (stale) challenge flag, racing the content's
report → verdict flashes over a challenge page. Since the content now reports on EVERY load (and
its CHALLENGE_* handler already calls `pushActiveView`), that report is the authoritative
post-load push and `onUpdated`'s push is redundant + the flicker source.
- IF you confirm the content script re-injects and reports on every broker navigation (true for
  full-page-reload brokers — the only kind in v1), **drop `onUpdated`'s `pushActiveView`** (the
  listener may then be removable entirely). One push per load, no flicker.
- CAVEAT: a future SPA broker (same-document route changes, no re-inject) would need `onUpdated`
  (or the always-armed observer watching URL changes) to refresh page-type. Leave a comment;
  don't build for it now.

Keep this as its own commit so it's easy to revert if an SPA broker lands.

## Tests
- tab-registry pure resolvers (`tabForItem`, `brokerTabInWindow`) — new unit tests, mirror
  `coordinator.test.ts`.
- `coordinator`/`deriveView` unchanged (challenge is still a `focus.challenge` bool sourced from
  the registry) — existing suite stays green.
- `npm run typecheck && npm test && npm run build` green.

## Manual verify (Firefox)
- Normal flow unchanged: challenge page → challenge view + Skip; solve → guidance/verdict.
- Orphan keys gone: after Stop, no `expurge_challenge_*` remains (log `removeTab` or inspect).
- Part C: a challenge-page load shows the challenge view with NO verdict flash first.
- In-place reappearance (best-effort — needs a cooperating page or a manual DOM inject): a
  challenge added after a clean load flips the sidebar to the challenge view.

## Commits (one per part; Part C revertable on its own)
- `refactor(bg): own per-tab state in a tab-registry (fix orphan challenge keys)`
- `feat(content): always-armed challenge observer (report reappearance in place)`
- `fix(bg): drop redundant onUpdated push — content report is the post-load driver`  (Part C)

Closes **Q-016** — resolve it in the wherefore log once merged. The §2/§4 minor cleanup is a
SEPARATE branch (`plan/sidebar-cleanup-spec.md`); don't fold it in — keep this review focused.
