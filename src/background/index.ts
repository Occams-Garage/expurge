import browser from 'webextension-polyfill';
import type { Profile, RunState, WorkItem, WorkItemStatus, Verdict, SkipReason } from '../shared/types';
import { BROKERS, getBroker } from '../shared/brokers';
import { renderUrl } from '../shared/transforms';
import { evaluateGate } from '../shared/gate';
import { buildDraft } from '../shared/templates';

const BATCH_SIZE = 5;

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

// ── work-item construction ───────────────────────────────────────────────────

function buildItems(profile: Profile): WorkItem[] {
  const items: WorkItem[] = [];
  for (const broker of BROKERS) {
    if (broker.status !== 'active') continue;
    const profileMap = profile as unknown as Record<string, string>;
    const hasAll = broker.search.requires.every(
      f => Boolean(profileMap[f]?.trim())
    );
    if (!hasAll) continue;
    items.push({
      id: `${broker.id}:primary`,
      brokerId: broker.id,
      nameVariant: 'primary',
      renderedUrl: renderUrl(broker.search.url, profile),
      status: 'pending',
    });
  }
  return items;
}

// ── batch open ───────────────────────────────────────────────────────────────

async function openNextBatch(run: RunState, focusFirst = false): Promise<void> {
  const openCount = run.items.filter(i => i.status === 'open').length;
  const slots = BATCH_SIZE - openCount;
  if (slots <= 0) return;

  const pending = run.items.filter(i => i.status === 'pending').slice(0, slots);
  if (pending.length === 0) return;

  const pendingIds = new Set(pending.map(p => p.id));
  const updated: RunState = {
    ...run,
    items: run.items.map(i =>
      pendingIds.has(i.id) ? { ...i, status: 'open' as WorkItemStatus } : i
    ),
  };
  await saveRun(updated);

  let first = true;
  for (const item of pending) {
    const active = focusFirst && first;
    first = false;
    const tab = await browser.tabs.create({ url: item.renderedUrl, active });
    if (tab.id !== undefined) {
      await browser.storage.session.set({ [`expurge_tab_${tab.id}`]: item.id });
    }
  }
}

// ── handlers ─────────────────────────────────────────────────────────────────

async function handleStartRun(profile: Profile): Promise<void> {
  await saveProfile(profile);

  const runId = crypto.randomUUID();
  const items = buildItems(profile);
  const run: RunState = { runId, createdAt: new Date().toISOString(), items };

  // Persist before opening tabs so content scripts can find their items on load.
  await saveRun(run);
  await openNextBatch(run, true);
}

async function handleVerdict(itemId: string, verdict: Verdict, listingUrl?: string, tabId?: number): Promise<void> {
  const run = await loadRun();
  if (!run) return;

  const updated: RunState = {
    ...run,
    items: run.items.map(i =>
      i.id === itemId ? { ...i, status: 'verdicted' as WorkItemStatus, verdict, listingUrl } : i
    ),
  };
  await saveRun(updated);

  // Clean up tab mapping.
  if (tabId !== undefined) {
    await browser.storage.session.remove(`expurge_tab_${tabId}`);
  }

  // Auto-advance: fill available batch slots.
  await openNextBatch(updated);
}

async function handleSkip(itemId: string, skipReason: SkipReason, tabId?: number): Promise<void> {
  const run = await loadRun();
  if (!run) return;

  const updated: RunState = {
    ...run,
    items: run.items.map(i =>
      i.id === itemId
        ? { ...i, status: 'verdicted' as WorkItemStatus, verdict: 'skipped', skipReason }
        : i
    ),
  };
  await saveRun(updated);

  if (tabId !== undefined) {
    await browser.storage.session.remove(`expurge_tab_${tabId}`);
  }

  // Auto-advance: same as handleVerdict — skips count as cleared slots.
  await openNextBatch(updated);
}

async function handleStopRun(): Promise<void> {
  const run = await loadRun();
  if (!run) return;

  const updated: RunState = {
    ...run,
    items: run.items.map(i =>
      i.status === 'pending' || i.status === 'open'
        ? { ...i, status: 'verdicted' as WorkItemStatus, verdict: 'skipped' as Verdict, skipReason: 'run_stopped' as SkipReason }
        : i
    ),
  };
  await saveRun(updated);
}

async function itemIdForTab(tabId: number): Promise<string | null> {
  const key = `expurge_tab_${tabId}`;
  const r = await browser.storage.session.get(key);
  return (r[key] as string) ?? null;
}

// ── message listener ─────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener(
  async (msg: unknown, sender: browser.Runtime.MessageSender) => {
    const m = msg as Record<string, unknown>;

    if (m.type === 'START_RUN') {
      await handleStartRun(m.profile as Profile);
      return { ok: true };
    }

    if (m.type === 'GET_RUN_STATE') {
      const run = await loadRun();
      return { run };
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

    if (m.type === 'STOP_RUN') {
      await handleStopRun();
      return { ok: true };
    }

    if (m.type === 'PING') {
      return { type: 'PONG', hasOverlay: false };
    }

    if (m.type === 'REINJECT_OVERLAY') {
      await reinjectIfMissing(m.tabId as number);
      return { ok: true };
    }

    if (m.type === 'GET_DRAFT') {
      const run     = await loadRun();
      const profile = await loadProfile();
      if (!run || !profile) return { draft: null, reason: 'no_state' };

      const broker = getBroker(m.brokerId as string);
      if (!broker) return { draft: null, reason: 'unknown_broker' };

      const hitItem = run.items.find(
        i => i.brokerId === broker.id && i.verdict === 'hit'
      );
      if (!hitItem) return { draft: null, reason: 'no_hit' };

      const gate = evaluateGate(broker, 'hit');
      if (!gate.pass) return { draft: null, reason: gate.reason };

      const draft = buildDraft(profile, broker, gate.channel, hitItem.listingUrl);
      return { draft };
    }

    return undefined;
  }
);

// ── tab closed → skipped/tab_closed ─────────────────────────────────────────

browser.tabs.onRemoved.addListener(async (tabId: number) => {
  const itemId = await itemIdForTab(tabId);
  if (!itemId) return;
  await handleSkip(itemId, 'tab_closed', tabId);
});

// ── load error → skipped/load_error ─────────────────────────────────────────

browser.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0) return;  // main frame only
  const itemId = await itemIdForTab(details.tabId);
  if (!itemId) return;
  await handleSkip(itemId, 'load_error', details.tabId);
});

// ── overlay re-injection ─────────────────────────────────────────────────────

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
    await browser.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // Tab may be on a restricted URL or closed — ignore
  }
}

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const itemId = await itemIdForTab(tabId);
  if (!itemId) return;
  await reinjectIfMissing(tabId);
});
