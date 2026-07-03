// The one owned home for per-tab run state. Every access to the `expurge_tab_<id>` and
// `expurge_challenge_<id>` session keys routes through here — index.ts never touches the raw
// keys or scans session storage itself. This is the imperative I/O half (imports the polyfill,
// so it's not node-testable); the pure decision logic lives in tab-registry-resolve.ts, which
// IS unit-tested (mirrors the coordinator.ts ↔ index.ts split).
//
// browser.storage.session: survives event-page spindown, cleared on browser close. tab ids are
// never written to durable (local) storage.

import browser from 'webextension-polyfill';
import type { RunState } from '../shared/types';
import {
  TAB_PREFIX,
  CHALLENGE_PREFIX,
  tabKey,
  challengeKey,
  parseTabKey,
  tabForItem,
  brokerTabInWindow,
  type TabSnapshot,
  type TabFacts,
} from './tab-registry-resolve';

async function readSnapshot(): Promise<TabSnapshot> {
  const all = (await browser.storage.session.get(null)) as Record<string, unknown>;
  const snap: TabSnapshot = {};
  for (const [key, val] of Object.entries(all)) {
    const id = parseTabKey(key);
    if (id !== null) snap[id] = { itemId: val as string };
  }
  return snap;
}

// Track a freshly-opened broker tab → its work item. Also drop any challenge key a recycled
// tab id might still carry (an orphan from a prior tab with the same id), so a clean new tab can
// never inherit challenge=true before its content script reports — a defensive backstop that
// keeps removeTab's "drop both keys" invariant true from the open side too.
export async function putTab(tabId: number, itemId: string): Promise<void> {
  await browser.storage.session.set({ [tabKey(tabId)]: itemId });
  await browser.storage.session.remove(challengeKey(tabId));
}

// Retire one tab: drop BOTH keys atomically → the challenge key can never orphan.
export async function removeTab(tabId: number): Promise<void> {
  await browser.storage.session.remove([tabKey(tabId), challengeKey(tabId)]);
}

// Bulk retire on Stop: every tab key AND every challenge key (including any orphan whose tab
// key was already removed — the orphan-challenge-key bug the old sweep left behind).
export async function removeAllTabs(): Promise<void> {
  const all = (await browser.storage.session.get(null)) as Record<string, unknown>;
  const keys = Object.keys(all).filter(
    k => k.startsWith(TAB_PREFIX) || k.startsWith(CHALLENGE_PREFIX),
  );
  if (keys.length > 0) await browser.storage.session.remove(keys);
}

// tabId → itemId (keyed read), or null if the tab isn't a tracked broker tab.
export async function itemForTab(tabId: number): Promise<string | null> {
  const r = await browser.storage.session.get(tabKey(tabId));
  return (r[tabKey(tabId)] as string) ?? null;
}

// itemId → its live tab, or null (the reverse scan, in one place).
export async function findTabForItem(itemId: string): Promise<number | null> {
  return tabForItem(await readSnapshot(), itemId);
}

// The window's broker tab to reflect (active-preferred, on-host, off-host fallback). Resolves
// every tracked tab against live browser state, PRUNING any whose tab is gone (drops both
// keys), then lets the pure resolver decide.
export async function findBrokerTab(windowId: number, run: RunState): Promise<number | null> {
  const snapshot = await readSnapshot();
  const facts: TabFacts[] = [];
  for (const idStr of Object.keys(snapshot)) {
    const tabId = Number(idStr);
    let tab: browser.Tabs.Tab;
    try {
      tab = await browser.tabs.get(tabId);
    } catch {
      await removeTab(tabId); // stale — tab closed; prune BOTH keys
      continue;
    }
    facts.push({
      tabId,
      windowId: tab.windowId ?? -1,
      url: tab.url ?? null,
      active: tab.active,
    });
  }
  return brokerTabInWindow(snapshot, facts, run, windowId);
}

// Per-tab challenge flag: set on CHALLENGE_DETECTED, cleared on CHALLENGE_RESOLVED and dropped
// with the tab via removeTab. Feeds SidebarFocus.challenge → deriveView.
export async function setChallenge(tabId: number, on: boolean): Promise<void> {
  if (on) await browser.storage.session.set({ [challengeKey(tabId)]: true });
  else await browser.storage.session.remove(challengeKey(tabId));
}

export async function isChallenged(tabId: number): Promise<boolean> {
  const key = challengeKey(tabId);
  const r = await browser.storage.session.get(key);
  return r[key] === true;
}
