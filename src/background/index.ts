import browser from 'webextension-polyfill';
import type { Profile, RunState, WorkItemStatus, Verdict, SkipReason, SidebarView, SidebarUpdateMsg } from '../shared/types';
import { BROKERS, getBroker } from '../shared/brokers';
import { isOnHost } from '../shared/url';
import { deriveView, type SidebarFocus } from '../sidebar/state';
import { evaluateGate } from '../shared/gate';
import { buildDraft } from '../shared/templates';
import {
  BATCH_SIZE,
  buildItems,
  withVerdict,
  applySkip,
  applyStop,
  applyMarkSent,
  selectBatch,
} from './coordinator';

// ── serial write queue ────────────────────────────────────────────────────────
// Prevents TOCTOU: loadRun → mutate → saveRun is not atomic; concurrent verdicts
// from two open tabs can each read the same snapshot and one will overwrite the other.
// The queue serializes all state-mutating handlers so each waits for the previous to finish.

let writeQueue: Promise<void> = Promise.resolve();

function serialWrite(fn: () => Promise<void>): Promise<void> {
  const p = writeQueue.then(
    () => fn(),
    () => fn(),
  );
  writeQueue = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

// ── session storage keys ─────────────────────────────────────────────────────
// browser.storage.session: survives event-page spindown, cleared on browser close.
// tab_id is NEVER written to durable storage — only held live in session.

const KEY_RUN     = 'expurge_run';
const KEY_PROFILE = 'expurge_profile';

async function loadRun(): Promise<RunState | null> {
  const r = await browser.storage.session.get(KEY_RUN);
  return (r[KEY_RUN] as RunState) ?? null;
}

async function saveRun(run: RunState): Promise<void> {
  // Strip live-session tabIds before persisting — structural impossibility of recycled-id hazards.
  const safe: RunState = {
    ...run,
    items: run.items.map(item => {
      const { tabId: _tabId, ...rest } = item;
      return rest;
    }),
  };
  await browser.storage.session.set({ [KEY_RUN]: safe });
}

async function loadProfile(): Promise<Profile | null> {
  const r = await browser.storage.session.get(KEY_PROFILE);
  return (r[KEY_PROFILE] as Profile) ?? null;
}

async function saveProfile(profile: Profile): Promise<void> {
  await browser.storage.session.set({ [KEY_PROFILE]: profile });
}

// ── badge ─────────────────────────────────────────────────────────────────────

async function updateBadge(run: RunState): Promise<void> {
  const hits = run.items.filter(i => i.verdict === 'hit').length;
  await browser.action.setBadgeText({ text: hits > 0 ? String(hits) : '' });
  if (hits > 0) {
    await browser.action.setBadgeBackgroundColor({ color: '#B25C3C' }); // accent
  }
}

// ── batch open ───────────────────────────────────────────────────────────────
// Selection is pure (coordinator.selectBatch); this owns only the tab I/O.

async function openNextBatch(run: RunState, focusFirst = false): Promise<void> {
  const { toOpen, run: updated } = selectBatch(run, BATCH_SIZE);
  if (toOpen.length === 0) return;

  await saveRun(updated);

  let first = true;
  for (const item of toOpen) {
    const active = focusFirst && first;
    first = false;
    // Pin new broker tabs to the run's window so they share its sidebar (window-level surface).
    const tab = await browser.tabs.create({ url: item.renderedUrl, active, windowId: run.windowId });
    if (tab.id !== undefined) {
      await browser.storage.session.set({ [`expurge_tab_${tab.id}`]: item.id });
    }
  }
}

// ── handlers ─────────────────────────────────────────────────────────────────

async function handleStartRun(profile: Profile, windowId?: number): Promise<void> {
  await saveProfile(profile);
  return serialWrite(async () => {
    // Pin the run to the Start-click's window. §7 wires popup/options to pass windowId
    // explicitly (captured synchronously alongside the sidebar open); until then, fall back
    // to the sender's window or the last-focused one.
    const resolvedWindowId = windowId ?? (await browser.windows.getLastFocused()).id;
    const runId = crypto.randomUUID();
    const items = buildItems(profile);
    const run: RunState = { runId, createdAt: new Date().toISOString(), items, windowId: resolvedWindowId };
    // Persist before opening tabs so content scripts can find their items on load.
    await saveRun(run);
    await updateBadge(run);
    await openNextBatch(run, true);
  });
}

// Verdict from a live broker tab: record it, drop the tab's tracking key, and
// advance the run.
async function handleVerdict(itemId: string, verdict: Verdict, listingUrl?: string, tabId?: number): Promise<void> {
  return serialWrite(async () => {
    const run = await loadRun();
    if (!run) return;

    const updated = withVerdict(run, itemId, verdict, listingUrl);
    await saveRun(updated);

    if (tabId !== undefined) {
      await browser.storage.session.remove(`expurge_tab_${tabId}`);
    }

    await updateBadge(updated);
    await openNextBatch(updated);
  });
}

// Re-verdict from the results dashboard: a pure state edit of an already-recorded
// item. Never touches tab tracking or opens tabs.
async function handleReverdict(itemId: string, verdict: Verdict, listingUrl?: string): Promise<void> {
  return serialWrite(async () => {
    const run = await loadRun();
    if (!run) return;

    // Only edit an already-verdicted item. Item ids are deterministic and reused
    // across runs, so a stale dashboard re-verdict (button from a prior run) must
    // not clobber a pending/open item in a freshly-started run.
    const target = run.items.find(i => i.id === itemId);
    if (!target || target.status !== 'verdicted') return;

    const updated = withVerdict(run, itemId, verdict, listingUrl);
    await saveRun(updated);
    await updateBadge(updated);
  });
}

async function handleSkip(itemId: string, skipReason: SkipReason, tabId?: number): Promise<void> {
  return serialWrite(async () => {
    const run = await loadRun();
    if (!run) return;

    const updated = applySkip(run, itemId, skipReason);
    await saveRun(updated);

    if (tabId !== undefined) {
      await browser.storage.session.remove(`expurge_tab_${tabId}`);
    }

    await openNextBatch(updated);
  });
}

async function handleStopRun(): Promise<void> {
  return serialWrite(async () => {
    const run = await loadRun();
    if (!run) return;

    const updated = applyStop(run);
    await saveRun(updated);

    // Remove all tab session keys so tabs.onRemoved can't fire after stop and overwrite
    // run_stopped → tab_closed for each still-open broker tab.
    const all = await browser.storage.session.get(null) as Record<string, unknown>;
    const tabKeys = Object.keys(all).filter(k => k.startsWith('expurge_tab_'));
    if (tabKeys.length > 0) {
      await browser.storage.session.remove(tabKeys);
    }
  });
}

async function itemIdForTab(tabId: number): Promise<string | null> {
  const key = `expurge_tab_${tabId}`;
  const r = await browser.storage.session.get(key);
  return (r[key] as string) ?? null;
}

// ── per-tab challenge flag ─────────────────────────────────────────────────────
// Set by CHALLENGE_DETECTED, cleared by CHALLENGE_RESOLVED / tab close / on-host nav.
// Stored in session storage (keyed by tabId) so it survives event-page spindown mid-
// challenge — an in-memory Map would lose it. Feeds SidebarFocus.challenge → deriveView.

const challengeKey = (tabId: number) => `expurge_challenge_${tabId}`;

async function setChallengeFlag(tabId: number, on: boolean): Promise<void> {
  if (on) await browser.storage.session.set({ [challengeKey(tabId)]: true });
  else    await browser.storage.session.remove(challengeKey(tabId));
}

async function isChallenged(tabId: number): Promise<boolean> {
  const key = challengeKey(tabId);
  const r = await browser.storage.session.get(key);
  return r[key] === true;
}

// ── focus resolution (SidebarFocus builders) ───────────────────────────────────
// deriveView (sidebar/state.ts) is the single source of view truth; the background only
// BUILDS its inputs. A SidebarFocus pairs the focused broker tab's work item with its URL
// (results-vs-details) and challenge flag; null focus → deriveView yields revisit/done/no-run.

async function focusForTab(tabId: number, run: RunState): Promise<SidebarFocus | null> {
  const itemId = await itemIdForTab(tabId);
  if (!itemId) return null;   // not a tracked broker tab
  const item = run.items.find(i => i.id === itemId) ?? null;
  if (!item) return null;
  const tab = await browser.tabs.get(tabId).catch(() => null);
  return { item, tabUrl: tab?.url ?? null, challenge: await isChallenged(tabId) };
}

// The window's broker tab to reflect: prefer the active tab if it's tracked, else any tracked
// broker tab in the window (prefer on-host; keep a mid-redirect off-host tab as a fallback so
// the challenges.cloudflare.com hop doesn't make us open a duplicate). Prunes stale tab keys.
// Retains the old findActiveBrokerTab scan, scoped to one window and active-preferring.
async function findWindowBrokerTab(windowId: number, run: RunState): Promise<number | null> {
  const [active] = await browser.tabs.query({ windowId, active: true });
  if (active?.id !== undefined && await itemIdForTab(active.id)) return active.id;

  const all = await browser.storage.session.get(null) as Record<string, unknown>;
  let fallbackTabId: number | null = null;
  for (const key of Object.keys(all)) {
    if (!key.startsWith('expurge_tab_')) continue;
    const tabId = parseInt(key.slice('expurge_tab_'.length), 10);
    if (isNaN(tabId)) continue;
    let tab: browser.Tabs.Tab;
    try { tab = await browser.tabs.get(tabId); }
    catch { await browser.storage.session.remove(key); continue; } // stale — tab closed
    if (tab.windowId !== windowId) continue;
    const item = run.items.find(i => i.id === (all[key] as string));
    if (item && tab.url && !isOnHost(tab.url, item.renderedUrl)) {
      if (fallbackTabId === null) fallbackTabId = tabId; // mid-redirect, don't prune
      continue;
    }
    return tabId;
  }
  return fallbackTabId;
}

// PULL focus (SIDEBAR_GET_STATE): the window's broker tab, active-preferred with fallback.
async function buildFocus(windowId: number, run: RunState): Promise<SidebarFocus | null> {
  const tabId = await findWindowBrokerTab(windowId, run);
  return tabId === null ? null : focusForTab(tabId, run);
}

// PUSH focus: the window's ACTIVE tab only. Returns null when the active tab isn't a broker
// tab — the sticky-view contract: a glance at another tab must not flip the sidebar.
async function activeBrokerFocus(windowId: number, run: RunState): Promise<SidebarFocus | null> {
  const [active] = await browser.tabs.query({ windowId, active: true });
  if (active?.id === undefined) return null;
  return focusForTab(active.id, run);
}

// ── sidebar push ───────────────────────────────────────────────────────────────

async function pushView(windowId: number, view: SidebarView): Promise<void> {
  const msg: SidebarUpdateMsg = { type: 'SIDEBAR_UPDATE', windowId, view };
  // No sidebar listening (not yet built, or window has none) is fine — swallow the reject.
  await browser.runtime.sendMessage(msg).catch(() => {});
}

// Push the view for the run window's ACTIVE broker tab. Honors the sticky-view contract:
// if the active tab isn't a broker tab, leave the sidebar showing its last broker item.
async function pushActiveView(run: RunState): Promise<void> {
  if (run.windowId === undefined) return;
  const focus = await activeBrokerFocus(run.windowId, run);
  if (!focus) return;
  await pushView(run.windowId, deriveView(run, focus, BROKERS));
}

// ── message listener ─────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener(
  async (msg: unknown, sender: browser.Runtime.MessageSender) => {
    const m = msg as Record<string, unknown>;

    if (m.type === 'START_RUN') {
      // Prefer the window the sidebar was opened in (passed explicitly by popup/options in §7),
      // else the message sender's window.
      const windowId = (m.windowId as number | undefined) ?? sender.tab?.windowId;
      await handleStartRun(m.profile as Profile, windowId);
      return { ok: true };
    }

    if (m.type === 'GET_RUN_STATE') {
      const run = await loadRun();
      return { run };
    }

    // PULL: the sidebar asks for its window's current view on load.
    if (m.type === 'SIDEBAR_GET_STATE') {
      const windowId = m.windowId as number;
      const run = await loadRun();
      // A sidebar in a window without the run (idle window, or run pinned elsewhere) → no-run.
      if (!run || run.windowId !== windowId) {
        return { type: 'SIDEBAR_UPDATE', windowId, view: { view: 'no-run' } } satisfies SidebarUpdateMsg;
      }
      const focus = await buildFocus(windowId, run);
      return { type: 'SIDEBAR_UPDATE', windowId, view: deriveView(run, focus, BROKERS) } satisfies SidebarUpdateMsg;
    }

    // A broker tab's content script reports a bot-challenge appearing / clearing (in-page).
    // Set/clear the per-tab flag and refresh the sidebar if that tab is the active one.
    if (m.type === 'CHALLENGE_DETECTED' || m.type === 'CHALLENGE_RESOLVED') {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        await setChallengeFlag(tabId, m.type === 'CHALLENGE_DETECTED');
        const run = await loadRun();
        if (run) await pushActiveView(run);
      }
      return { ok: true };
    }

    if (m.type === 'GET_ITEM') {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return null;
      const itemId = await itemIdForTab(tabId);
      if (!itemId) return null;
      const run = await loadRun();
      if (!run) return null;
      const item = run.items.find(i => i.id === itemId);
      if (!item) return null;
      const broker = getBroker(item.brokerId);
      const done = run.items.filter(i => i.status === 'verdicted').length;
      const hits = run.items.filter(i => i.verdict === 'hit').length;
      return {
        type: 'ITEM_INFO',
        itemId: item.id,
        brokerId: item.brokerId,
        exposes: broker?.search.exposes ?? [],
        renderedUrl: item.renderedUrl,
        progress: { done, total: run.items.length, hits },
      };
    }

    if (m.type === 'VERDICT') {
      const tabId = sender.tab?.id;
      await handleVerdict(
        m.itemId as string,
        m.verdict as Verdict,
        m.listingUrl as string | undefined,
        tabId,
      );
      return { type: 'ACK', itemId: m.itemId };
    }

    if (m.type === 'REVERDICT') {
      await handleReverdict(
        m.itemId as string,
        m.verdict as Verdict,
        m.listingUrl as string | undefined,
      );
      return { type: 'ACK', itemId: m.itemId };
    }

    if (m.type === 'STOP_RUN') {
      await handleStopRun();
      return { ok: true };
    }

    if (m.type === 'PING') {
      return { type: 'PONG', hasOverlay: false };
    }

    if (m.type === 'REINJECT_OVERLAY') {
      const existingTabId = await findActiveBrokerTab();
      if (existingTabId !== null) {
        try {
          await browser.tabs.update(existingTabId, { active: true });
          await reinjectIfMissing(existingTabId);
          return { ok: true };
        } catch {
          await browser.storage.session.remove(`expurge_tab_${existingTabId}`);
          // Fall through to open-next-item logic.
        }
      }

      // No live broker tab (or tab closed between find and update) — open the next item.
      const run = await loadRun();
      if (!run) return { ok: false };
      const item =
        run.items.find(i => i.status === 'pending') ??
        run.items.find(i => i.status === 'open');
      if (!item) return { ok: false };

      const tab = await browser.tabs.create({ url: item.renderedUrl, active: true });
      if (tab.id !== undefined) {
        await browser.storage.session.set({ [`expurge_tab_${tab.id}`]: item.id });
        if (item.status === 'pending') {
          const updated: RunState = {
            ...run,
            items: run.items.map(i =>
              i.id === item.id ? { ...i, status: 'open' as WorkItemStatus } : i
            ),
          };
          await saveRun(updated);
        }
      }
      return { ok: true };
    }

    if (m.type === 'GET_DRAFT') {
      const run     = await loadRun();
      const profile = await loadProfile();
      if (!run || !profile) return { draft: null, reason: 'no_state' };

      const hitItem = run.items.find(
        i => i.id === (m.itemId as string) && i.verdict === 'hit'
      );
      if (!hitItem) return { draft: null, reason: 'no_hit' };

      const broker = getBroker(hitItem.brokerId);
      if (!broker) return { draft: null, reason: 'unknown_broker' };

      const gate = evaluateGate(broker, 'hit');
      if (!gate.pass) return { draft: null, reason: gate.reason };

      // AKA hits use the name resolved at run time (frozen on the item) — re-parsing
      // the mutable also_known_as list would drift. The primary variant has no such
      // drift (it's the raw profile name), so it tracks the live profile.
      const draftProfile: Profile = hitItem.nameVariant === 'primary'
        ? profile
        : { ...profile, first: hitItem.variantFirst, last: hitItem.variantLast };
      const draft = buildDraft(draftProfile, broker, gate.channel, hitItem.listingUrl);
      return { draft };
    }

    if (m.type === 'SAVE_PROFILE') {
      await saveProfile(m.profile as Profile);
      return { ok: true };
    }

    if (m.type === 'GET_PROFILE') {
      const profile = await loadProfile();
      return { profile };
    }

    if (m.type === 'MARK_SENT') {
      await serialWrite(async () => {
        const run = await loadRun();
        if (!run) return;
        await saveRun(applyMarkSent(run, m.itemId as string, new Date().toISOString()));
      });
      return { ok: true };
    }

    if (m.type === 'CLOSE_TAB') {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        await browser.tabs.remove(tabId).catch(() => {});
      }
      return { ok: true };
    }

    if (m.type === 'DELETE_ALL') {
      await serialWrite(async () => {
        await browser.storage.session.clear();
      });
      await browser.storage.local.clear();
      return { ok: true };
    }

    return undefined;
  }
);

// ── tab closed → skipped/tab_closed ─────────────────────────────────────────

browser.tabs.onRemoved.addListener(async (tabId: number) => {
  await setChallengeFlag(tabId, false); // drop any challenge flag for the now-gone tab
  const itemId = await itemIdForTab(tabId);
  if (!itemId) return;
  await handleSkip(itemId, 'tab_closed', tabId);
});

// Focus moved within the run's window → refresh the sidebar for the newly-active tab.
// Sticky-view contract: pushActiveView is a no-op when that tab isn't a broker tab, so a
// glance at another tab leaves the sidebar on its last broker item.
browser.tabs.onActivated.addListener(async ({ windowId }) => {
  const run = await loadRun();
  if (!run || run.windowId !== windowId) return;
  await pushActiveView(run);
});


// ── overlay re-injection ─────────────────────────────────────────────────────

async function findActiveBrokerTab(): Promise<number | null> {
  const [all, run] = await Promise.all([
    browser.storage.session.get(null) as Promise<Record<string, unknown>>,
    loadRun(),
  ]);
  // A tab temporarily at a Cloudflare (or other challenge-provider) redirect URL will have a
  // hostname that doesn't match the broker. We don't prune it — it may redirect back shortly.
  // Keep it as a fallback so "Restore Overlay" focuses the existing tab rather than opening a
  // fresh one that would trigger a new Cloudflare session.
  let fallbackTabId: number | null = null;
  for (const key of Object.keys(all)) {
    if (!key.startsWith('expurge_tab_')) continue;
    const tabId = parseInt(key.slice('expurge_tab_'.length), 10);
    if (isNaN(tabId)) continue;
    try {
      const tab = await browser.tabs.get(tabId);
      if (run && tab.url) {
        const itemId = all[key] as string;
        const item = run.items.find(i => i.id === itemId);
        if (item) {
          try {
            const brokerHost = new URL(item.renderedUrl).hostname;
            const tabHost    = new URL(tab.url).hostname;
            if (tabHost !== brokerHost && !tabHost.endsWith('.' + brokerHost)) {
              if (fallbackTabId === null) fallbackTabId = tabId; // mid-redirect, don't prune
              continue;
            }
          } catch {
            await browser.storage.session.remove(key); // URL parse failed
            continue;
          }
        }
      }
      return tabId;
    } catch {
      await browser.storage.session.remove(key); // stale — tab was closed
    }
  }
  return fallbackTabId;
}

async function reinjectIfMissing(tabId: number): Promise<void> {
  const TIMEOUT_MS = 2_000;
  try {
    const pong = await Promise.race([
      browser.tabs.sendMessage(tabId, { type: 'PING' }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]) as { type?: string; hasOverlay?: boolean } | null;

    if (pong?.hasOverlay) return; // overlay present — nothing to do
    // Content script alive but overlay missing — fall through to inject
  } catch {
    // PING timed out or content script not running — inject
  }

  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['dist/content.js'] });
  } catch {
    // Tab may be on a restricted URL or closed — ignore
  }
}

// ── first install → open options page ────────────────────────────────────────

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') browser.runtime.openOptionsPage().catch(console.error);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const itemId = await itemIdForTab(tabId);
  if (!itemId) return; // not a tracked broker tab

  const run = await loadRun();
  if (!run) return;
  const item = run.items.find(i => i.id === itemId);
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const onHost = !!(item?.renderedUrl && tab?.url && isOnHost(tab.url, item.renderedUrl));

  // Clear the challenge flag once the tab lands back on-host: Cloudflare interstitials resolve
  // by REDIRECT (a navigation, not a DOM mutation), so the content script's CHALLENGE_RESOLVED
  // never fires for them (Slice-4 review). The off-host guard keeps the flag during the
  // challenges.cloudflare.com hop itself.
  if (onHost) await setChallengeFlag(tabId, false);

  // Broker tab finished navigating (e.g. results → details) → recompute the active tab's
  // page-type and push.
  await pushActiveView(run);

  // (removed in Slice 5d) legacy overlay reinject, on-host only.
  if (onHost) await reinjectIfMissing(tabId);
});
