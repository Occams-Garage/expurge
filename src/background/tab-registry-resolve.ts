// Pure per-tab-state resolution — no browser, no side effects (mirrors coordinator.ts).
// tab-registry.ts owns the storage I/O and calls these to DECIDE; the reverse-scan and the
// window-broker scan live here ONCE so the live path can't drift from a testable definition.

import type { RunState } from '../shared/types';
import { isOnHost } from '../shared/url';

// The two atomic session key families the registry owns. Kept separate (not one record) so
// set/remove stay atomic — no read-modify-write TOCTOU on the challenge flag.
export const TAB_PREFIX = 'expurge_tab_';
export const CHALLENGE_PREFIX = 'expurge_challenge_';

export const tabKey = (tabId: number): string => `${TAB_PREFIX}${tabId}`;
export const challengeKey = (tabId: number): string => `${CHALLENGE_PREFIX}${tabId}`;

// Parse the tabId out of an `expurge_tab_<id>` key; null if it isn't one (or is malformed).
export function parseTabKey(key: string): number | null {
  if (!key.startsWith(TAB_PREFIX)) return null;
  const id = parseInt(key.slice(TAB_PREFIX.length), 10);
  return Number.isNaN(id) ? null : id;
}

// Does this session key belong to per-tab state (either family)? The one definition of "which
// keys are ours", so the Stop sweep drops every tab/challenge key without ever touching
// expurge_run / expurge_profile — even if a prefix constant is later changed.
export function isPerTabKey(key: string): boolean {
  return key.startsWith(TAB_PREFIX) || key.startsWith(CHALLENGE_PREFIX);
}

// tabId → itemId, the projection of every `expurge_tab_` key the resolvers reason over.
export type TabSnapshot = Record<number, { itemId: string }>;

// Live browser facts for one tracked tab, materialized by the imperative wrapper so the
// resolver stays pure. `active` = this tab is the active tab of its window.
export interface TabFacts {
  tabId: number;
  windowId: number;
  url: string | null;
  active: boolean;
}

// The tracked tab holding an item, or null (reverse of the snapshot). First match wins —
// an item maps to at most one live tab.
export function tabForItem(snapshot: TabSnapshot, itemId: string): number | null {
  for (const [tabId, entry] of Object.entries(snapshot)) {
    if (entry.itemId === itemId) return Number(tabId);
  }
  return null;
}

// The window's broker tab to reflect. Precedence (matches the old findWindowBrokerTab):
//   1. the active tracked tab, if any — active-preference wins even when off-host
//   2. else the first on-host tracked tab in the window
//   3. else a mid-redirect off-host tracked tab (fallback, so the challenges.cloudflare.com
//      hop doesn't make us open a duplicate)
// Pure: `tabs` are the resolved live facts. Stale-key pruning happens in the wrapper before
// this is called, so a pruned tab simply has no fact here.
export function brokerTabInWindow(
  snapshot: TabSnapshot,
  tabs: TabFacts[],
  run: RunState,
  windowId: number,
): number | null {
  const inWindow = tabs.filter(t => t.windowId === windowId && snapshot[t.tabId]);

  const active = inWindow.find(t => t.active);
  if (active) return active.tabId;

  let fallback: number | null = null;
  for (const t of inWindow) {
    const item = run.items.find(i => i.id === snapshot[t.tabId].itemId);
    if (item && t.url && !isOnHost(t.url, item.renderedUrl)) {
      if (fallback === null) fallback = t.tabId; // mid-redirect off-host — keep as fallback
      continue;
    }
    return t.tabId;
  }
  return fallback;
}
