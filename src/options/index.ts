import browser from 'webextension-polyfill';
import type { AkaName, Profile, RunState, WorkItem } from '../shared/types';
import type { Draft, EmailDraft, FormDraft } from '../shared/templates';
import { mailtoUrl, toEml, toCopyText } from '../shared/templates';
import { normalizeAkas } from '../shared/transforms';
import { BROKERS, getBroker } from '../shared/brokers';

type Section = 'run' | 'results' | 'profile' | 'settings';
type RunDisplayState = 'welcome' | 'ready' | 'active' | 'done';
type SendMethod = 'mailto' | 'eml' | 'copy';

const PREF_KEY = 'expurge_prefs';

let currentRun: RunState | null = null;
let currentProfile: Profile | null = null;
let sendMethod: SendMethod = 'mailto';
let pollHandle: number | null = null;
let lastResultsSig = ''; // results view signature of the last render — gates the 2s poll

// ── section routing ──────────────────────────────────────────────────────────

function showSection(id: Section): void {
  (['run', 'results', 'profile', 'settings'] as Section[]).forEach(s => {
    document.getElementById(`section-${s}`)!.classList.toggle('hidden', s !== id);
  });
  document.querySelectorAll<HTMLElement>('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset['section'] === id);
  });
  // AKA rows are built lazily by init(); if the profile form is shown before that
  // resolves (or after an out-of-band change), guarantee the ≥1-row floor. Additive
  // only, so it never clobbers real rows or in-progress typing.
  if (id === 'profile') ensureOneAkaRow();
}

// ── html escape ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Escape for use inside a double-quoted HTML attribute (esc() alone leaves " intact).
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

// Only allow http(s) URLs to be rendered as links in this privileged page.
// Blocks javascript:/data:/etc. schemes; returns '' for anything unsafe.
function safeHttpUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? url : '';
  } catch {
    return '';
  }
}

// ── run section ──────────────────────────────────────────────────────────────

function runDisplayState(profile: Profile | null, run: RunState | null): RunDisplayState {
  if (!profile) return 'welcome';
  if (!run) return 'ready';
  if (run.items.every(i => i.status === 'verdicted')) return 'done';
  return 'active';
}

function showRunDisplayState(state: RunDisplayState, run?: RunState | null): void {
  (['run-welcome', 'run-ready', 'run-active', 'run-done'] as const).forEach(id => {
    document.getElementById(id)!.classList.add('hidden');
  });

  switch (state) {
    case 'welcome':
      document.getElementById('run-welcome')!.classList.remove('hidden');
      break;

    case 'ready': {
      document.getElementById('run-ready')!.classList.remove('hidden');
      const n = BROKERS.filter(b => b.status === 'active').length;
      document.getElementById('run-ready-desc')!.textContent =
        `Ready to check ${n} people-search site${n !== 1 ? 's' : ''} for your data.`;
      break;
    }

    case 'active':
      if (!run) break;
      document.getElementById('run-active')!.classList.remove('hidden');
      renderRunActive(run);
      if (pollHandle === null) startPolling();
      break;

    case 'done': {
      if (!run) break;
      stopPolling();
      document.getElementById('run-done')!.classList.remove('hidden');
      const checkable = run.items.filter(
        i => !(typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:'))
      );
      const hits  = run.items.filter(i => i.verdict === 'hit').length;
      const sites = new Set(checkable.map(i => i.brokerId)).size;
      const hitSites = new Set(run.items.filter(i => i.verdict === 'hit').map(i => i.brokerId)).size;
      const names = new Set(checkable.map(i => i.nameVariant)).size;
      let desc: string;
      if (hits > 0) {
        desc = `Found ${hits} listing${hits !== 1 ? 's' : ''} across ${hitSites} site${hitSites !== 1 ? 's' : ''}. Check Results for opt-out requests.`;
      } else if (names > 1) {
        desc = `Checked ${names} names across ${sites} site${sites !== 1 ? 's' : ''} — no listings found.`;
      } else {
        desc = `Checked ${sites} site${sites !== 1 ? 's' : ''} — no listings found.`;
      }
      document.getElementById('run-done-desc')!.textContent = desc;
      break;
    }
  }
}

function renderRunActive(run: RunState): void {
  const checkable = run.items.filter(
    i => !(typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:'))
  );
  const done  = checkable.filter(i => i.status === 'verdicted').length;
  const total = checkable.length;
  const hits  = run.items.filter(i => i.verdict === 'hit').length;

  document.getElementById('run-active-desc')!.textContent =
    `${done} / ${total} checked${hits > 0 ? ` · ${hits} found` : ''}`;

  const groups = new Map<string, WorkItem[]>();
  for (const item of run.items) {
    const g = groups.get(item.brokerId) ?? [];
    g.push(item);
    groups.set(item.brokerId, g);
  }

  const rows: string[] = [];
  for (const [brokerId, items] of groups) {
    const name  = getBroker(brokerId)?.name ?? brokerId;
    const badge = brokerBadge(items);
    const akas  = items.filter(i => i.nameVariant !== 'primary').length;
    const akaHtml = akas > 0 ? `<span class="aka-count">+${akas} AKA</span>` : '';
    rows.push(`
      <div class="run-item">
        <span class="broker-name">${esc(name)}${akaHtml}</span>
        <span class="badge badge-${badge.kind}">${badge.label}</span>
      </div>
    `);
  }
  document.getElementById('run-broker-table')!.innerHTML = rows.join('');

  const inRun = new Set(run.items.map(i => i.brokerId));
  const notChecked = BROKERS.filter(b => b.status !== 'active' || !inRun.has(b.id));
  const missingSkips = run.items.filter(
    i => typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:')
  ).length;

  const notes: string[] = [];
  if (notChecked.length > 0) notes.push(`${notChecked.length} broker${notChecked.length !== 1 ? 's' : ''} not in run`);
  if (missingSkips > 0) notes.push(`${missingSkips} variant${missingSkips !== 1 ? 's' : ''} skipped · missing fields`);

  const coverageEl = document.getElementById('run-coverage-note')!;
  if (notes.length > 0) {
    coverageEl.textContent = notes.join(' · ');
    coverageEl.classList.remove('hidden');
  } else {
    coverageEl.classList.add('hidden');
  }
}

function brokerBadge(items: WorkItem[]): { kind: string; label: string } {
  if (items.some(i => i.verdict === 'hit'))     return { kind: 'hit',     label: 'listed' };
  if (items.some(i => i.status === 'open'))     return { kind: 'open',    label: 'open' };
  if (items.some(i => i.status === 'pending'))  return { kind: 'pending', label: 'pending' };
  if (items.some(i => i.verdict === 'unknown')) return { kind: 'unknown', label: 'unknown' };
  if (items.some(i => i.verdict === 'clear'))   return { kind: 'clear',   label: 'not listed' };
  return { kind: 'skipped', label: 'skipped' };
}

// ── polling ───────────────────────────────────────────────────────────────────

function startPolling(): void {
  pollHandle = window.setInterval(() => {
    browser.runtime.sendMessage({ type: 'GET_RUN_STATE' })
      .then(res => {
        currentRun = (res as { run?: RunState }).run ?? null;
        const state = runDisplayState(currentProfile, currentRun);
        showRunDisplayState(state, currentRun);
        if (state === 'done') stopPolling();
        if (!document.getElementById('section-results')!.classList.contains('hidden') && currentRun) {
          renderResults(currentRun);
        }
      })
      .catch(console.error);
  }, 2000);
}

function stopPolling(): void {
  if (pollHandle !== null) {
    window.clearInterval(pollHandle);
    pollHandle = null;
  }
}

// ── results section ───────────────────────────────────────────────────────────

// One item's contribution to its group's rendered output — must include every field
// buildItemRow renders, or a change to it won't refresh the row. status collapses to
// a verdicted-or-not flag (pending and open render identically as "checking…"), and
// optedOutAt to a boolean (only its presence is rendered, and the optimistic client
// timestamp never equals the background's). nameForVariant is included so editing the
// (live) primary profile name re-renders its rows. A row whose signature is unchanged
// is left untouched on re-render.
function itemRowSignature(i: WorkItem): string {
  return [
    nameForVariant(i),
    i.verdict ?? '',
    i.status === 'verdicted' ? 'v' : '_',
    i.skipReason ?? '',
    i.optedOutAt ? '1' : '',
    i.listingUrl ?? '',
  ].join('|');
}

// A broker group's signature is the ordered concatenation of its item row signatures.
function groupSignature(items: WorkItem[]): string {
  return items.map(i => `${i.id}:${itemRowSignature(i)}`).join(';');
}

function brokerSummary(items: WorkItem[]): string {
  const hits     = items.filter(i => i.verdict === 'hit').length;
  const clears   = items.filter(i => i.verdict === 'clear').length;
  const unknowns = items.filter(i => i.verdict === 'unknown').length;
  const skipped  = items.filter(i => i.verdict === 'skipped').length;
  const checking = items.filter(i => i.status !== 'verdicted').length;
  const parts: string[] = [];
  if (hits > 0)     parts.push(`${hits} hit${hits !== 1 ? 's' : ''}`);
  if (clears > 0)   parts.push(`${clears} not found`);
  if (unknowns > 0) parts.push(`${unknowns} couldn't tell`);
  if (checking > 0) parts.push(`${checking} checking`);
  if (skipped > 0)  parts.push(`${skipped} skipped`);
  return parts.join(' · ') || 'no results';
}

// Item display order within a group: hits, then unknowns, clears, everything else.
function sortItems(items: WorkItem[]): WorkItem[] {
  return [
    ...items.filter(i => i.verdict === 'hit'),
    ...items.filter(i => i.verdict === 'unknown'),
    ...items.filter(i => i.verdict === 'clear'),
    ...items.filter(i => i.verdict !== 'hit' && i.verdict !== 'unknown' && i.verdict !== 'clear'),
  ];
}

// Update a group header's summary text and opt-out status pill in place. Single
// source of header rendering, shared by buildBrokerGroup, reconcileBrokerGroup, and
// the optimistic mark-sent refresh.
function updateGroupHeader(groupEl: HTMLElement, items: WorkItem[]): void {
  groupEl.querySelector<HTMLElement>('.broker-group-summary')!.textContent = brokerSummary(items);
  const hits = items.filter(i => i.verdict === 'hit');
  const sentCount = hits.filter(i => i.optedOutAt).length;
  const opt = optStatusFor(hits.length, sentCount);
  let span = groupEl.querySelector<HTMLElement>('.broker-group-optstatus');
  if (!opt) { span?.remove(); return; }
  if (!span) {
    span = document.createElement('span');
    groupEl.querySelector('.broker-group-header')!.appendChild(span);
  }
  span.textContent = opt.text;
  span.className = `broker-group-optstatus ${opt.className}`;
}

function renderResults(run: RunState): void {
  document.getElementById('results-empty')!.classList.add('hidden');
  document.getElementById('results-content')!.classList.remove('hidden');

  const inRun = new Set(run.items.map(i => i.brokerId));
  const notInRun = BROKERS.filter(b => !inRun.has(b.id));
  const ncSig = notInRun.map(b => `${b.id}:${b.status}`).join(';');

  // Top-level early-out: skip the whole reconcile when nothing the results view
  // renders has changed since the last render (the common case on the 2s poll).
  const renderSig = run.items.map(i => `${i.id}:${itemRowSignature(i)}`).join(';') + '#' + ncSig;
  if (renderSig === lastResultsSig) return;
  lastResultsSig = renderSig;

  const groups = new Map<string, WorkItem[]>();
  for (const item of run.items) {
    const g = groups.get(item.brokerId) ?? [];
    g.push(item);
    groups.set(item.brokerId, g);
  }

  const container = document.getElementById('results-groups')!;

  // Reconcile per broker group, keyed on data-broker. An unchanged group is left
  // alone; a changed group is reconciled IN PLACE with rows keyed by item id, so an
  // expanded draft panel on an unrelated row in the same group — plus the group's
  // collapse state and scroll position — survives the 2s poll and re-verdicts,
  // instead of being torn down by a full rebuild.
  const existing = new Map<string, HTMLElement>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('.broker-group[data-broker]'))) {
    existing.set(el.dataset['broker']!, el);
  }
  const notCheckedEl = container.querySelector<HTMLElement>('.broker-group:not([data-broker])');

  for (const [brokerId, items] of groups) {
    const prev = existing.get(brokerId);
    if (prev) {
      if (prev.dataset['sig'] !== groupSignature(items)) reconcileBrokerGroup(prev, items);
    } else {
      const fresh = buildBrokerGroup(brokerId, items);
      if (notCheckedEl) container.insertBefore(fresh, notCheckedEl);
      else container.appendChild(fresh);
    }
  }

  // Drop groups for brokers no longer in this run (e.g. after a new run starts).
  for (const [brokerId, el] of existing) {
    if (!groups.has(brokerId)) el.remove();
  }

  // "Not checked" group: rebuild only when its membership/status set changes
  // (e.g. a new run with a different broker set, or a dataset update).
  if (notInRun.length === 0) {
    notCheckedEl?.remove();
  } else if (!notCheckedEl || notCheckedEl.dataset['sig'] !== ncSig) {
    const nc = buildNotCheckedGroup(notInRun);
    nc.dataset['sig'] = ncSig;
    if (notCheckedEl) notCheckedEl.replaceWith(nc);
    else container.appendChild(nc);
  }
}

function nameForVariant(item: WorkItem): string {
  // Primary tracks the live profile (no drift); AKA variants use the name frozen
  // on the item at run time, so labels stay correct after the AKA list is edited.
  if (item.nameVariant === 'primary') {
    return currentProfile ? `${currentProfile.first} ${currentProfile.last}`.trim() : 'primary';
  }
  return [item.variantFirst, item.variantLast].filter(Boolean).join(' ') || item.nameVariant;
}

// Opt-out send status for a broker's hits — single source of truth for the
// header pill (text + class), shared by initial render and the mark-sent patch.
// Returns null when there are no hits (no pill).
function optStatusFor(hitCount: number, sentCount: number): { text: string; className: string } | null {
  if (hitCount === 0) return null;
  const className = sentCount === hitCount ? 'status-done' : 'status-partial';
  const text = sentCount === hitCount ? 'all sent'
    : sentCount > 0 ? `${sentCount}/${hitCount} sent`
    : 'not started';
  return { text, className };
}

function buildBrokerGroup(brokerId: string, items: WorkItem[]): HTMLElement {
  const brokerName = getBroker(brokerId)?.name ?? brokerId;

  const div = document.createElement('div');
  div.className = 'broker-group';
  div.dataset['broker'] = brokerId;
  div.dataset['sig'] = groupSignature(items);

  const header = document.createElement('button');
  header.className = 'broker-group-header';
  header.innerHTML = `
    <span class="broker-group-chevron">▾</span>
    <span class="broker-group-name">${esc(brokerName)}</span>
    <span class="broker-group-summary"></span>
  `;

  const body = document.createElement('div');
  body.className = 'broker-group-body';

  header.addEventListener('click', () => {
    const collapsed = body.classList.toggle('hidden');
    header.querySelector<HTMLElement>('.broker-group-chevron')!.textContent = collapsed ? '▸' : '▾';
  });

  for (const item of sortItems(items)) body.appendChild(buildItemRow(item));

  div.appendChild(header);
  div.appendChild(body);

  updateGroupHeader(div, items);
  return div;
}

// Update an existing broker group in place: header summary + pill, and body rows
// keyed by item id. A row whose signature is unchanged keeps its DOM node — so an
// open draft panel on it survives a sibling item's change; only changed rows are
// rebuilt, and rows are reordered to match the current sort.
function reconcileBrokerGroup(groupEl: HTMLElement, items: WorkItem[]): void {
  updateGroupHeader(groupEl, items);

  const body = groupEl.querySelector<HTMLElement>('.broker-group-body')!;
  const existingRows = new Map<string, HTMLElement>();
  for (const r of Array.from(body.children) as HTMLElement[]) {
    if (r.dataset['item']) existingRows.set(r.dataset['item'], r);
  }

  let anchor: HTMLElement | null = null;
  for (const item of sortItems(items)) {
    const prev = existingRows.get(item.id);
    const rowEl = (prev && prev.dataset['rowsig'] === itemRowSignature(item))
      ? prev                       // unchanged — keep node (preserves an open draft panel)
      : buildItemRow(item);
    if (anchor) { if (anchor.nextElementSibling !== rowEl) anchor.after(rowEl); }
    else        { if (body.firstElementChild !== rowEl)    body.prepend(rowEl); }
    anchor = rowEl;
  }

  const liveIds = new Set(items.map(i => i.id));
  for (const [id, r] of existingRows) if (!liveIds.has(id)) r.remove();

  groupEl.dataset['sig'] = groupSignature(items);
}

function buildItemRow(item: WorkItem): HTMLElement {
  const name = nameForVariant(item);
  const row = document.createElement('div');
  row.className = 'broker-item-row';
  row.dataset['item'] = item.id;
  row.dataset['rowsig'] = itemRowSignature(item);

  if (item.verdict === 'hit') {
    const sentAt = item.optedOutAt;
    row.innerHTML = `
      <div class="broker-item-header">
        <span class="broker-item-name">${esc(name)}</span>
        <span class="broker-item-verdict verdict-hit">hit</span>
        <button class="btn-draft-toggle${sentAt ? ' sent' : ''}" data-item="${escAttr(item.id)}">
          ${sentAt ? 'Sent ✓' : 'Get opt-out request'}
        </button>
      </div>
      <div class="draft-panel hidden"></div>
    `;
    const btn   = row.querySelector<HTMLButtonElement>('.btn-draft-toggle')!;
    const panel = row.querySelector<HTMLElement>('.draft-panel')!;
    btn.addEventListener('click', () => {
      if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (!panel.dataset['loaded']) {
          panel.dataset['loaded'] = '1'; // set first so a double-click doesn't double-load
          loadDraftPanel(panel, item).catch(err => {
            console.error(err);
            delete panel.dataset['loaded']; // transient failure — allow reopen to retry
          });
        }
      } else {
        panel.classList.add('hidden');
      }
    });

  } else if (item.verdict === 'unknown') {
    const listingHref = safeHttpUrl(item.listingUrl);
    const listingLink = listingHref
      ? `<a class="review-listing-link" href="${escAttr(listingHref)}" target="_blank" rel="noopener noreferrer">Open listing →</a>` : '';
    row.innerHTML = `
      <div class="broker-item-header">
        <span class="broker-item-name">${esc(name)}</span>
        <span class="broker-item-verdict verdict-unknown">couldn't tell</span>
      </div>
      <div class="review-verdict-row">
        ${listingLink}
        <button class="btn-review-hit">Yes, this is me</button>
        <button class="btn-review-clear">No, not me</button>
      </div>
      <div class="review-status"></div>
    `;
    const statusEl = row.querySelector<HTMLElement>('.review-status')!;
    const hitBtn   = row.querySelector<HTMLButtonElement>('.btn-review-hit')!;
    const clearBtn = row.querySelector<HTMLButtonElement>('.btn-review-clear')!;
    const reverdictFrom = async (verdict: 'hit' | 'clear'): Promise<void> => {
      hitBtn.disabled = clearBtn.disabled = true;
      statusEl.textContent = 'Saving…';
      try {
        await browser.runtime.sendMessage({
          type: 'REVERDICT', itemId: item.id, verdict, listingUrl: item.listingUrl,
        });
        if (currentRun) {
          currentRun = {
            ...currentRun,
            items: currentRun.items.map(i =>
              i.id === item.id
                ? { ...i, verdict, ...(verdict === 'hit' ? { matchedAs: i.nameVariant } : {}) }
                : i
            ),
          };
          renderResults(currentRun);
        }
      } catch {
        statusEl.textContent = 'Save failed — try again.';
        hitBtn.disabled = clearBtn.disabled = false;
      }
    };
    hitBtn.addEventListener('click',   () => { reverdictFrom('hit').catch(console.error); });
    clearBtn.addEventListener('click', () => { reverdictFrom('clear').catch(console.error); });

  } else if (item.verdict === 'clear') {
    row.innerHTML = `
      <div class="broker-item-header">
        <span class="broker-item-name">${esc(name)}</span>
        <span class="broker-item-verdict verdict-clear">not listed</span>
      </div>
    `;

  } else {
    // No verdict yet → still in the run; a verdicted item here is a real skip.
    const label = item.status !== 'verdicted'
      ? 'checking…'
      : (item.skipReason?.replace('missing:', 'missing ') ?? 'skipped');
    const cls = item.status !== 'verdicted' ? 'verdict-unknown' : 'verdict-skipped';
    row.innerHTML = `
      <div class="broker-item-header">
        <span class="broker-item-name">${esc(name)}</span>
        <span class="broker-item-verdict ${cls}">${esc(label)}</span>
      </div>
    `;
  }

  return row;
}

function buildNotCheckedGroup(brokers: readonly (typeof BROKERS)[number][]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'broker-group';

  const header = document.createElement('button');
  header.className = 'broker-group-header';
  header.innerHTML = `
    <span class="broker-group-chevron">▸</span>
    <span class="broker-group-name">Not checked</span>
    <span class="broker-group-summary">${brokers.length} broker${brokers.length !== 1 ? 's' : ''} not in this run</span>
  `;

  const body = document.createElement('div');
  body.className = 'broker-group-body hidden';

  header.addEventListener('click', () => {
    const collapsed = body.classList.toggle('hidden');
    header.querySelector<HTMLElement>('.broker-group-chevron')!.textContent = collapsed ? '▸' : '▾';
  });

  for (const broker of brokers) {
    const row = document.createElement('div');
    row.className = 'broker-item-row';
    row.innerHTML = `
      <div class="broker-item-header">
        <span class="broker-item-name">${esc(broker.name)}</span>
        <span class="broker-item-verdict verdict-skipped">${broker.status}</span>
      </div>
    `;
    body.appendChild(row);
  }

  div.appendChild(header);
  div.appendChild(body);
  return div;
}

// ── broker group header refresh ───────────────────────────────────────────────

function refreshBrokerGroupHeader(brokerId: string): void {
  if (!currentRun) return;
  const groupEl = document.querySelector<HTMLElement>(`.broker-group[data-broker="${CSS.escape(brokerId)}"]`);
  if (!groupEl) return;
  const items = currentRun.items.filter(i => i.brokerId === brokerId);
  updateGroupHeader(groupEl, items);

  // Keep the stored group + row signatures current so the next poll-driven
  // renderResults sees this group as unchanged and leaves the (now open) draft
  // panel in place, rather than reconciling the row and tearing it down.
  for (const item of items) {
    const rowEl = groupEl.querySelector<HTMLElement>(`.broker-item-row[data-item="${CSS.escape(item.id)}"]`);
    if (rowEl) rowEl.dataset['rowsig'] = itemRowSignature(item);
  }
  groupEl.dataset['sig'] = groupSignature(items);
}

// ── draft loading + rendering ─────────────────────────────────────────────────

// Drafts are built from the live profile, so a profile edit makes every cached
// panel stale. Drop the load cache; reload any panel that's currently open.
function invalidateDraftPanels(): void {
  for (const panel of Array.from(document.querySelectorAll<HTMLElement>('.draft-panel'))) {
    delete panel.dataset['loaded'];
    if (panel.classList.contains('hidden')) continue;
    const itemId = (panel.closest('.broker-item-row') as HTMLElement | null)?.dataset['item'];
    const item = itemId ? currentRun?.items.find(i => i.id === itemId) : undefined;
    if (!item) continue;
    panel.dataset['loaded'] = '1';
    loadDraftPanel(panel, item).catch(err => { console.error(err); delete panel.dataset['loaded']; });
  }
}

async function loadDraftPanel(panel: HTMLElement, item: WorkItem): Promise<void> {
  panel.textContent = 'Loading…';
  const res = await browser.runtime.sendMessage({ type: 'GET_DRAFT', itemId: item.id }) as { draft?: Draft; reason?: string };
  if (!res.draft) {
    panel.innerHTML = `<p class="note">No opt-out request available. ${esc(res.reason ?? '')}</p>`;
    return;
  }
  renderDraftInPanel(panel, res.draft, item);
}

function renderDraftInPanel(panel: HTMLElement, draft: Draft, item: WorkItem): void {
  if (draft.kind === 'form') renderFormDraftInPanel(panel, draft as FormDraft, item);
  else                       renderEmailDraftInPanel(panel, draft as EmailDraft, item);
}

function renderEmailDraftInPanel(panel: HTMLElement, draft: EmailDraft, item: WorkItem): void {
  const copyText = toCopyText(draft);
  panel.innerHTML = `
    <div class="draft-meta">
      <div class="draft-meta-row"><strong>To:</strong> ${esc(draft.to)}</div>
      <div class="draft-meta-row"><strong>Subject:</strong> ${esc(draft.subject)}</div>
    </div>
    ${draft.isGeneralContact ? `
      <div class="callout-amber">
        This is a general contact address, not a dedicated opt-out address. Your request will still be sent — expect a manual response.
      </div>` : ''}
    <div class="draft-send-btns">
      <button class="btn-send ${sendMethod === 'mailto' ? 'btn-send-primary' : 'btn-send-secondary'}" data-action="mailto">Open in mail app</button>
      <button class="btn-send ${sendMethod === 'eml'    ? 'btn-send-primary' : 'btn-send-secondary'}" data-action="eml">Download .eml file</button>
      <button class="btn-send ${sendMethod === 'copy'   ? 'btn-send-primary' : 'btn-send-secondary'}" data-action="copy">Copy to clipboard</button>
    </div>
    <div class="copy-area hidden"><textarea readonly>${esc(copyText)}</textarea></div>
    <div class="draft-mark-sent">
      ${item.optedOutAt
        ? '<span class="sent-badge">Sent ✓</span>'
        : '<button class="btn-quiet" data-action="mark-sent">Mark as sent</button>'}
    </div>
  `;

  panel.querySelector<HTMLButtonElement>('[data-action="mailto"]')!.onclick = () => {
    browser.tabs.create({ url: mailtoUrl(draft) }).catch(console.error);
  };

  panel.querySelector<HTMLButtonElement>('[data-action="eml"]')!.onclick = async () => {
    const url = URL.createObjectURL(new Blob([toEml(draft)], { type: 'message/rfc822' }));
    try {
      await browser.downloads.download({ url, filename: `expurge-optout-${item.brokerId}-${item.nameVariant}.eml`, saveAs: false });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const copyBtn  = panel.querySelector<HTMLButtonElement>('[data-action="copy"]')!;
  const copyArea = panel.querySelector<HTMLElement>('.copy-area')!;
  copyBtn.onclick = async () => {
    copyArea.classList.remove('hidden');
    try {
      await navigator.clipboard.writeText(copyText);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy to clipboard'; }, 2000);
    } catch {
      (copyArea.querySelector('textarea') as HTMLTextAreaElement).select();
    }
  };

  const markSentBtn = panel.querySelector<HTMLButtonElement>('[data-action="mark-sent"]');
  if (markSentBtn) markSentBtn.onclick = async () => {
    try {
      await browser.runtime.sendMessage({ type: 'MARK_SENT', itemId: item.id });
    } catch {
      return; // leave the button actionable so the user can retry
    }
    panel.querySelector('.draft-mark-sent')!.innerHTML = '<span class="sent-badge">Sent ✓</span>';
    const toggleBtn = document.querySelector<HTMLButtonElement>(`.btn-draft-toggle[data-item="${CSS.escape(item.id)}"]`);
    if (toggleBtn) { toggleBtn.textContent = 'Sent ✓'; toggleBtn.classList.add('sent'); }
    if (currentRun) {
      currentRun = {
        ...currentRun,
        items: currentRun.items.map(i =>
          i.id === item.id && !i.optedOutAt ? { ...i, optedOutAt: new Date().toISOString() } : i
        ),
      };
      refreshBrokerGroupHeader(item.brokerId);
    }
  };
}

function renderFormDraftInPanel(panel: HTMLElement, draft: FormDraft, item: WorkItem): void {
  const fieldsHtml = draft.fields.map(f => `
    <tr>
      <td class="form-field-label">${esc(f.label)}</td>
      <td class="form-field-value">
        ${f.value
          ? `<span class="form-value-text">${esc(f.value)}</span>`
          : `<em class="form-value-empty">you fill in</em>`}
        ${f.note ? `<div class="form-field-note">${esc(f.note)}</div>` : ''}
      </td>
    </tr>`).join('');

  const stepsHtml = draft.steps.map(s => `<li>${esc(s)}</li>`).join('');

  panel.innerHTML = `
    <div class="form-card-section">
      <p class="form-card-label">Fill in these fields</p>
      <table class="form-fields-table">${fieldsHtml}</table>
    </div>
    <div class="form-card-section">
      <p class="form-card-label">Steps</p>
      <ol class="form-steps-list">${stepsHtml}</ol>
    </div>
    <button class="btn-send btn-send-primary" data-action="open-form">Open opt-out form →</button>
    <div class="draft-mark-sent">
      ${item.optedOutAt
        ? '<span class="sent-badge">Submitted ✓</span>'
        : '<button class="btn-quiet" data-action="mark-submitted">Mark as submitted</button>'}
    </div>
  `;

  panel.querySelector<HTMLButtonElement>('[data-action="open-form"]')!.onclick = () => {
    browser.tabs.create({ url: draft.formUrl }).catch(console.error);
  };

  const markSubmittedBtn = panel.querySelector<HTMLButtonElement>('[data-action="mark-submitted"]');
  if (markSubmittedBtn) markSubmittedBtn.onclick = async () => {
    try {
      await browser.runtime.sendMessage({ type: 'MARK_SENT', itemId: item.id });
    } catch {
      return; // leave the button actionable so the user can retry
    }
    panel.querySelector('.draft-mark-sent')!.innerHTML = '<span class="sent-badge">Submitted ✓</span>';
    const toggleBtn = document.querySelector<HTMLButtonElement>(`.btn-draft-toggle[data-item="${CSS.escape(item.id)}"]`);
    if (toggleBtn) { toggleBtn.textContent = 'Submitted ✓'; toggleBtn.classList.add('sent'); }
    if (currentRun) {
      currentRun = {
        ...currentRun,
        items: currentRun.items.map(i =>
          i.id === item.id && !i.optedOutAt ? { ...i, optedOutAt: new Date().toISOString() } : i
        ),
      };
      refreshBrokerGroupHeader(item.brokerId);
    }
  };
}

// ── profile section ───────────────────────────────────────────────────────────

function populateProfileForm(profile: Profile): void {
  (document.getElementById('p-first')  as HTMLInputElement).value = profile.first;
  (document.getElementById('p-last')   as HTMLInputElement).value = profile.last;
  (document.getElementById('p-city')   as HTMLInputElement).value = profile.city;
  (document.getElementById('p-state')  as HTMLInputElement).value = profile.state;
  (document.getElementById('p-middle') as HTMLInputElement).value = profile.middle ?? '';
  (document.getElementById('p-zip')    as HTMLInputElement).value = profile.zip ?? '';
  (document.getElementById('p-age')    as HTMLInputElement).value = profile.age ?? '';
  resetAkaRows(normalizeAkas(profile.also_known_as));
  (document.getElementById('p-relatives')     as HTMLTextAreaElement).value = (profile.relatives ?? []).join('\n');
  (document.getElementById('p-emails')        as HTMLTextAreaElement).value = (profile.emails ?? []).join('\n');
  (document.getElementById('p-phones')        as HTMLTextAreaElement).value = (profile.phones ?? []).join('\n');
}

function readProfileFromForm(): Profile | null {
  const first = (document.getElementById('p-first') as HTMLInputElement).value.trim();
  const last  = (document.getElementById('p-last')  as HTMLInputElement).value.trim();
  const city  = (document.getElementById('p-city')  as HTMLInputElement).value.trim();
  const state = (document.getElementById('p-state') as HTMLInputElement).value.trim().toUpperCase();
  if (!first || !last || !city || !state) return null;

  const middle = (document.getElementById('p-middle') as HTMLInputElement).value.trim() || undefined;
  const zip    = (document.getElementById('p-zip')    as HTMLInputElement).value.trim() || undefined;
  const age    = (document.getElementById('p-age')    as HTMLInputElement).value.trim() || undefined;

  const parseLines = (id: string): string[] | undefined => {
    const raw = (document.getElementById(id) as HTMLTextAreaElement).value.trim();
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    return lines.length > 0 ? lines : undefined;
  };

  const akas = readAkaRows();

  return {
    first, last, city, state, middle, zip, age,
    also_known_as: akas.length > 0 ? akas : undefined,
    relatives:     parseLines('p-relatives'),
    emails:        parseLines('p-emails'),
    phones:        parseLines('p-phones'),
  };
}

// ── "Other names" (also_known_as) dynamic rows ────────────────────────────────
// Each name is captured as separate First/Middle/Last inputs, mirroring the
// primary name. The container always holds at least one row.

function buildAkaRow(aka?: AkaName): HTMLElement {
  const row = document.createElement('div');
  row.className = 'aka-row';

  const mkInput = (key: keyof AkaName, label: string): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    input.dataset['aka'] = key;
    input.value = aka?.[key] ?? '';
    return input;
  };

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-quiet aka-remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove this name');
  remove.addEventListener('click', () => {
    const focusAfter = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null;
    row.remove();
    ensureOneAkaRow(); // never leave the list empty
    const target = focusAfter ?? document.querySelector<HTMLElement>('#aka-rows .aka-row');
    target?.querySelector<HTMLInputElement>('input[data-aka="first"]')?.focus();
  });

  row.append(mkInput('first', 'First'), mkInput('middle', 'Middle'), mkInput('last', 'Last'), remove);
  return row;
}

function addAkaRow(aka?: AkaName): void {
  const row = buildAkaRow(aka);
  document.getElementById('aka-rows')!.appendChild(row);
  row.querySelector<HTMLInputElement>('input[data-aka="first"]')?.focus();
}

// The "Other names" list always keeps at least one row. Querying `.aka-row` (not the
// raw child count) keeps the invariant robust if a non-row node is ever added here.
function ensureOneAkaRow(): void {
  const container = document.getElementById('aka-rows')!;
  if (!container.querySelector('.aka-row')) container.appendChild(buildAkaRow());
}

// Clear and repopulate the rows; always leave at least one (empty) row.
function resetAkaRows(akas: AkaName[]): void {
  document.getElementById('aka-rows')!.replaceChildren(...akas.map(aka => buildAkaRow(aka)));
  ensureOneAkaRow();
}

// Read one row's trimmed First/Middle/Last values.
function readAkaRow(row: HTMLElement): { first: string; middle: string; last: string } {
  const val = (key: keyof AkaName) =>
    (row.querySelector<HTMLInputElement>(`input[data-aka="${key}"]`)?.value ?? '').trim();
  return { first: val('first'), middle: val('middle'), last: val('last') };
}

// First row that has data but is missing a first or last name (an unsearchable,
// incomplete name), else null. A searchable name needs both, mirroring the primary
// name. handleProfileSave blocks the save on such a row, so readAkaRows never drops one.
function firstIncompleteAkaRow(): HTMLElement | null {
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('#aka-rows .aka-row'))) {
    const { first, middle, last } = readAkaRow(row);
    const hasData = first || middle || last;
    if (hasData && (!first || !last)) return row;
  }
  return null;
}

// Read rows into AkaName[] via the single canonicalizer — normalizeAkas applies the
// same trim + drop-if-missing-first/last rules (incomplete rows are blocked at save).
function readAkaRows(): AkaName[] {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('#aka-rows .aka-row')).map(readAkaRow);
  return normalizeAkas(rows);
}

async function handleProfileSave(e: Event): Promise<void> {
  e.preventDefault();
  const errEl   = document.getElementById('profile-error')!;
  const savedEl = document.getElementById('profile-saved-msg')!;
  errEl.classList.add('hidden');
  savedEl.classList.add('hidden');

  const profile = readProfileFromForm();
  if (!profile) {
    errEl.textContent = 'First name, last name, city, and state are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const badRow = firstIncompleteAkaRow();
  if (badRow) {
    errEl.textContent = 'Each additional name needs a first and last name (or clear the row).';
    errEl.classList.remove('hidden');
    const missing = readAkaRow(badRow).first ? 'last' : 'first';
    badRow.querySelector<HTMLInputElement>(`input[data-aka="${missing}"]`)?.focus();
    return;
  }

  const btn = document.getElementById('btn-save-profile') as HTMLButtonElement;
  btn.disabled = true;
  await browser.runtime.sendMessage({ type: 'SAVE_PROFILE', profile });
  currentProfile = profile;
  invalidateDraftPanels(); // drafts are built from the profile — drop stale cached panels
  btn.disabled = false;
  savedEl.classList.remove('hidden');
  setTimeout(() => savedEl.classList.add('hidden'), 3000);

  if (!document.getElementById('section-run')!.classList.contains('hidden')
      && runDisplayState(currentProfile, currentRun) === 'ready') {
    showRunDisplayState('ready');
  }
}

// ── settings section ──────────────────────────────────────────────────────────

async function loadPrefs(): Promise<void> {
  const r = await browser.storage.local.get(PREF_KEY);
  const prefs = r[PREF_KEY] as { sendMethod?: string } | undefined;
  sendMethod = (prefs?.sendMethod ?? 'mailto') as SendMethod;
  const radio = document.querySelector<HTMLInputElement>(`input[name="send-method"][value="${sendMethod}"]`);
  if (radio) radio.checked = true;
}

async function saveSendMethod(method: SendMethod): Promise<void> {
  sendMethod = method;
  await browser.storage.local.set({ [PREF_KEY]: { sendMethod: method } });
}

function renderBrokerCoverage(): void {
  const rows = BROKERS.map(b => `
    <div class="broker-coverage-row">
      <span>${esc(b.name)}</span>
      <span class="broker-status-tag broker-status-${b.status}">${b.status}</span>
    </div>`).join('');
  document.getElementById('broker-list')!.innerHTML = rows;
}

async function handleExport(): Promise<void> {
  const [profileRes, runRes] = await Promise.all([
    browser.runtime.sendMessage({ type: 'GET_PROFILE' }),
    browser.runtime.sendMessage({ type: 'GET_RUN_STATE' }),
  ]) as [{ profile?: Profile }, { run?: RunState }];

  // Export the canonical profile shape (normalize legacy/raw also_known_as) and stamp a
  // schema version so a future importer can tell payload shapes apart.
  let profile: Profile | null = null;
  if (profileRes.profile) {
    const akas = normalizeAkas(profileRes.profile.also_known_as);
    profile = { ...profileRes.profile, also_known_as: akas.length ? akas : undefined };
  }

  const json = JSON.stringify({ expurge_export: true, version: 1, profile, run: runRes.run ?? null }, null, 2);
  const url  = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    await browser.downloads.download({ url, filename: 'expurge-session.json', saveAs: true });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleDeleteAll(): Promise<void> {
  await browser.runtime.sendMessage({ type: 'DELETE_ALL' });
  currentProfile = null;
  currentRun = null;
  lastResultsSig = ''; // run cleared — drop the early-out cache so the next render rebuilds
  stopPolling();
  (document.getElementById('profile-form') as HTMLFormElement).reset();
  resetAkaRows([]); // form.reset() can't clear JS-built rows — restore one empty row
  document.getElementById('delete-confirm-panel')!.classList.add('hidden');
  showSection('run');
  showRunDisplayState('welcome');
}

// ── start run ─────────────────────────────────────────────────────────────────

async function handleStartRun(): Promise<void> {
  const errEl = document.getElementById('start-error')!;
  errEl.classList.add('hidden');
  const btn = document.getElementById('btn-start') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Requesting access…';

  try {
    const origins = BROKERS
      .filter(b => b.status === 'active')
      .map(b => {
        try {
          const host = new URL(b.search.url.replace(/{[^}]+}/g, 'x')).hostname.replace(/^www\./, '');
          return `*://*.${host}/*`;
        } catch { return null; }
      })
      .filter((o): o is string => o !== null)
      .filter((v, i, a) => a.indexOf(v) === i) as browser.Manifest.MatchPattern[];

    const granted = await browser.permissions.request({ origins });
    if (!granted) {
      errEl.textContent = 'Permission not granted — allow access when prompted to continue.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Start scan';
      return;
    }

    if (!currentProfile) {
      errEl.textContent = 'Profile required — fill in your profile before starting a scan.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Start scan';
      return;
    }

    btn.textContent = 'Starting…';
    await browser.runtime.sendMessage({ type: 'START_RUN', profile: currentProfile });
    const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' }) as { run?: RunState };
    currentRun = res.run ?? null;
    showRunDisplayState(runDisplayState(currentProfile, currentRun), currentRun);
  } catch {
    errEl.textContent = 'Something went wrong. Is the extension active?';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start scan';
  }
}

// ── init ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const [profileRes, runRes] = await Promise.all([
    browser.runtime.sendMessage({ type: 'GET_PROFILE' }),
    browser.runtime.sendMessage({ type: 'GET_RUN_STATE' }),
  ]) as [{ profile?: Profile }, { run?: RunState }];

  currentProfile = profileRes.profile ?? null;
  currentRun     = runRes.run ?? null;

  await loadPrefs();
  renderBrokerCoverage();

  if (currentProfile) populateProfileForm(currentProfile);
  else resetAkaRows([]); // first-time user: show one empty "Other names" row

  // First-time users: land on Profile so they can fill it in immediately
  if (!currentProfile) {
    showSection('profile');
  } else {
    showSection('run');
  }

  showRunDisplayState(runDisplayState(currentProfile, currentRun), currentRun);
}

// ── event wiring ──────────────────────────────────────────────────────────────

document.querySelectorAll<HTMLElement>('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = btn.dataset['section'] as Section;
    showSection(section);
    if (section === 'run') showRunDisplayState(runDisplayState(currentProfile, currentRun), currentRun);
    if (section === 'results' && currentRun) renderResults(currentRun);
  });
});

document.querySelectorAll<HTMLElement>('[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset['nav'] as Section));
});

document.getElementById('btn-start')!.addEventListener('click', () => { handleStartRun().catch(console.error); });

document.getElementById('btn-restore-overlay')!.addEventListener('click', async () => {
  const btn = document.getElementById('btn-restore-overlay') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const res = await browser.runtime.sendMessage({ type: 'REINJECT_OVERLAY' }) as { ok?: boolean };
    if (!res?.ok) {
      btn.textContent = 'Nothing left to check';
      setTimeout(() => { btn.textContent = 'Restore overlay'; btn.disabled = false; }, 2000);
    } else {
      btn.disabled = false;
    }
  } catch {
    btn.disabled = false;
  }
});

document.getElementById('btn-stop')!.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'STOP_RUN' });
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' }) as { run?: RunState };
  currentRun = res.run ?? null;
  stopPolling();
  showRunDisplayState(runDisplayState(currentProfile, currentRun), currentRun);
});

document.getElementById('btn-view-results')!.addEventListener('click', () => {
  showSection('results');
  if (currentRun) renderResults(currentRun);
});

document.getElementById('btn-run-again')!.addEventListener('click', () => { handleStartRun().catch(console.error); });

document.getElementById('profile-form')!.addEventListener('submit', e => { handleProfileSave(e).catch(console.error); });
document.getElementById('btn-add-aka')!.addEventListener('click', () => addAkaRow());

// Enter inside an AKA input must not submit the whole profile form (these are
// single-line inputs in a form with a submit button). Treat it like the old
// "one name per line" textarea: insert a fresh row after the current one.
document.getElementById('aka-rows')!.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const target = e.target as HTMLElement;
  if (!target.matches('input[data-aka]')) return;
  e.preventDefault();
  const newRow = buildAkaRow();
  target.closest('.aka-row')!.after(newRow);
  newRow.querySelector<HTMLInputElement>('input[data-aka="first"]')?.focus();
});

document.getElementById('send-method-group')!.addEventListener('change', e => {
  const radio = e.target as HTMLInputElement;
  if (radio.type === 'radio') saveSendMethod(radio.value as SendMethod).catch(console.error);
});

document.getElementById('btn-export')!.addEventListener('click', () => { handleExport().catch(console.error); });

document.getElementById('btn-delete-all')!.addEventListener('click', () => {
  document.getElementById('delete-confirm-panel')!.classList.remove('hidden');
});
document.getElementById('btn-delete-cancel')!.addEventListener('click', () => {
  document.getElementById('delete-confirm-panel')!.classList.add('hidden');
});
document.getElementById('btn-delete-confirm')!.addEventListener('click', () => { handleDeleteAll().catch(console.error); });

init().catch(console.error);
