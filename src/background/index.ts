import browser from 'webextension-polyfill';
import type { Profile, RunState, WorkItemStatus, Verdict, SkipReason, SidebarView, SidebarUpdateMsg } from '../shared/types';
import { BROKERS, getBroker } from '../shared/brokers';
import { isOnHost, isResultsPage } from '../shared/url';
import { deriveView, type SidebarFocus } from '../sidebar/state';
import { evaluateGate } from '../shared/gate';
import { buildDraft } from '../shared/templates';
import {
  BATCH_SIZE,
  buildItems,
  withVerdict,
  applySkip,
  applyDefer,
  promoteToOpen,
  applyStop,
  applyMarkSent,
  selectBatch,
  nextFocusTarget,
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

async function openNextBatch(run: RunState, focusFirst = false): Promise<RunState> {
  const { toOpen, run: updated } = selectBatch(run, BATCH_SIZE);
  if (toOpen.length === 0) return run;

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
  return updated;
}

// ── handlers ─────────────────────────────────────────────────────────────────

async function handleStartRun(profile: Profile, windowId?: number): Promise<void> {
  await saveProfile(profile);
  return serialWrite(async () => {
    // Pin the run to the Start-click's window. §7 wires popup/options to pass windowId
    // explicitly (captured synchronously alongside the sidebar open); until then, fall back
    // to the sender's window or the last-focused one.
    const resolvedWindowId = windowId ?? (await browser.windows.getLastFocused()).id;
    // Latent (#15): options Start passes an explicit windowId, so this shouldn't fire. But if
    // getLastFocused().id ever came back undefined, run.windowId would be undefined and every
    // sidebar push early-returns — no updates for the whole run. Warn so that's diagnosable
    // rather than a silent dead sidebar.
    if (resolvedWindowId === undefined) {
      console.warn('[expurge] START_RUN resolved no windowId — sidebar pushes will be suppressed for this run');
    }
    const runId = crypto.randomUUID();
    const items = buildItems(profile);
    const run: RunState = { runId, createdAt: new Date().toISOString(), items, windowId: resolvedWindowId };
    // Persist before opening tabs so content scripts can find their items on load.
    await saveRun(run);
    await updateBadge(run);
    const afterBatch = await openNextBatch(run, true);
    // Init-race insurance (Slice-5 review): a sidebar that opened on the Start click may have
    // sent SIDEBAR_GET_STATE before the run was saved (→ got no-run). Push the real view now
    // that the first batch is open so it corrects itself without waiting for a focus change.
    await pushActiveView(afterBatch);
  });
}

// Verdict from the sidebar (no longer from the broker tab): resolve the item's broker tab,
// capture its listingUrl if on a details page, record, drop tracking, advance focus, then
// close the tab. The tab has no UI to linger for; the sidebar's 800 ms `recorded` animation
// is a pure UI transient (Slice 6) and does not gate this close.
async function handleVerdict(itemId: string, verdict: Verdict, explicitListingUrl?: string): Promise<void> {
  return serialWrite(async () => {
    const run = await loadRun();
    if (!run) return;

    // No-wedge: an already-recorded verdict wins over a later duplicate — a retry of a
    // landed-but-ack-lost verdict, or a fast second click (Yes then No) clobbering a recorded
    // hit. The message listener still returns {type:'ACK'}, so the retry is idempotent (it
    // re-ACKs without re-recording, re-advancing, or re-closing the tab). The guard lives here,
    // NOT in withVerdict — handleReverdict deliberately re-verdicts already-verdicted items.
    const target = run.items.find(i => i.id === itemId);
    if (!target || target.status === 'verdicted') return;

    const brokerTabId = await tabIdForItem(itemId);
    const listingUrl = await captureListingUrl(run, itemId, brokerTabId, explicitListingUrl);

    const updated = withVerdict(run, itemId, verdict, listingUrl);
    await saveRun(updated);
    await updateBadge(updated);

    if (brokerTabId !== null) {
      await browser.storage.session.remove(`expurge_tab_${brokerTabId}`);
    }

    await advance(updated);

    // Close AFTER focus moved, so the browser doesn't auto-activate a random tab in the gap.
    // The key is already gone → onRemoved won't re-skip it.
    if (brokerTabId !== null) {
      await browser.tabs.remove(brokerTabId).catch(() => {});
    }
  });
}

// Defer from the sidebar: set the active item aside (its tab stays open, untracked-for-focus
// but still tracked), then fill the freed slot and advance focus.
async function handleDefer(itemId: string): Promise<void> {
  return serialWrite(async () => {
    const run = await loadRun();
    if (!run) return;
    const updated = applyDefer(run, itemId);
    await saveRun(updated);
    await advance(updated);
  });
}

// Jump to an item on request from the sidebar — a checklist row click, or the revisit button
// (which targets the first deferred item). The sidebar names the item; background activates
// its tab. This is the manual-override path (decision 5): focus any item the user clicks.
async function handleFocusItem(itemId: string, windowId: number): Promise<void> {
  return serialWrite(async () => {
    const run = await loadRun();
    if (!run || run.windowId !== windowId) return;
    const target = run.items.find(i => i.id === itemId);
    // Already terminal → nothing to focus (defensive; the sidebar won't make verdicted rows
    // clickable).
    if (!target || target.status === 'verdicted') return;

    // Reopen a lost tab from renderedUrl (resume / finding #3), flipping a tabless item to
    // `open`; then promote a still-alive `deferred` item to `open` so the normal verdict/defer
    // flow applies (without this, a re-defer during revisit would no-op on a deferred item).
    const { run: run2, tabId } = await ensureItemTab(run, itemId);
    if (tabId === null) return;
    const promoted = promoteToOpen(run2, itemId);
    await saveRun(promoted);

    await browser.tabs.update(tabId, { active: true }).catch(() => {});
    await pushView(windowId, deriveView(promoted, await focusForTab(tabId, promoted), BROKERS));
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

    // Editing an already-completed item from the dashboard changes the hit count, so the
    // sidebar's done/stopped summary would go stale. Push the resting view (focus=null →
    // done/stopped/revisit), the same one-liner handleStopRun uses. Tactical §4 fix — the
    // deeper push-after-mutation choke-point is a separate follow-up.
    if (updated.windowId !== undefined) {
      await pushView(updated.windowId, deriveView(updated, null, BROKERS));
    }
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

    await advance(updated);
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

    // Stop can come from the popup/options, not the sidebar — so push the resting view or the
    // sidebar keeps showing live verdict/guidance controls for a run that's over. A stopped run
    // isComplete, so deriveView yields `done` (deriveView, not a hardcoded view — one source).
    if (updated.windowId !== undefined) {
      await pushView(updated.windowId, deriveView(updated, null, BROKERS));
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

// ── focus driving ──────────────────────────────────────────────────────────────
// After any action, move focus to the next actionable item and push the resulting view.

// The live tab tracking an item, or null (reverse of the expurge_tab_<id> → itemId map).
async function tabIdForItem(itemId: string): Promise<number | null> {
  const all = await browser.storage.session.get(null) as Record<string, unknown>;
  for (const key of Object.keys(all)) {
    if (key.startsWith('expurge_tab_') && all[key] === itemId) {
      const tabId = parseInt(key.slice('expurge_tab_'.length), 10);
      if (!isNaN(tabId)) return tabId;
    }
  }
  return null;
}

// Ensure an item has a live tab; open a fresh one from its renderedUrl if not. Covers a
// resumed `deferred`/`open` item whose tab was lost (finding #3) and a pending item being
// promoted. Returns the (possibly updated) run and the tabId.
async function ensureItemTab(run: RunState, itemId: string): Promise<{ run: RunState; tabId: number | null }> {
  const existing = await tabIdForItem(itemId);
  if (existing !== null) return { run, tabId: existing };

  const item = run.items.find(i => i.id === itemId);
  if (!item) return { run, tabId: null };

  const tab = await browser.tabs.create({ url: item.renderedUrl, active: true, windowId: run.windowId });
  if (tab.id === undefined) return { run, tabId: null };
  await browser.storage.session.set({ [`expurge_tab_${tab.id}`]: item.id });
  // It now has a live tab → it's open.
  const updated: RunState = {
    ...run,
    items: run.items.map(i => (i.id === itemId ? { ...i, status: 'open' as WorkItemStatus } : i)),
  };
  await saveRun(updated);
  return { run: updated, tabId: tab.id };
}

// Move focus to the next actionable item (nextFocusTarget) and push its view; if none →
// push the focus=null view (revisit while deferred/blocked-pending remain, else done).
async function driveFocus(run: RunState): Promise<void> {
  const windowId = run.windowId;
  if (windowId === undefined) return;

  const targetId = nextFocusTarget(run);
  if (targetId === null) {
    await pushView(windowId, deriveView(run, null, BROKERS));
    return;
  }

  const { run: run2, tabId } = await ensureItemTab(run, targetId);
  if (tabId !== null) await browser.tabs.update(tabId, { active: true }).catch(() => {});
  const focus = tabId !== null ? await focusForTab(tabId, run2) : null;
  await pushView(windowId, deriveView(run2, focus, BROKERS));
}

// The standard post-action advance: fill the freed batch slot, then drive focus.
async function advance(run: RunState): Promise<void> {
  const afterBatch = await openNextBatch(run);
  await driveFocus(afterBatch);
}

// listingUrl for a verdict: an explicit one from the sidebar (paste-URL fallback) wins; else,
// for a details-page verdict, capture the broker tab's own current URL (the sidebar can't
// self-identify the broker tab). Results-page verdicts (e.g. "not found" → clear) carry none.
async function captureListingUrl(
  run: RunState,
  itemId: string,
  brokerTabId: number | null,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit !== undefined) return explicit;
  if (brokerTabId === null) return undefined;
  const item = run.items.find(i => i.id === itemId);
  const tab = await browser.tabs.get(brokerTabId).catch(() => null);
  if (!item || !tab?.url) return undefined;
  try {
    if (!isResultsPage(new URL(tab.url).pathname, item.renderedUrl)) return tab.url;
  } catch { /* malformed — no listingUrl */ }
  return undefined;
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

    if (m.type === 'VERDICT') {
      // Sent by the sidebar now — sender.tab is the sidebar, so background resolves the broker
      // tab from the item id. listingUrl is set only for the paste-URL fallback.
      await handleVerdict(
        m.itemId as string,
        m.verdict as Verdict,
        m.listingUrl as string | undefined,
      );
      return { type: 'ACK', itemId: m.itemId };
    }

    if (m.type === 'DEFER') {
      await handleDefer(m.itemId as string);
      return { ok: true };
    }

    if (m.type === 'FOCUS_ITEM') {
      await handleFocusItem(m.itemId as string, m.windowId as number);
      return { ok: true };
    }

    if (m.type === 'NAVIGATE_BROKER_TAB') {
      // Paste-URL fallback: point the PASTED ITEM's own broker tab at the listing (via
      // tabIdForItem, not the active-preferred findWindowBrokerTab — the active tab may have
      // changed since the guidance view rendered, so the paste can't land in the wrong tab).
      // The ensuing onUpdated recomputes page-type (results → details) and pushes verdict.
      const windowId = m.windowId as number;
      const run = await loadRun();
      if (run && run.windowId === windowId) {
        const tabId = await tabIdForItem(m.itemId as string);
        if (tabId !== null) await browser.tabs.update(tabId, { url: m.url as string }).catch(() => {});
      }
      return { ok: true };
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
        const updated = applyMarkSent(run, m.itemId as string, new Date().toISOString());
        await saveRun(updated);
        // Push the resting sidebar view for parity with REVERDICT (§4). Mark-sent doesn't move
        // the hit count, so the done/stopped summary is unchanged today — this keeps the sidebar
        // in step with any future field it might surface, at the cost of one no-op push.
        if (updated.windowId !== undefined) {
          await pushView(updated.windowId, deriveView(updated, null, BROKERS));
        }
      });
      return { ok: true };
    }

    if (m.type === 'CLOSE_TAB') {
      // Vestigial: background now closes verdicted tabs itself (handleVerdict). Kept for
      // completeness — if the sidebar ever asks, close the window's current broker tab.
      const windowId = m.windowId as number | undefined;
      const run = await loadRun();
      if (windowId !== undefined && run) {
        const tabId = await findWindowBrokerTab(windowId, run);
        if (tabId !== null) await browser.tabs.remove(tabId).catch(() => {});
      }
      return { ok: true };
    }

    if (m.type === 'DELETE_ALL') {
      // Capture the run's window before wiping session storage so we can send the sidebar back
      // to no-run (delete-all can come from the options page, not the sidebar).
      const wid = (await loadRun())?.windowId;
      await serialWrite(async () => {
        await browser.storage.session.clear();
      });
      await browser.storage.local.clear();
      if (wid !== undefined) await pushView(wid, { view: 'no-run' });
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

  // Broker tab finished navigating (e.g. results → details, or a challenge redirect landing
  // back on the real page) → recompute the active tab's page-type and push. The challenge flag
  // is the content script's job now: it reports RESOLVED on the clean load, so background does
  // NOT guess challenge state from navigation here (that misfired on on-host challenge pages,
  // clearing the flag the content script had just set on the same load).
  await pushActiveView(run);
});
