import browser from 'webextension-polyfill';
import type { Profile, RunState, WorkItem } from '../shared/types';
import type { Draft, EmailDraft, FormDraft } from '../shared/templates';
import { mailtoUrl, toEml, toCopyText } from '../shared/templates';
import { BROKERS, getBroker } from '../shared/brokers';

type Section = 'run' | 'results' | 'profile' | 'settings';
type RunDisplayState = 'welcome' | 'ready' | 'active' | 'done';
type SendMethod = 'mailto' | 'eml' | 'copy';

const PREF_KEY = 'expurge_prefs';

let currentRun: RunState | null = null;
let currentProfile: Profile | null = null;
let sendMethod: SendMethod = 'mailto';
let pollHandle: number | null = null;

// ── section routing ──────────────────────────────────────────────────────────

function showSection(id: Section): void {
  (['run', 'results', 'profile', 'settings'] as Section[]).forEach(s => {
    document.getElementById(`section-${s}`)!.classList.toggle('hidden', s !== id);
  });
  document.querySelectorAll<HTMLElement>('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset['section'] === id);
  });
}

// ── html escape ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      const hits = run.items.filter(i => i.verdict === 'hit').length;
      const total = run.items.filter(
        i => !(typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:'))
      ).length;
      document.getElementById('run-done-desc')!.textContent = hits > 0
        ? `Found your data on ${hits} site${hits !== 1 ? 's' : ''} out of ${total} checked. Check Results for opt-out requests.`
        : `Checked ${total} site${total !== 1 ? 's' : ''} — your data wasn't found on any of them.`;
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

function renderResults(run: RunState): void {
  document.getElementById('results-empty')!.classList.add('hidden');
  document.getElementById('results-content')!.classList.remove('hidden');

  const groups = new Map<string, WorkItem[]>();
  for (const item of run.items) {
    const g = groups.get(item.brokerId) ?? [];
    g.push(item);
    groups.set(item.brokerId, g);
  }

  const listed: WorkItem[] = [], unknown: WorkItem[] = [];
  const skipped: WorkItem[] = [], clear: WorkItem[] = [];

  for (const items of groups.values()) {
    const rep = items.find(i => i.verdict === 'hit')
      ?? items.find(i => i.verdict === 'unknown')
      ?? items.find(i => i.verdict === 'clear')
      ?? items[0];
    if (!rep) continue;
    if (rep.verdict === 'hit')          listed.push(rep);
    else if (rep.verdict === 'unknown') unknown.push(rep);
    else if (rep.verdict === 'clear')   clear.push(rep);
    else                                skipped.push(rep);
  }

  const inRun = new Set(run.items.map(i => i.brokerId));
  const notInRun = BROKERS.filter(b => !inRun.has(b.id));

  const container = document.getElementById('results-groups')!;
  container.innerHTML = '';

  if (listed.length > 0)   container.appendChild(buildResultGroup('Listed', listed, true, run));
  if (unknown.length > 0)  container.appendChild(buildResultGroup("Couldn't tell", unknown, false, run));
  if (skipped.length > 0)  container.appendChild(buildResultGroup('Skipped', skipped, false, run));
  if (clear.length > 0)    container.appendChild(buildCollapsibleGroup('Not found', clear));
  if (notInRun.length > 0) container.appendChild(buildNotCheckedGroup(notInRun));
}

function buildResultGroup(title: string, items: WorkItem[], hasDraft: boolean, run: RunState): HTMLElement {
  const div = document.createElement('div');
  div.className = 'results-group';
  div.innerHTML = `
    <div class="results-group-header">
      <span class="results-group-title">${esc(title)}</span>
      <span class="results-count">${items.length}</span>
    </div>
  `;

  for (const item of items) {
    const name     = getBroker(item.brokerId)?.name ?? item.brokerId;
    const hitItem  = run.items.find(i => i.brokerId === item.brokerId && i.verdict === 'hit');
    const sentAt   = hitItem?.optedOutAt;

    const row = document.createElement('div');
    row.className = 'result-item';
    row.innerHTML = `
      <div class="result-item-header">
        <span class="result-broker-name">${esc(name)}</span>
        <div>
          ${hasDraft
            ? `<button class="btn-draft-toggle${sentAt ? ' sent' : ''}" data-broker="${esc(item.brokerId)}">
                 ${sentAt ? 'Sent ✓' : 'Get opt-out request'}
               </button>`
            : `<span class="skip-reason">${esc(item.skipReason ?? item.verdict ?? '')}</span>`}
        </div>
      </div>
      <div class="draft-panel hidden"></div>
    `;

    if (hasDraft && !sentAt) {
      const btn   = row.querySelector<HTMLButtonElement>('.btn-draft-toggle')!;
      const panel = row.querySelector<HTMLElement>('.draft-panel')!;
      btn.addEventListener('click', () => {
        if (panel.classList.contains('hidden')) {
          panel.classList.remove('hidden');
          if (!panel.dataset['loaded']) {
            panel.dataset['loaded'] = '1';
            loadDraftPanel(panel, item.brokerId).catch(console.error);
          }
        } else {
          panel.classList.add('hidden');
        }
      });
    }

    div.appendChild(row);
  }
  return div;
}

function buildCollapsibleGroup(title: string, items: WorkItem[]): HTMLElement {
  return buildToggleGroup(title, items, item => {
    const row = document.createElement('div');
    row.className = 'result-item';
    row.innerHTML = `
      <div class="result-item-header">
        <span class="result-broker-name">${esc(getBroker(item.brokerId)?.name ?? item.brokerId)}</span>
        <span class="badge badge-clear">not listed</span>
      </div>`;
    return row;
  });
}

function buildNotCheckedGroup(brokers: readonly (typeof BROKERS)[number][]): HTMLElement {
  return buildToggleGroup('Not checked', brokers as unknown as WorkItem[], b => {
    const broker = b as unknown as (typeof BROKERS)[number];
    const row = document.createElement('div');
    row.className = 'result-item';
    row.innerHTML = `
      <div class="result-item-header">
        <span class="result-broker-name">${esc(broker.name)}</span>
        <span class="badge badge-skipped">${broker.status}</span>
      </div>`;
    return row;
  });
}

function buildToggleGroup<T>(title: string, items: T[], renderItem: (item: T) => HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'results-group';

  const toggle = document.createElement('button');
  toggle.className = 'results-group-toggle';
  toggle.innerHTML = `<span class="results-group-title">${esc(title)}</span><span class="results-count">${items.length} ▸</span>`;

  const body = document.createElement('div');
  body.className = 'hidden';

  toggle.addEventListener('click', () => {
    const collapsed = body.classList.toggle('hidden');
    toggle.querySelector<HTMLElement>('.results-count')!.textContent = `${items.length} ${collapsed ? '▸' : '▾'}`;
  });

  for (const item of items) body.appendChild(renderItem(item));
  div.appendChild(toggle);
  div.appendChild(body);
  return div;
}

// ── draft loading + rendering ─────────────────────────────────────────────────

async function loadDraftPanel(panel: HTMLElement, brokerId: string): Promise<void> {
  panel.textContent = 'Loading…';
  const res = await browser.runtime.sendMessage({ type: 'GET_DRAFT', brokerId }) as { draft?: Draft; reason?: string };
  if (!res.draft) {
    panel.innerHTML = `<p class="note">No opt-out request available. ${esc(res.reason ?? '')}</p>`;
    return;
  }
  renderDraftInPanel(panel, res.draft, brokerId);
}

function renderDraftInPanel(panel: HTMLElement, draft: Draft, brokerId: string): void {
  if (draft.kind === 'form') renderFormDraftInPanel(panel, draft as FormDraft, brokerId);
  else                       renderEmailDraftInPanel(panel, draft as EmailDraft, brokerId);
}

function renderEmailDraftInPanel(panel: HTMLElement, draft: EmailDraft, brokerId: string): void {
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
      <button class="btn-quiet" data-action="mark-sent">Mark as sent</button>
    </div>
  `;

  panel.querySelector<HTMLButtonElement>('[data-action="mailto"]')!.onclick = () => {
    browser.tabs.create({ url: mailtoUrl(draft) }).catch(console.error);
  };

  panel.querySelector<HTMLButtonElement>('[data-action="eml"]')!.onclick = async () => {
    const url = URL.createObjectURL(new Blob([toEml(draft)], { type: 'message/rfc822' }));
    try {
      await browser.downloads.download({ url, filename: `expurge-optout-${brokerId}.eml`, saveAs: false });
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

  panel.querySelector<HTMLButtonElement>('[data-action="mark-sent"]')!.onclick = async () => {
    await browser.runtime.sendMessage({ type: 'MARK_SENT', brokerId });
    panel.querySelector('.draft-mark-sent')!.innerHTML = '<span class="sent-badge">Sent ✓</span>';
    const toggleBtn = document.querySelector<HTMLButtonElement>(`.btn-draft-toggle[data-broker="${brokerId}"]`);
    if (toggleBtn) { toggleBtn.textContent = 'Sent ✓'; toggleBtn.classList.add('sent'); }
    if (currentRun) {
      currentRun = {
        ...currentRun,
        items: currentRun.items.map(i =>
          i.brokerId === brokerId && i.verdict === 'hit' && !i.optedOutAt
            ? { ...i, optedOutAt: new Date().toISOString() }
            : i
        ),
      };
    }
  };
}

function renderFormDraftInPanel(panel: HTMLElement, draft: FormDraft, brokerId: string): void {
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
      <button class="btn-quiet" data-action="mark-submitted">Mark as submitted</button>
    </div>
  `;

  panel.querySelector<HTMLButtonElement>('[data-action="open-form"]')!.onclick = () => {
    browser.tabs.create({ url: draft.formUrl }).catch(console.error);
  };

  panel.querySelector<HTMLButtonElement>('[data-action="mark-submitted"]')!.onclick = async () => {
    await browser.runtime.sendMessage({ type: 'MARK_SENT', brokerId });
    panel.querySelector('.draft-mark-sent')!.innerHTML = '<span class="sent-badge">Submitted ✓</span>';
    const toggleBtn = document.querySelector<HTMLButtonElement>(`.btn-draft-toggle[data-broker="${brokerId}"]`);
    if (toggleBtn) { toggleBtn.textContent = 'Submitted ✓'; toggleBtn.classList.add('sent'); }
    if (currentRun) {
      currentRun = {
        ...currentRun,
        items: currentRun.items.map(i =>
          i.brokerId === brokerId && i.verdict === 'hit' && !i.optedOutAt
            ? { ...i, optedOutAt: new Date().toISOString() }
            : i
        ),
      };
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
  (document.getElementById('p-also-known-as') as HTMLTextAreaElement).value = (profile.also_known_as ?? []).join('\n');
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

  return {
    first, last, city, state, middle, zip, age,
    also_known_as: parseLines('p-also-known-as'),
    relatives:     parseLines('p-relatives'),
    emails:        parseLines('p-emails'),
    phones:        parseLines('p-phones'),
  };
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

  const btn = document.getElementById('btn-save-profile') as HTMLButtonElement;
  btn.disabled = true;
  await browser.runtime.sendMessage({ type: 'SAVE_PROFILE', profile });
  currentProfile = profile;
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

  const json = JSON.stringify({ expurge_export: true, profile: profileRes.profile ?? null, run: runRes.run ?? null }, null, 2);
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
  stopPolling();
  (document.getElementById('profile-form') as HTMLFormElement).reset();
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
