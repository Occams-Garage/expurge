# Plan: Sidebar-driven run navigation (replace the on-page overlay)

## Context

Today the verdict UI is a shadow-DOM **overlay** injected into each broker page (`src/content/index.ts`), fixed to the bottom-right corner. It has two structural problems (Q-013):

1. It's drawn *over* the page, so it can obscure the listing the user must read to judge.
2. It's **per-tab**. A run opens up to 5 broker tabs at once (`BATCH_SIZE`), each painting and syncing its own overlay, kept alive by a fragile `reinjectIfMissing` / `PING` / `tabs.onUpdated` re-injection loop.

We're replacing it with a **Firefox native sidebar** (`sidebarAction`) that acts as a **persistent, run-wide checklist** and drives navigation itself. This keeps the broker page fully visible (the browser reflows to make room), survives tab switches and navigations for free (a sidebar is window-level, not tab-level), and lets us delete the re-injection machinery. It also gives us a stable home for two things the overlay couldn't do well: an **always-available Skip/Defer** even on broken/challenge pages, and **per-broker instructions** ("this site lists 'premium' results first — look below them for your real profile URL").

The data-injection invariant is unchanged and actually easier to honor: the sidebar is our own document, entirely outside the broker page's DOM, and it still shows only generic broker guidance — never the user's real data.

---

## Design decisions (settled)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Firefox native `sidebarAction`**, window-level panel, as a persistent run checklist | A run-wide checklist can't live in a per-tab overlay without re-inject machinery |
| 2 | **Keep paced batch loading** (Model B); sidebar is a control surface over multiple open tabs | Slow sites (Spokeo loading bars) load in parallel while you work others; `coordinator.ts` mostly survives |
| 3 | **First-class `deferred` state**: non-terminal, frees the batch slot, keeps the tab open, revisited at the end | "Wait on a slow site, keep going, come back." No per-site "loaded" detection needed |
| 4 | **Focus-coupled single active item**: sidebar reflects the focused broker tab; actions apply to it | Mail-client list+reading-pane model; keeps "judge the page in front of you" contextual value |
| 5 | **Drive focus to the next pending item** after every action; deferred pile behind a one-click revisit | Keeps the run moving; user retains manual override by clicking any row/tab |
| 6 | **Sidebar opens from the Start-run click** (popup/options), synchronously; background never opens it | `sidebarAction.open()` needs a user gesture; background's async call would fail silently |
| 7 | **Run pinned to one window**; `windowId` threaded through | New batch tabs then show the sidebar automatically (window-level surface) |
| 8 | **Defer is its own control**, distinct from the four verdicts and from Skip; **active-tab only** | Skip = terminal give-up (closes tab); Defer = non-terminal postpone (keeps tab) |
| 9 | **Soft ceiling `MAX_OPEN_TABS = 15`**: batch window pauses when hit | "Defer everything" would otherwise open the entire broker list at once |
| 10 | **`search.guidance`**: one optional string, results-state, signed dataset, `textContent`-rendered | Per-broker navigation help without a new trust axis or an XSS vector |

**Rejected:** *Model A (single reused stage tab)* — physically can't hold a half-loaded Spokeo page while you work three other brokers; would also require a full rewrite of `coordinator.ts`.

---

## Data model changes

### `src/shared/types.ts`

- **New status:** `WorkItemStatus = 'pending' | 'open' | 'deferred' | 'verdicted'`. `deferred` is non-terminal — the item has an open tab but doesn't hold a batch slot and doesn't count as done.
- **New messages** (see §Messaging). Remove dead ones: `PingMsg`, `PongMsg`, `ReinjMsg` and their `ToBackground` entries.
- `WorkItem` keeps `tabId?` as live-session scratch (never persisted, as today).

### `src/shared/brokers.ts`

Add one optional field to the broker `search` object (currently `url` / `requires` / `exposes`, `brokers.ts:22-26`):

```ts
search: {
  url: string;
  requires: string[];
  exposes: string[];
  guidance?: string;   // NEW: generic per-site "how to find your listing" note, results-state only
}
```

Rides the existing bundled + Ed25519-signed remote dataset. **Not** subject to the opt-out `trust: verified` gate or CI trust enforcement (those govern opt-out channels where a wrong address mails PII; guidance is static generic text that can't leak anything). Rendered with `textContent` in the sidebar — never `innerHTML` — because it comes from the remote dataset into our privileged context (mirrors the existing safe `li.textContent = item` for exposes chips).

---

## Implementation

### 1. `manifest.json`

Add:
```json
"sidebar_action": { "default_panel": "dist/sidebar.html", "default_title": "expurge" }
```
No new `permissions` — `sidebarAction` is available whenever `sidebar_action` is present. Content-script `matches` stays (still needed for challenge detection).

### 2. `build.mjs`

- esbuild entry: `src/sidebar/index.ts` → `dist/sidebar.js`, `src/sidebar/style.css` → `dist/sidebar.css`.
- `copyStatics()` copies `src/sidebar/index.html` → `dist/sidebar.html`.

### 3. `src/sidebar/` (new — the checklist UI)

- **`index.html`** — links `sidebar.css` + `sidebar.js`.
- **`style.css`** — `@import "../styles/tokens.css"` directly (no shadow-DOM isolation needed). Follow `design/STYLEGUIDE.md` for voice/components; reference tokens, never hard-code values.
- **`state.ts`** — **pure** state-derivation, extracted for tests (mirrors `coordinator.ts` / `classify.ts`). Maps `(run, activeItem, focusedTabUrl, challengeFlag)` → a tagged `SidebarView`. This is where the eight view states live (see below).
- **`index.ts`** — thin render layer. On load: `browser.windows.getCurrent()` → `windowId`, send `SIDEBAR_GET_STATE({ windowId })`. Subscribe to background-pushed `SIDEBAR_UPDATE`. Render the checklist (grouped **In progress / Waiting / Done**) plus the active-item detail (broker `guidance`, "look for" chips, verdict cluster, separate Defer control). Wire the buttons to send messages. **All rendering via `textContent`** for any dataset-sourced text.

**Sidebar views** (the `state.ts` tagged union):
- `no-run` — no active run in this window
- `guidance` — active tab on the results page: `search.guidance` + "look for" chips + a **Not found / no results** action (records `clear` without visiting a details page) + a paste-URL fallback
- `verdict` — active tab on a details page: four verdicts (hit / clear / unknown / skip)
- `challenge` — active tab showing a CAPTCHA/challenge: explanation + **Skip this site**
- `saving` — action sent, awaiting ACK
- `recorded` — ACK received (tab closes 800 ms later for terminal verdicts)
- `revisit` — main pass empty, deferred items remain: "N sites waiting — revisit" (click focuses first deferred tab)
- `done` — run finished (no `pending`/`open`/`deferred` remain): terminal summary from `progressOf` (done / total / hits). Distinct from `no-run` (never started / no run in this window)

The pure `deriveView` (Slice 3) returns only the six **resting** views — `no-run` / `guidance` / `verdict` / `challenge` / `revisit` / `done`. `saving` and `recorded` are **transient** interaction states, not derivable from run state; the sidebar UI layer (Slice 6) sets them imperatively around a verdict send. They stay in the `SidebarView` union for completeness.

The **Defer** control is present alongside the active-item detail in `guidance`/`verdict`/`challenge`, visually separated from the verdict cluster, labeled with what it does ("Still loading — set aside, come back at the end").

### 4. `src/background/coordinator.ts` (pure — extend, don't rewrite) — ✅ DONE (commit `5398e5a`)

- **`selectBatch`** — counts only `open` against the window (exclude `deferred`), still one-per-broker. Ceiling: `slots = min(batchSize − open, MAX_OPEN_TABS − heldTabs)` where `heldTabs = open + deferred` — opens up to remaining headroom (not a hard zero at the ceiling). New constant `MAX_OPEN_TABS = 15`. **`claimed` now includes deferred brokers** (a deferred tab is still live — no second variant against it).
- **`applyDefer(run, itemId)`** — `open → deferred` only; never re-defers, never touches pending, never overrides a verdict. Pure, unit-tested.
- **`applyStop`** — also sweeps `deferred` → `run_stopped` (was not in the original plan; required, else a stopped run strands deferred items as non-terminal).
- **Completion** — `isComplete(run)` (no `pending`/`open`/`deferred` remain) and `progressOf(run)` (`deferred` counts toward `total`, not `done`; `missing:` skips excluded from both) — one shared definition for popup + options + sidebar.
- Untouched: `buildItems`, `withVerdict`, `applySkip`, `applyMarkSent`.

**⚠ Carried forward from the Slice-1 review — handle these in §5/§7, they're not yet done:**

1. **Wire `progressOf` into `background/index.ts:217`, not just the popup.** The background's `ITEM_INFO` handler still computes progress inline as `done = all verdicted`, `total = run.items.length` — which *includes* `missing:` skips, unlike `progressOf`. When you route the sidebar's progress through `progressOf`, replace the inline math in **both** `background/index.ts:217` **and** `popup/index.ts`. Expect the visible counter to shift (missing-field skips drop out of done/total). That's the intended single definition — just make it deliberate.
2. **The revisit trigger must handle "pending blocked behind a deferred sibling."** Because `selectBatch` claims deferred brokers, a broker with `primary=deferred, aka_0=pending` leaves `aka_0` unopenable while nothing else is open — a state with *both* pending and deferred items and no open tab (reachable today: TruePeopleSearch + one AKA). A naïve `pending.length === 0 && deferred.length > 0` revisit check **misses this** and shows nothing actionable. The §5 focus-drive/revisit logic must route "nothing open, only deferred (or deferred-blocked-pending) remain" → the Waiting/revisit view. Resolving the deferred item unblocks the pending AKA on the next `openNextBatch`. Add a test for it.
3. **Decide what `deferred` does on resume/rehydrate.** `saveRun` strips `tabId`, so a resumed `deferred` item keeps its status but has no live tab — you can't `tabs.update` a tabId that's gone. Per the plan, revisiting a resumed deferred item must open a **fresh** tab from its `renderedUrl`. The §5 background work (and the resume note under Open questions) must handle this explicitly; the pure coordinator doesn't preclude it.

### 5. `src/background/index.ts` (coordination — the real surgery)

- **Thread `windowId`.** `handleStartRun` receives `windowId` (captured at the Start click), stores it in session run state, and `openNextBatch` creates tabs with `browser.tabs.create({ url, active, windowId })`.
- **Drive focus.** After a terminal verdict/skip (tab closes) *or* a defer (tab stays open), activate the next `pending`/`open` item's tab (`tabs.update(nextTabId, { active: true })`), opening one if a slot freed. If none remain but deferred exist → push the `revisit` view; if nothing remains → done.
- **`SIDEBAR_GET_STATE({ windowId })`** — resolve window → active broker tab → item; return the `ItemInfoMsg` fields (`itemId`, `brokerId`, `exposes`, `guidance`, `renderedUrl`, `progress { done, total, hits }`) **plus** `pageType` (results/details, via the moved `isResultsPage`) and the current view. Adapt `findActiveBrokerTab` into a window-scoped variant that prefers the active tab.
- **Push `SIDEBAR_UPDATE`** on: `tabs.onActivated` (focus moved to a tracked broker tab), `tabs.onUpdated` complete (broker tab finished navigating → recompute page-type; keep the existing off-host redirect guard), and challenge messages.
- **`DEFER` handler** — `applyDefer`, keep the tab, drive focus, then `openNextBatch` (a slot freed).
- **`VERDICT` handler** — unchanged pipeline (`withVerdict` → `selectBatch`); sidebar sends `windowId`, background resolves the broker `tabId` to drop its tracking key + close it.
- **`CLOSE_TAB`** — now carries `windowId` (the sidebar is not in the broker tab, so `sender.tab?.id` no longer identifies it); background resolves the tracked tab.
- **Forward challenge** — `CHALLENGE_DETECTED` / `CHALLENGE_RESOLVED` from the content script → push `SIDEBAR_UPDATE`.
- **Remove:** `reinjectIfMissing`, `REINJECT_OVERLAY` handler, `PING`/`PONG` handler, and the reinject body of `tabs.onUpdated` (repurposed to push updates). Retain `findActiveBrokerTab`'s tab-scan logic (adapted for window→tab resolution). `tabs.onRemoved → skipped/tab_closed` stays (closing a deferred tab = skip, same as an open one).

### 6. `src/content/index.ts` — strip to a headless challenge reporter (~50 lines)

**Remove** (~630 lines): all styles, all panel builders (`buildVerdictPanel` / `buildGuidancePanel` / `buildChallengePanel` / `showMainPanel`), `sendVerdict`, `closeSelfTab`, the `GET_ITEM` call, and the `PING` listener.

**Keep / new:**
- Reuse the already-extracted, tested **`detectChallenge()`** from `classify.ts`.
- On load: if `detectChallenge()`, send `{ type: 'CHALLENGE_DETECTED' }`.
- `MutationObserver` on `document.documentElement`; when the challenge clears (250 ms debounce, lifted from the old `buildChallengePanel`), send `{ type: 'CHALLENGE_RESOLVED' }`.
- **No UI at all.** The content script never touches the page DOM.

**Move** `isResultsPage()` / `brokerHostname()` out of `content/classify.ts` into `src/shared/` (e.g. `src/shared/url.ts`) — the *background* now needs them to classify page-type, and the sidebar/content boundary shouldn't own shared pure helpers. `detectChallenge()` (DOM-dependent) stays in `content/classify.ts`. Move their tests with them.

### 7. Popup + options — remove "Restore overlay", add sidebar-open on Start

- Delete the "Restore overlay" button + `REINJECT_OVERLAY` handler from **all four** spots: `src/popup/index.html:28`, `src/popup/index.ts:41`, `src/options/index.html:51`, `src/options/index.ts:~989`.
- In the **Start-run click handler** (popup and options), call `browser.sidebarAction.open()` **synchronously in the same tick**, capture `windowId`, then send `START_RUN` with it. Do **not** route the open through background.
- Update completion display to the shared `isComplete`/`progressOf` (deferred = not done).

### Messaging (net)

```
sidebar → background:   SIDEBAR_GET_STATE {windowId}
                        VERDICT {itemId, verdict, windowId, listingUrl?}
                        DEFER   {itemId, windowId}
                        NAVIGATE_BROKER_TAB {windowId, url}     // paste-URL fallback
                        CLOSE_TAB {windowId}
background → sidebar:    SIDEBAR_UPDATE {view: SidebarView}     // push on focus/nav/challenge
content → background:    CHALLENGE_DETECTED | CHALLENGE_RESOLVED
removed:                PING / PONG / REINJECT_OVERLAY
```

---

## Files changed

| File | Change |
|------|--------|
| `manifest.json` | Add `sidebar_action` |
| `build.mjs` | Add sidebar entry + copyStatics |
| `src/sidebar/{index.html,index.ts,state.ts,state.test.ts,style.css}` | New — checklist UI + pure state machine |
| `src/background/coordinator.ts` | `deferred` in `selectBatch` + `MAX_OPEN_TABS` ceiling; `applyDefer`; shared completion helper |
| `src/background/index.ts` | Thread `windowId`; drive focus; `SIDEBAR_GET_STATE`/`DEFER`/push `SIDEBAR_UPDATE`; remove reinject/PING/REINJECT |
| `src/content/index.ts` | Strip to headless challenge reporter |
| `src/content/classify.ts` | Keep `detectChallenge`; move `isResultsPage`/`brokerHostname` out |
| `src/shared/url.ts` (+ test) | New home for the moved URL helpers |
| `src/shared/types.ts` | `deferred` status; new messages; `search.guidance`-carrying item info; remove Ping/Pong/Reinj |
| `src/shared/brokers.ts` | Add optional `search.guidance` |
| `src/popup/{index.html,index.ts}` | Remove Restore overlay; open sidebar on Start; shared completion |
| `src/options/{index.html,index.ts}` | Remove Restore overlay; open sidebar on Start; shared completion |

Unchanged: `src/shared/{gate,templates,transforms}.ts` and the pure judgments in `coordinator.ts`.

---

## Testing

Follow the established convention (pure logic in a module + Vitest, CI-gated):

- **`src/sidebar/state.test.ts`** — the seven-view machine + the results↔details boundary. New.
- **`coordinator.test.ts`** — extend for `applyDefer`, the `deferred`-aware `selectBatch`, the `MAX_OPEN_TABS` ceiling, and the completion helper. Existing pure-judgment tests should stay green untouched.
- **Moved URL helpers** — relocate `isResultsPage`/`brokerHostname` tests alongside `src/shared/url.ts`.
- `npm test` green, then `npm run build`.

---

## Open questions / risks

- **`sidebarAction.open()` user gesture** — **RESOLVED (Q-015)**. MDN confirms it may only be called from inside a user-action handler and **opens in the active window**. Resolved by design (as Q-009): call it synchronously *first* in the Start-run click handler, before the async `START_RUN`, and capture/pin the run to that active window. Remaining: a build-time smoke test that the sync-first ordering holds (call before any `await`; a call after an `await` should fail).
- **`load-error` view has no trigger.** `webNavigation.onErrorOccurred` is not wired (manifest `_notes` defers it to M9). We can ship a `load-error` view, but its trigger is a separate task; until then it's unreachable — so it's omitted from the seven views above and added when the trigger lands.
- **Resume after event-page spindown.** `windowId` lives in session state (survives spindown). If the window still exists, reuse it; if gone, the next batch opens a fresh window and the user re-opens the sidebar. Deferred items keep `deferred` but lose their tab link (tabId never persisted) → revisiting re-opens the URL fresh (worst case: slow page reloads). Same tradeoff as the existing `open → pending` revert.
- **Closing the run window** kills its broker tabs → `tabs.onRemoved` → those become `skipped/tab_closed`; the run state survives and is resumable. Destructive to in-flight tabs, not to the run (unchanged from today).

---

## Verification

1. `npm test` green; `npm run build`.
2. Load unpacked in Firefox 140+.
3. Click **Start run** in the popup → sidebar opens in that window; broker tabs open in the **same** window alongside it.
4. Broker page is not obscured (browser reflows).
5. On a results page: sidebar shows `guidance` view with `search.guidance` text; **Not found / no results** records a `clear` without visiting a details page.
6. Navigate results → details: sidebar switches to `verdict`; cast a verdict → `recorded` → tab closes ~800 ms → **focus auto-advances to the next pending item**.
7. **Defer** a slow tab → tab stays open, its slot frees, a new broker opens, focus advances. Deferred item appears in **Waiting**.
8. Defer aggressively → confirm the batch window **pauses at 15 open tabs** (no runaway).
9. Finish the main pass → sidebar shows **revisit**; click → focuses the first deferred tab; verdict or skip it to complete.
10. Challenge page → sidebar shows `challenge` + **Skip this site** works.
11. Close a broker tab without voting → item becomes `skipped/tab_closed`, run continues.
12. Confirm popup + options report **"N waiting"** (not "complete") while deferred items remain.

---

## Doc updates

- Resolve **Q-013** in the wherefore log once shipped.
- Note in CLAUDE.md's no-wedge rule that **"park"** now has two distinct meanings: *auto-skip park* (challenge/load-error → terminal skip) vs *voluntary defer* (non-terminal, revisit at end).
