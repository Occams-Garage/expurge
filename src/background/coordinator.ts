// Pure run-state logic for the background coordinator — no browser/DOM, no side effects.
// index.ts owns the storage/tab I/O and calls these to transform run state, so both the
// live-tab path and the dashboard path share one set of transitions (they can't drift).

import type { Profile, RunState, WorkItem, WorkItemStatus, Verdict, SkipReason } from '../shared/types';
import { BROKERS, type Broker } from '../shared/brokers';
import { normalizeAkas, renderUrl } from '../shared/transforms';

export const BATCH_SIZE = 5;

// Soft ceiling on tabs a run holds open at once (open + deferred). Without it, deferring
// every slow site would open the entire broker list in parallel. The batch window pauses
// here until deferred tabs are cleared at the end of the run.
export const MAX_OPEN_TABS = 15;

// Expand a profile into (broker × name-variant) work items. Variants: primary name
// first, then each AKA (first/last frozen on the item so drafts never re-parse the
// mutable profile). Missing a required field pre-verdicts the item as a `missing:` skip
// (counts toward progress, opens no tab). `brokers` is injectable for tests.
export function buildItems(profile: Profile, brokers: readonly Broker[] = BROKERS): WorkItem[] {
  const items: WorkItem[] = [];

  const variants: Array<{ nameVariant: string; first: string; last: string }> = [
    { nameVariant: 'primary', first: profile.first.trim(), last: profile.last.trim() },
    ...normalizeAkas(profile.also_known_as).map((aka, i) => ({
      nameVariant: `aka_${i}`,
      first: aka.first,
      last:  aka.last,
    })),
  ];

  for (const broker of brokers) {
    if (broker.status !== 'active') continue;
    for (const variant of variants) {
      const vProfile = { ...profile, first: variant.first, last: variant.last };
      const profileMap = vProfile as unknown as Record<string, unknown>;
      const missingField = broker.search.requires.find(f => {
        const val = profileMap[f];
        if (Array.isArray(val)) return val.length === 0;
        return !(val as string | undefined)?.trim();
      });
      if (missingField) {
        items.push({
          id: `${broker.id}:${variant.nameVariant}`,
          brokerId: broker.id,
          nameVariant: variant.nameVariant,
          variantFirst: variant.first,
          variantLast: variant.last,
          renderedUrl: '',
          status: 'verdicted',
          verdict: 'skipped',
          skipReason: `missing:${missingField}` as SkipReason,
        });
        continue;
      }
      items.push({
        id: `${broker.id}:${variant.nameVariant}`,
        brokerId: broker.id,
        nameVariant: variant.nameVariant,
        variantFirst: variant.first,
        variantLast: variant.last,
        renderedUrl: renderUrl(broker.search.url, vProfile),
        status: 'pending',
      });
    }
  }
  return items;
}

// Return a run with the given item's verdict applied. Drops matchedAs first, then
// re-adds it only for a hit — so a hit→non-hit re-verdict can't leave a stale match.
// Keeps the existing listingUrl unless a new one is supplied.
export function withVerdict(run: RunState, itemId: string, verdict: Verdict, listingUrl?: string): RunState {
  return {
    ...run,
    items: run.items.map(i => {
      if (i.id !== itemId) return i;
      const { matchedAs: _drop, ...rest } = i;
      return {
        ...rest,
        status: 'verdicted' as WorkItemStatus,
        verdict,
        ...(listingUrl !== undefined ? { listingUrl } : {}),
        ...(verdict === 'hit' ? { matchedAs: i.nameVariant } : {}),
      };
    }),
  };
}

// Mark an item skipped — but never overwrite an already-verdicted item (no-wedge:
// a verdict already recorded wins over a later tab-closed/skip event).
export function applySkip(run: RunState, itemId: string, skipReason: SkipReason): RunState {
  return {
    ...run,
    items: run.items.map(i =>
      i.id === itemId && i.status !== 'verdicted'
        ? { ...i, status: 'verdicted' as WorkItemStatus, verdict: 'skipped', skipReason }
        : i,
    ),
  };
}

// Set an open item aside: open → deferred. Non-terminal — the tab stays open (the caller
// leaves it), but the item frees its batch slot so another broker can open while this one
// finishes loading. Only from 'open': never re-defers, never touches a pending item, and
// never overrides a verdict (no-wedge — a recorded verdict wins over a later defer event).
export function applyDefer(run: RunState, itemId: string): RunState {
  return {
    ...run,
    items: run.items.map(i =>
      i.id === itemId && i.status === 'open'
        ? { ...i, status: 'deferred' as WorkItemStatus }
        : i,
    ),
  };
}

// The inverse of applyDefer: bring a set-aside item back, deferred → open, so it rejoins the
// normal verdict/defer flow. Only from 'deferred' — a pending item must instead go through the
// tab-creating path (ensureItemTab); promoteToOpen never conjures an `open` item with no live
// tab. No-op on open/pending/verdicted. Pure; the caller (FOCUS_ITEM) activates the tab.
export function promoteToOpen(run: RunState, itemId: string): RunState {
  return {
    ...run,
    items: run.items.map(i =>
      i.id === itemId && i.status === 'deferred'
        ? { ...i, status: 'open' as WorkItemStatus }
        : i,
    ),
  };
}

// Stop the run: every still-pending/open/deferred item becomes skipped:run_stopped.
export function applyStop(run: RunState): RunState {
  return {
    ...run,
    items: run.items.map(i =>
      i.status === 'pending' || i.status === 'open' || i.status === 'deferred'
        ? { ...i, status: 'verdicted' as WorkItemStatus, verdict: 'skipped' as Verdict, skipReason: 'run_stopped' as SkipReason }
        : i,
    ),
  };
}

// Stamp a hit item as opted-out — but never re-stamp (preserves the original send date).
export function applyMarkSent(run: RunState, itemId: string, nowIso: string): RunState {
  return {
    ...run,
    items: run.items.map(i =>
      i.id === itemId && i.verdict === 'hit' && !i.optedOutAt
        ? { ...i, optedOutAt: nowIso }
        : i,
    ),
  };
}

// A run is done only when nothing is still in flight: no pending, open, or deferred items
// remain (deferred is non-terminal — its tab is open and its verdict isn't in yet). Popup,
// options, and the sidebar share this one definition so their "done" states can't drift.
export function isComplete(run: RunState): boolean {
  return !run.items.some(
    i => i.status === 'pending' || i.status === 'open' || i.status === 'deferred',
  );
}

// Shared run progress. `done`/`total` exclude pre-verdicted `missing:` skips (the user never
// sees those as work to do); `deferred` counts toward `total` but not `done` (tab open,
// verdict pending). `hits` is over all items — a `missing:` skip is never a hit. Every
// progress readout (popup, options, sidebar, ITEM_INFO) reads from here so they stay in sync.
export function progressOf(run: RunState): { done: number; total: number; hits: number } {
  const checkable = run.items.filter(
    i => !(typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:')),
  );
  return {
    done:  checkable.filter(i => i.status === 'verdicted').length,
    total: checkable.length,
    hits:  run.items.filter(i => i.verdict === 'hit').length,
  };
}

// Pure batch selection: choose up to (batchSize − openCount) pending items to open, at
// most one per broker (counting already-open brokers) so we never hammer one site with
// parallel AKA queries. Only `open` items count against the batch window — `deferred` ones
// freed their slot — but both hold a real tab, so `open + deferred` is capped at
// `maxOpenTabs`: when that ceiling is hit the window pauses (opens nothing) rather than
// letting a defer-everything run open the whole broker list at once. Returns the items to
// open plus the run with them flipped to 'open'; the caller performs the actual tab creation.
export function selectBatch(
  run: RunState,
  batchSize: number = BATCH_SIZE,
  maxOpenTabs: number = MAX_OPEN_TABS,
): { toOpen: WorkItem[]; run: RunState } {
  const openCount = run.items.filter(i => i.status === 'open').length;
  const heldTabs  = openCount + run.items.filter(i => i.status === 'deferred').length;
  // Bound by both the batch window (slots left) and the tab ceiling (headroom left).
  const slots = Math.min(batchSize - openCount, maxOpenTabs - heldTabs);
  if (slots <= 0) return { toOpen: [], run };

  // A deferred tab is still a live tab on that site, so its broker is claimed too — don't
  // open a second variant against a broker we already have open or set aside.
  const claimed = new Set(
    run.items.filter(i => i.status === 'open' || i.status === 'deferred').map(i => i.brokerId),
  );
  const toOpen: WorkItem[] = [];
  for (const item of run.items) {
    if (toOpen.length >= slots) break;
    if (item.status !== 'pending' || claimed.has(item.brokerId)) continue;
    toOpen.push(item);
    claimed.add(item.brokerId);
  }
  if (toOpen.length === 0) return { toOpen: [], run };

  const ids = new Set(toOpen.map(p => p.id));
  const updated: RunState = {
    ...run,
    items: run.items.map(i => (ids.has(i.id) ? { ...i, status: 'open' as WorkItemStatus } : i)),
  };
  return { toOpen, run: updated };
}

// The item to move focus to after an action — the first `open` item (a loaded tab, ready to
// judge now), or null. Callers run selectBatch/openNextBatch FIRST, so any *openable* pending
// is already `open`; a leftover `pending` is blocked behind a deferred/open sibling broker
// (one-per-broker) and must NOT be force-opened (finding #2) — null routes deriveView to the
// revisit view instead. `deferred` is never an auto-focus target (revisit it deliberately).
// Pure; the caller resolves the id to a live tab.
export function nextFocusTarget(run: RunState): string | null {
  return run.items.find(i => i.status === 'open')?.id ?? null;
}
