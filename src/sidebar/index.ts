import browser from 'webextension-polyfill';
import type { RunState, WorkItem, Verdict, SidebarView, SidebarUpdateMsg, ActiveItemInfo } from '../shared/types';
import { getBroker } from '../shared/brokers';
import { progressOf } from '../background/coordinator';

// The sidebar is a thin render layer over the view the background derives (deriveView) — it
// never re-derives. Init order matters (Slice-5 review): attach the push listener FIRST, then
// resolve our windowId, then PULL the current view — so a push landing between them isn't missed.
//
// DATA-INJECTION INVARIANT (STYLEGUIDE §0): the sidebar shows ONLY generic broker data —
// broker names/slugs, generic `exposes` chips, and the broker's `guidance` note. It NEVER
// renders the user's real profile data: `variantFirst`/`variantLast` (the searched name),
// `renderedUrl`/`listingUrl` (carry the name in the query) are deliberately never displayed.
// All dataset-sourced text goes through textContent, never innerHTML.

let windowId: number | undefined;
// While a verdict is mid-flight we own the detail panel (saving → recorded) and suppress
// incoming pushes, so the background's next-item push doesn't yank the animation away.
let transient = false;
let lastVerdict: Verdict | null = null;

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const send = (msg: unknown): void => { browser.runtime.sendMessage(msg).catch(() => {}); };

// ── init ─────────────────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as Partial<SidebarUpdateMsg>;
  if (m?.type !== 'SIDEBAR_UPDATE') return;
  // Ignore other windows (runtime.sendMessage broadcasts to every sidebar) and don't clobber
  // an in-progress saving/recorded animation.
  if (windowId === undefined || m.windowId !== windowId || transient) return;
  renderView(m.view!);
});

async function init(): Promise<void> {
  const win = await browser.windows.getCurrent();
  windowId = win.id;
  const res = await browser.runtime.sendMessage({ type: 'SIDEBAR_GET_STATE', windowId }) as SidebarUpdateMsg;
  renderView(res.view);
}

// Re-pull the resting view after a transient animation ends (we ignored pushes during it).
async function pullState(): Promise<void> {
  if (windowId === undefined) return;
  const res = await browser.runtime.sendMessage({ type: 'SIDEBAR_GET_STATE', windowId }) as SidebarUpdateMsg;
  renderView(res.view);
}

// ── DOM helpers (textContent-only) ─────────────────────────────────────────────

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = make('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
}

const detail = () => document.getElementById('detail')!;

// ── view dispatch ──────────────────────────────────────────────────────────────

function renderView(view: SidebarView): void {
  const d = detail();
  d.replaceChildren();
  switch (view.view) {
    case 'no-run':    renderNoRun(d); break;
    case 'guidance':  renderGuidance(d, view.item); break;
    case 'verdict':   renderVerdict(d, view.item); break;
    case 'challenge': renderChallenge(d, view.item); break;
    case 'revisit':   renderRevisit(d, view.waiting, view.focusId); break;
    case 'done':      renderDone(d, view.progress.done, view.progress.total, view.progress.hits); break;
    case 'stopped':   renderStopped(d, view.checked, view.total, view.hits); break;
    case 'saving':    renderSaving(d); break;
    case 'recorded':  renderRecorded(d); break;
  }
  // The detail view is windowId-scoped, but GET_RUN_STATE returns the GLOBAL run. A `no-run`
  // view means THIS window has no run, so showing another window's checklist would render
  // rows whose FOCUS_ITEM{windowId} the background rejects (dead clicks) — clear it instead.
  // For any other view, the single pinned run IS this window's run, so the fetch is correct.
  if (view.view === 'no-run') clearChecklist();
  else void refreshChecklist();
}

// ── active-item detail views ────────────────────────────────────────────────────

// Generic "look for" chips + optional broker guidance. Never the user's own data.
function lookFor(d: HTMLElement, item: ActiveItemInfo): void {
  d.appendChild(make('div', 'label', 'Look for'));
  const ul = make('ul', 'exposes');
  for (const chip of item.exposes) ul.appendChild(make('li', undefined, chip)); // textContent — generic
  d.appendChild(ul);
  if (item.guidance) d.appendChild(make('p', 'guidance-msg', item.guidance)); // textContent — dataset
}

// Separate, clearly-labelled Defer control (decision 8): non-terminal, keeps the tab.
function deferControl(d: HTMLElement, itemId: string): void {
  const wrap = make('div', 'defer');
  wrap.appendChild(make('p', 'defer-note', 'Still loading? Set it aside and come back at the end.'));
  wrap.appendChild(button('Set aside', 'btn-quiet', () => send({ type: 'DEFER', itemId, windowId })));
  d.appendChild(wrap);
}

function renderGuidance(d: HTMLElement, item: ActiveItemInfo): void {
  lookFor(d, item);
  d.appendChild(make('p', 'question', 'Find yourself in the list, then open your details page to confirm.'));
  d.appendChild(button('Not found / no results', 'btn-secondary wide', () => castVerdict(item.itemId, 'clear')));

  // Paste-URL fallback: navigate the broker tab to a listing the user pastes.
  const paste = make('div', 'paste');
  const input = make('input', 'paste-input');
  input.type = 'text';
  input.placeholder = 'Or paste a link to your listing…';
  input.autocomplete = 'off';
  const go = button('Go to my listing', 'btn-quiet wide', () => {
    const url = input.value.trim();
    if (url) send({ type: 'NAVIGATE_BROKER_TAB', windowId, url });
  });
  paste.appendChild(input);
  paste.appendChild(go);
  d.appendChild(paste);

  deferControl(d, item.itemId);
}

function renderVerdict(d: HTMLElement, item: ActiveItemInfo): void {
  lookFor(d, item);
  d.appendChild(make('p', 'question', 'Could this listing be you?'));
  const grid = make('div', 'verdicts');
  grid.appendChild(button('Yes, this is me', 'btn-hit', () => castVerdict(item.itemId, 'hit')));
  grid.appendChild(button('No, not me', 'btn-clear', () => castVerdict(item.itemId, 'clear')));
  grid.appendChild(button('Not sure', 'btn-unknown', () => castVerdict(item.itemId, 'unknown')));
  grid.appendChild(button('Skip', 'btn-skip', () => castVerdict(item.itemId, 'skipped')));
  d.appendChild(grid);
  deferControl(d, item.itemId);
}

function renderChallenge(d: HTMLElement, item: ActiveItemInfo): void {
  d.appendChild(make('div', 'label', 'Security check'));
  d.appendChild(make('p', 'question', 'This site is running a security check. Complete it on the page, then expurge will show your results.'));
  d.appendChild(button('Skip this site', 'btn-skip wide', () => castVerdict(item.itemId, 'skipped')));
  deferControl(d, item.itemId);
}

function renderNoRun(d: HTMLElement): void {
  d.appendChild(make('p', 'empty', 'No active scan in this window.'));
  d.appendChild(make('p', 'empty-sub', "Start a scan from the expurge dashboard whenever you're ready — there's no rush."));
}

// focusId comes from the view (deriveView), so the button works even when revisit is the
// sidebar's very first render (reopen mid-revisit / after resume) — no dependency on the
// async checklist fetch having landed yet.
function renderRevisit(d: HTMLElement, waiting: number, focusId: string | null): void {
  d.appendChild(make('p', 'question', `${waiting} site${waiting !== 1 ? 's' : ''} waiting for you.`));
  d.appendChild(make('p', 'empty-sub', "These were set aside while they loaded. Pick them back up whenever you're ready."));
  const b = button('Revisit set-aside sites', 'btn-primary wide', () => {
    if (focusId) send({ type: 'FOCUS_ITEM', itemId: focusId, windowId });
  });
  if (!focusId) b.disabled = true;
  d.appendChild(b);
}

function renderDone(d: HTMLElement, done: number, total: number, hits: number): void {
  const headline = hits > 0
    ? `Found on ${hits} site${hits !== 1 ? 's' : ''}.`
    : 'No listings found here.';
  d.appendChild(make('p', 'question', headline));
  const sub = hits > 0
    ? `Checked ${done} of ${total}. Open the dashboard to send your opt-out requests.`
    : `Checked ${done} of ${total}. You're all clear here.`;
  d.appendChild(make('p', 'empty-sub', sub));
  d.appendChild(button('View results', 'btn-primary wide', () => { browser.runtime.openOptionsPage().catch(() => {}); }));
}

// Stop leaves the run isComplete but with abandoned items — honest copy, no "all clear".
function renderStopped(d: HTMLElement, checked: number, total: number, hits: number): void {
  d.appendChild(make('p', 'question', 'Scan stopped.'));
  const found = hits > 0 ? ` Found on ${hits} site${hits !== 1 ? 's' : ''}.` : '';
  d.appendChild(make('p', 'empty-sub', `Checked ${checked} of ${total}.${found} The rest are still on your list — start again anytime.`));
  d.appendChild(button('View results', 'btn-primary wide', () => { browser.runtime.openOptionsPage().catch(() => {}); }));
}

// ── transient interaction states (UI-owned, never derived) ──────────────────────

function renderSaving(d: HTMLElement): void {
  const s = make('div', 'status saving');
  s.appendChild(make('span', 'spinner'));
  s.appendChild(make('span', undefined, 'Saving your answer…'));
  d.appendChild(s);
}

function renderRecorded(d: HTMLElement): void {
  d.appendChild(make('p', 'status recorded', recordedMsg(lastVerdict)));
}

function recordedMsg(v: Verdict | null): string {
  if (v === 'hit')     return '✓ Marked as yours — we\'ll prepare an opt-out.';
  if (v === 'clear')   return '✓ Not listed here.';
  if (v === 'unknown') return '✓ Marked "not sure."';
  return '✓ Skipped.';
}

function renderVerdictError(): void {
  // Appended below the re-pulled view, so the verdict controls stay usable for a retry.
  detail().appendChild(make('p', 'status error', "Couldn't save just now — check your connection and try again."));
}

// Send a verdict and confirm the background wrote it: race each send against a 6s timeout, up
// to 3 attempts, true iff the reply is the {type:'ACK'} handshake (CLAUDE.md verdict contract).
// The write is idempotent (handleVerdict no-wedge guard), so a retry after a landed-but-lost
// ACK re-ACKs without re-recording.
async function sendVerdictAck(itemId: string, verdict: Verdict, attempt = 0): Promise<boolean> {
  const TIMEOUT_MS = 6_000;
  const MAX_ATTEMPTS = 3;
  try {
    const reply = await Promise.race([
      browser.runtime.sendMessage({ type: 'VERDICT', itemId, verdict, windowId }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
    return (reply as { type?: string })?.type === 'ACK';
  } catch {
    if (attempt < MAX_ATTEMPTS - 1) return sendVerdictAck(itemId, verdict, attempt + 1);
    return false;
  }
}

// Cast a verdict: own the panel through saving → recorded (~800 ms), then yield to the resting
// view (the background already recorded, advanced focus, and closed the tab). NEVER shows
// recorded unless the ACK confirmed the write; on failure it re-pulls the true state and leaves
// the controls usable so the user can retry.
async function castVerdict(itemId: string, verdict: Verdict): Promise<void> {
  if (windowId === undefined) return;
  transient = true;
  lastVerdict = verdict;

  const d = detail();
  d.replaceChildren();
  renderSaving(d);

  const ok = await sendVerdictAck(itemId, verdict);
  transient = false;

  if (!ok) {
    await pullState().catch(() => {});   // reflect reality (verdict may not have landed)
    renderVerdictError();
    return;
  }

  d.replaceChildren();
  renderRecorded(d);
  await delay(800);
  await pullState().catch(() => {});     // guarded so a rejected re-pull can't dead-end the panel
}

// ── checklist (Decision A: rendered from GET_RUN_STATE, re-fetched on each update) ──

async function refreshChecklist(): Promise<void> {
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' }) as { run?: RunState };
  const run = res.run ?? null;
  renderChecklist(run);
  renderProgress(run);
}

// Used for the no-run view (this window has no run) — don't show the global run's checklist.
function clearChecklist(): void {
  document.getElementById('checklist')!.replaceChildren();
  document.getElementById('progress')!.textContent = '';
}

function renderProgress(run: RunState | null): void {
  const p = document.getElementById('progress')!;
  if (!run) { p.textContent = ''; return; }
  const { done, total, hits } = progressOf(run);
  p.textContent = `${done} / ${total} checked${hits > 0 ? ` · ${hits} found` : ''}`;
}

const isMissing = (i: WorkItem): boolean =>
  typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:');

function renderChecklist(run: RunState | null): void {
  const c = document.getElementById('checklist')!;
  c.replaceChildren();
  if (!run) return;

  const groups: Array<[string, WorkItem[]]> = [
    ['In progress', run.items.filter(i => i.status === 'open')],
    ['Waiting',     run.items.filter(i => i.status === 'deferred')],
    ['Done',        run.items.filter(i => i.status === 'verdicted' && !isMissing(i))],
  ];

  for (const [title, items] of groups) {
    if (items.length === 0) continue;
    c.appendChild(make('div', 'group-label', `${title} · ${items.length}`));
    const ul = make('ul', 'rows');
    for (const item of items) ul.appendChild(row(item));
    c.appendChild(ul);
  }
}

// A checklist row: broker name (dataset) + a GENERIC "alternate name" tag for AKA variants
// (nameVariant is 'primary'/'aka_N' — never the actual name) + a "listed" marker for hits.
// Non-terminal rows are clickable → FOCUS_ITEM (manual override, decision 5).
function row(item: WorkItem): HTMLLIElement {
  const li = make('li', 'row');
  const broker = getBroker(item.brokerId);
  li.appendChild(make('span', 'row-name', broker?.name ?? item.brokerId)); // dataset/slug — textContent
  if (item.nameVariant !== 'primary') li.appendChild(make('span', 'row-tag', 'alternate name'));
  if (item.verdict === 'hit') li.appendChild(make('span', 'row-hit', 'listed'));

  if (item.status !== 'verdicted') {
    li.classList.add('clickable');
    li.setAttribute('role', 'button');
    li.tabIndex = 0;
    const jump = (): void => send({ type: 'FOCUS_ITEM', itemId: item.id, windowId });
    li.addEventListener('click', jump);
    li.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
    });
  }
  return li;
}

init().catch(() => {});
