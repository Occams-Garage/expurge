# Spec: sidebar review cleanup (follow-up §2 + §4)

Branch `chore/sidebar-cleanup` off main (post-merge). The minor, low-risk items from the
sidebar-nav review — kept **separate** from the challenge-flag redesign so that redesign's review
stays focused. All independent; batch into one small PR. No behavior change beyond the wordmark
size and the two added pushes. Does NOT close Q-016 (that's the challenge branch).

## §2 — cleanup

### 1. Wordmark below the STYLEGUIDE minimum (#13, conventions)
`src/sidebar/style.css` `.xpg-wordmark { font-size: 20px }`; `design/STYLEGUIDE.md §4` says min
24px, below that use the glyph. Fix: either bump to ≥24px (if the narrow sidebar header has room)
OR switch the header to the glyph lockup (see STYLEGUIDE for the glyph mark). Check which reads
right at sidebar width — the tear-strip perforation collapses below 24px.

### 2. `isMissing` predicate duplicated ×4 (#10, reuse)
The same `typeof skipReason === 'string' && skipReason.startsWith('missing:')` test lives in
`src/sidebar/index.ts` (`isMissing`), `src/background/coordinator.ts` (inside `progressOf`), and
`src/options/index.ts` (×2). Extract one exported `isMissingSkip(item: WorkItem): boolean` in
`coordinator.ts` (co-located with `progressOf`, which uses it; already imported cross-boundary by
sidebar + options) and use it in all four. No behavior change; a tiny unit test is warranted.

### 3. Header progress recomputed when the view already carries it (#9, efficiency — marginal)
`renderProgress` recomputes `progressOf(run)` from a freshly-fetched `GET_RUN_STATE`, but every
pushed `SidebarView` already carries progress (`item.progress` on guidance/verdict/challenge/
offsite; top-level `progress` on revisit/done; `checked/total/hits` on stopped). Use the view's
progress for the header line; `refreshChecklist` still fetches `GET_RUN_STATE` for the item LIST
(the view doesn't carry it). Net: drops the recompute, not the fetch — marginal, do it only if
you're in the file. (Enriching the view with the item list to drop the fetch entirely is a
contract change; out of scope.)

### 4. Checklist fetch-race (#8, correctness-ish)
`renderView` does `void refreshChecklist()` (fire-and-forget). Two rapid pushes → two
`GET_RUN_STATE` in flight → out-of-order resolution can paint an older run snapshot last,
disagreeing with the just-rendered detail. Fix: a **generation token** — a module counter
incremented per `refreshChecklist` call; capture it before the await and only render the
checklist if it's still the latest when the fetch resolves.

## §4 — state-sync gaps

### 5. REVERDICT / MARK_SENT don't refresh the sidebar
`handleReverdict` and `handleMarkSent` mutate run state but don't push the sidebar, so editing an
already-completed item from the options dashboard leaves the sidebar's `done`/`stopped` summary
(hit count) stale. Fix: after each, if `run.windowId !== undefined`, push
`deriveView(updated, null, BROKERS)` — the same one-liner `handleStopRun` uses. Low priority (the
sidebar is usually on done/stopped when this happens). NOTE: the deeper fix is the
push-after-mutation choke-point (follow-up §3 altitude) — this is the tactical version; don't
build the choke-point here.

### 6. Defensive windowId guard (#15, latent)
If `getLastFocused()/getCurrent().id` is ever undefined, `run.windowId` is undefined and every
push early-returns → no sidebar updates all run. The options Start passes an explicit windowId, so
this is latent. Add a defensive `console.warn` if `resolvedWindowId` is undefined in
`handleStartRun`, so it's diagnosable rather than silent. Very low priority.

## Guardrails
- `npm run typecheck && npm test && npm run build` green (item #2 warrants a small unit test; the
  rest is UI/glue).
- One PR, one-or-two commits, e.g. `chore(sidebar): review cleanup — wordmark, isMissingSkip,
  progress source, checklist race, external-mutation pushes`.
- Manual: wordmark reads right at sidebar width; a reverdict from the dashboard refreshes the
  sidebar summary.
