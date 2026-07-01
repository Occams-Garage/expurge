// Pure run-state logic for the background coordinator — no browser/DOM, no side effects.
// index.ts owns the storage/tab I/O and calls these to transform run state, so both the
// live-tab path and the dashboard path share one set of transitions (they can't drift).

import type { Profile, RunState, WorkItem, WorkItemStatus, Verdict, SkipReason } from '../shared/types';
import { BROKERS, type Broker } from '../shared/brokers';
import { normalizeAkas, renderUrl } from '../shared/transforms';

export const BATCH_SIZE = 5;

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

// Stop the run: every still-pending/open item becomes skipped:run_stopped.
export function applyStop(run: RunState): RunState {
  return {
    ...run,
    items: run.items.map(i =>
      i.status === 'pending' || i.status === 'open'
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

// Pure batch selection: choose up to (batchSize − openCount) pending items to open, at
// most one per broker (counting already-open brokers) so we never hammer one site with
// parallel AKA queries. Returns the items to open plus the run with them flipped to
// 'open'; the caller performs the actual tab creation.
export function selectBatch(
  run: RunState,
  batchSize: number = BATCH_SIZE,
): { toOpen: WorkItem[]; run: RunState } {
  const openCount = run.items.filter(i => i.status === 'open').length;
  const slots = batchSize - openCount;
  if (slots <= 0) return { toOpen: [], run };

  const claimed = new Set(run.items.filter(i => i.status === 'open').map(i => i.brokerId));
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
