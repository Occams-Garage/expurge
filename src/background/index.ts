import browser from 'webextension-polyfill';
import type { Profile, RunState, WorkItem, WorkItemStatus, Verdict, SkipReason } from '../shared/types';
import { BROKERS, getBroker } from '../shared/brokers';
import { renderUrl } from '../shared/transforms';
import { evaluateGate } from '../shared/gate';
import { buildDraft } from '../shared/templates';

const BATCH_SIZE = 5;

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

// ── work-item construction ───────────────────────────────────────────────────

function buildItems(profile: Profile): WorkItem[] {
  const items: WorkItem[] = [];

  // Name variants: primary name first, then each AKA split on the first space.
  // This split is the single source of truth for a variant's name — the resolved
  // first/last are stored on each WorkItem so drafts and labels never re-parse the
  // (mutable) profile later.
  const variants: Array<{ nameVariant: string; first: string; last: string }> = [
    { nameVariant: 'primary', first: profile.first.trim(), last: profile.last.trim() },
    ...(profile.also_known_as ?? []).map((aka, i) => {
      const t  = aka.trim();
      const sp = t.indexOf(' ');
      return {
        nameVariant: `aka_${i}`,
        first: sp >= 0 ? t.slice(0, sp) : t,
        last:  sp >= 0 ? t.slice(sp + 1).trim() : '',
      };
    }),
  ];

  for (const broker of BROKERS) {
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
        // Pre-verdicted: count toward progress total but open no tab.
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

// ── batch open ───────────────────────────────────────────────────────────────

async function openNextBatch(run: RunState, focusFirst = false): Promise<void> {
  const openCount = run.items.filter(i => i.status === 'open').length;
  const slots = BATCH_SIZE - openCount;
  if (slots <= 0) return;

  // At most one open tab per broker — prevents hammering the same site with
  // multiple AKA queries in parallel, which triggers bot-detection / CAPTCHAs.
  // The broker set is seeded from already-open tabs and grows as we select, so a
  // second variant of the same broker can't join this batch either.
  const claimedBrokers = new Set(run.items.filter(i => i.status === 'open').map(i => i.brokerId));
  const pending: WorkItem[] = [];
  for (const item of run.items) {
    if (pending.length >= slots) break;
    if (item.status !== 'pending' || claimedBrokers.has(item.brokerId)) continue;
    pending.push(item);
    claimedBrokers.add(item.brokerId);
  }
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
  return serialWrite(async () => {
    const runId = crypto.randomUUID();
    const items = buildItems(profile);
    const run: RunState = { runId, createdAt: new Date().toISOString(), items };
    // Persist before opening tabs so content scripts can find their items on load.
    await saveRun(run);
    await updateBadge(run);
    await openNextBatch(run, true);
  });
}

// Pure: return a run with the given item's verdict applied. Shared by the
// live-tab verdict path and the dashboard re-verdict path so they can't drift.
function withVerdict(run: RunState, itemId: string, verdict: Verdict, listingUrl?: string): RunState {
  return {
    ...run,
    items: run.items.map(i => {
      if (i.id !== itemId) return i;
      // Drop matchedAs first, then re-add only for a hit — so a hit→non-hit
      // re-verdict can't leave a stale match. Keep the existing listingUrl unless
      // a new one is supplied (don't wipe a captured URL with undefined).
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

    const updated: RunState = {
      ...run,
      items: run.items.map(i =>
        i.id === itemId && i.status !== 'verdicted'
          ? { ...i, status: 'verdicted' as WorkItemStatus, verdict: 'skipped', skipReason }
          : i
      ),
    };
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

    const updated: RunState = {
      ...run,
      items: run.items.map(i =>
        i.status === 'pending' || i.status === 'open'
          ? { ...i, status: 'verdicted' as WorkItemStatus, verdict: 'skipped' as Verdict, skipReason: 'run_stopped' as SkipReason }
          : i
      ),
    };
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
        const updated: RunState = {
          ...run,
          items: run.items.map(i =>
            // Don't re-stamp an already-sent item — preserves the original send date.
            i.id === (m.itemId as string) && i.verdict === 'hit' && !i.optedOutAt
              ? { ...i, optedOutAt: new Date().toISOString() }
              : i
          ),
        };
        await saveRun(updated);
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
  const itemId = await itemIdForTab(tabId);
  if (!itemId) return;
  await handleSkip(itemId, 'tab_closed', tabId);
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
  if (!itemId) return;

  // Skip reinject for off-host pages (e.g. challenges.cloudflare.com during redirects).
  // On-host CDN paths (broker.com/cdn-cgi/...) still reach executeScript which ignores them.
  const run = await loadRun();
  const item = run?.items.find(i => i.id === itemId);
  if (item?.renderedUrl) {
    try {
      const tab = await browser.tabs.get(tabId);
      const brokerHost = new URL(item.renderedUrl).hostname;
      const tabHost    = new URL(tab.url ?? '').hostname;
      if (tabHost !== brokerHost && !tabHost.endsWith('.' + brokerHost)) return;
    } catch { /* malformed URL — fall through to reinject */ }
  }

  await reinjectIfMissing(tabId);
});
