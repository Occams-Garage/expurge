// Pure sidebar view-derivation — no DOM, no browser, no side effects (mirrors
// coordinator.ts / classify.ts). Maps a run snapshot + the focused tab's context to a
// resting SidebarView, so the sidebar's display logic is unit-testable in isolation.
// The UI layer (index.ts, Slice 6) owns rendering and the transient saving/recorded states.

import type { RunState, WorkItem, SidebarView, ActiveItemInfo, PageType, RunProgress } from '../shared/types';
import { BROKERS, type Broker } from '../shared/brokers';
import { isResultsPage } from '../shared/url';
import { progressOf, isComplete } from '../background/coordinator';

// The focused tab's contribution to the view: the work item it maps to (null if the active
// tab isn't a tracked broker tab), its current URL (parsed for results-vs-details), and
// whether it's showing a bot-challenge. Background builds this from the active tab.
export interface SidebarFocus {
  item: WorkItem | null;
  tabUrl: string | null;
  challenge: boolean;
}

// Derive the resting sidebar view. Precedence (highest first):
//   1. no run                         → no-run
//   2. run complete                   → done
//   3. focused item + challenge       → challenge
//   4. focused item + results page    → guidance
//   5. focused item + details page    → verdict
//   6. nothing actionable focused     → revisit  (work still waiting)
// `brokers` is injectable for tests (mirrors buildItems); the active-item views pull the
// broker's exposes/guidance from it.
export function deriveView(
  run: RunState | null,
  focus: SidebarFocus | null,
  brokers: readonly Broker[] = BROKERS,
): SidebarView {
  if (!run) return { view: 'no-run' };

  const progress = progressOf(run);
  if (isComplete(run)) {
    // A stopped run is "complete" (nothing pending/open/deferred), but its run_stopped items
    // were abandoned by the Stop, not checked. Show an honest `stopped` summary whose `checked`
    // count excludes them (they're all verdicted, so they sit inside progress.total).
    const stoppedCount = run.items.filter(i => i.skipReason === 'run_stopped').length;
    if (stoppedCount > 0) {
      return { view: 'stopped', checked: progress.total - stoppedCount, total: progress.total, hits: progress.hits };
    }
    return { view: 'done', progress };
  }

  // A focused broker tab → show its active-item detail. Challenge outranks page-type: a
  // CAPTCHA hides the listing, so there's nothing to judge until it clears.
  if (focus?.item) {
    const item = activeItemInfo(focus.item, focus.tabUrl, progress, brokers);
    if (focus.challenge) return { view: 'challenge', item };
    return item.pageType === 'results'
      ? { view: 'guidance', item }
      : { view: 'verdict', item };
  }

  // Nothing actionable is focused, but the run isn't done — work is waiting. Covers the
  // deferred pile and (Slice-1 review finding #2) pending items stranded behind a deferred
  // sibling broker: no open tab exists to act on, yet the run isn't complete. `waiting` is the
  // count of non-terminal items (== total − done, since missing: skips are already excluded
  // from both). `focusId` is the item the revisit button jumps to — first deferred, else first
  // pending (the blocked-behind-deferred case; FOCUS_ITEM's ensureItemTab opens a pending one).
  // Carried in the view so the sidebar needn't re-fetch run state to find it.
  const focusId =
    run.items.find(i => i.status === 'deferred')?.id ??
    run.items.find(i => i.status === 'pending')?.id ??
    null;
  return { view: 'revisit', waiting: progress.total - progress.done, focusId, progress };
}

// Assemble the render payload for a focused broker item: identity + rendered URL from the
// item, exposes/guidance from the broker record, page-type derived from the tab URL.
function activeItemInfo(
  item: WorkItem,
  tabUrl: string | null,
  progress: RunProgress,
  brokers: readonly Broker[],
): ActiveItemInfo {
  const broker = brokers.find(b => b.id === item.brokerId);
  const pageType: PageType =
    isResultsPage(pathnameOf(tabUrl), item.renderedUrl) ? 'results' : 'details';
  return {
    itemId: item.id,
    brokerId: item.brokerId,
    exposes: broker?.search.exposes ?? [],
    ...(broker?.search.guidance ? { guidance: broker.search.guidance } : {}),
    renderedUrl: item.renderedUrl,
    pageType,
    progress,
  };
}

// The pathname of a full URL, or '' if it's null/unparseable. '' never matches a rendered
// search URL's pathname, so a missing tab URL falls through to the details/verdict view.
function pathnameOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}
