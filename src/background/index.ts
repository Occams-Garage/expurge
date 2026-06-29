import browser from 'webextension-polyfill';
import type { Profile, RunState, WorkItem, WorkItemStatus, Verdict, SkipReason } from '../shared/types';
import { BROKERS, getBroker } from '../shared/brokers';
import { renderUrl } from '../shared/transforms';
import { evaluateGate } from '../shared/gate';
import { buildDraft } from '../shared/templates';

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

// ── handlers ─────────────────────────────────────────────────────────────────

async function handleStartRun(profile: Profile): Promise<void> {
  await saveProfile(profile);

  const runId = crypto.randomUUID();
  const items = buildItems(profile);
  const run: RunState = { runId, createdAt: new Date().toISOString(), items };

  // Persist before opening the tab so content script can find the item on load.
  await saveRun(run);

  const pending = items.find(i => i.status === 'pending');
  if (!pending) return;

  const tab = await browser.tabs.create({ url: pending.renderedUrl, active: true });
  // Hold tabId in memory for this session — saved to session storage separately,
  // but we update the in-memory run and re-save with the tabId for the ack lookup.
  const updated: RunState = {
    ...run,
    items: run.items.map(i =>
      i.id === pending.id
        ? { ...i, status: 'open' as WorkItemStatus, tabId: tab.id }
        : i
    ),
  };
  // saveRun strips tabId, so we keep a live reference in session for tab-id lookups below.
  // We save the status update (pending → open) but not the tabId.
  await saveRun(updated);
  // Store tabId→itemId mapping separately for quick lookup.
  if (tab.id !== undefined) {
    await browser.storage.session.set({ [`expurge_tab_${tab.id}`]: pending.id });
  }
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
      return {
        type: 'ITEM_INFO',
        itemId: item.id,
        brokerId: item.brokerId,
        exposes: broker?.search.exposes ?? [],
        renderedUrl: item.renderedUrl,
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
