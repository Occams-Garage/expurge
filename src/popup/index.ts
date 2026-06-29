import browser from 'webextension-polyfill';
import type { RunState, WorkItem } from '../shared/types';
import type { Draft, EmailDraft, FormDraft } from '../shared/templates';
import { mailtoUrl, toEml, toCopyText } from '../shared/templates';
import { BROKERS, getBroker } from '../shared/brokers';

// ── section routing ──────────────────────────────────────────────────────────

const SECTIONS = ['profile', 'draft'] as const;
type Section = (typeof SECTIONS)[number];

function showSection(id: Section): void {
  for (const s of SECTIONS) {
    const el = document.getElementById(`section-${s}`);
    if (el) el.classList.toggle('hidden', s !== id);
  }
}

// ── error display ────────────────────────────────────────────────────────────

function showError(msg: string): void {
  const el = document.getElementById('form-error')!;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError(): void {
  const el = document.getElementById('form-error')!;
  el.textContent = '';
  el.classList.add('hidden');
}

// ── run active view ──────────────────────────────────────────────────────────

// ── broker table helpers ──────────────────────────────────────────────────────

function brokerBadge(items: WorkItem[]): { kind: string; label: string } {
  if (items.some(i => i.verdict === 'hit'))    return { kind: 'hit',     label: 'listed' };
  if (items.some(i => i.status === 'open'))    return { kind: 'open',    label: 'open' };
  if (items.some(i => i.status === 'pending')) return { kind: 'pending', label: 'pending' };
  if (items.some(i => i.verdict === 'unknown'))return { kind: 'unknown', label: 'unknown' };
  if (items.some(i => i.verdict === 'clear'))  return { kind: 'clear',   label: 'not listed' };
  return { kind: 'skipped', label: 'skipped' };
}

function renderBrokerTable(run: RunState): void {
  const tableEl = document.getElementById('broker-table')!;
  const coverageEl = document.getElementById('coverage-note')!;

  // Group items by brokerId, preserving order.
  const groups = new Map<string, WorkItem[]>();
  for (const item of run.items) {
    const g = groups.get(item.brokerId) ?? [];
    g.push(item);
    groups.set(item.brokerId, g);
  }

  const rows: string[] = [];
  for (const [brokerId, items] of groups) {
    const broker = getBroker(brokerId);
    const name = broker?.name ?? brokerId;
    const badge = brokerBadge(items);
    const akaCount = items.filter(i => i.nameVariant !== 'primary').length;
    const akaHtml = akaCount > 0
      ? `<span class="aka-count">+${akaCount} AKA</span>`
      : '';
    rows.push(`
      <div class="run-item">
        <span class="broker-name">${escHtml(name)}${akaHtml}</span>
        <span class="badge badge-${badge.kind}">${badge.label}</span>
      </div>
    `);
  }
  tableEl.innerHTML = rows.join('');

  // Coverage note: brokers present in the dataset but not in this run (disabled/broken),
  // plus variants skipped due to missing profile fields.
  const activeIds = new Set(run.items.map(i => i.brokerId));
  const notChecked = BROKERS.filter(b => b.status !== 'active' || !activeIds.has(b.id));
  const missingFieldSkips = run.items.filter(
    i => typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:')
  ).length;

  const notes: string[] = [];
  if (notChecked.length > 0) {
    notes.push(`${notChecked.length} broker${notChecked.length > 1 ? 's' : ''} not in run`);
  }
  if (missingFieldSkips > 0) {
    notes.push(`${missingFieldSkips} variant${missingFieldSkips > 1 ? 's' : ''} skipped · profile info missing`);
  }

  if (notes.length > 0) {
    coverageEl.textContent = notes.join(' · ');
    coverageEl.classList.remove('hidden');
  } else {
    coverageEl.classList.add('hidden');
  }
}

// ── run active view ──────────────────────────────────────────────────────────

function showRunActive(run: RunState): void {
  showSection('profile');

  document.getElementById('profile-form-view')!.classList.add('hidden');
  const activeView = document.getElementById('run-active-view')!;
  activeView.classList.remove('hidden');

  // Exclude pre-skipped (missing-field) items from the checked/total counter
  // so the user sees only the items that actually required a tab.
  const checkable = run.items.filter(
    i => !(typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:'))
  );
  const done    = checkable.filter(i => i.status === 'verdicted').length;
  const total   = checkable.length;
  const hits    = run.items.filter(i => i.verdict === 'hit').length;
  const allDone = run.items.every(i => i.status === 'verdicted');

  document.getElementById('run-active-heading')!.textContent =
    allDone ? 'Run complete' : 'Run in progress';

  let summary = `${done} / ${total} checked`;
  if (hits > 0) summary += ` · ${hits} found`;
  document.getElementById('run-active-text')!.textContent = summary;

  renderBrokerTable(run);

  document.getElementById('btn-stop-run')!.classList.toggle('hidden', allDone);

  const viewDraftsBtn = document.getElementById('btn-view-drafts')!;
  viewDraftsBtn.classList.toggle('hidden', hits === 0);
}

function showProfileForm(): void {
  showSection('profile');
  document.getElementById('profile-form-view')!.classList.remove('hidden');
  document.getElementById('run-active-view')!.classList.add('hidden');
}

// ── html helper ──────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── back button (shared) ─────────────────────────────────────────────────────

function wireBackButton(): void {
  document.getElementById('btn-back')!.onclick = async () => {
    const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
    const run = (res as { run?: RunState }).run;
    if (run) showRunActive(run);
    else showProfileForm();
  };
}

// ── email draft display ──────────────────────────────────────────────────────

function renderEmailDraftSection(draft: EmailDraft, brokerId: string): void {
  showSection('draft');
  wireBackButton();

  const content = document.getElementById('draft-content')!;
  content.innerHTML = `
    <div class="draft-box">
      <div class="field-row"><strong>Broker:</strong> ${escHtml(brokerId)}</div>
      <div class="field-row"><strong>To:</strong> ${escHtml(draft.to)}</div>
      <div class="field-row"><strong>Subject:</strong> ${escHtml(draft.subject)}</div>
    </div>
    <div class="send-buttons">
      <button id="btn-mailto" class="btn-send btn-mailto">Open in mail app</button>
      <button id="btn-eml"    class="btn-send btn-eml">Download .eml file</button>
      <button id="btn-copy"   class="btn-send btn-copy">Copy to clipboard</button>
    </div>
    <div class="copy-area hidden" id="copy-area">
      <textarea id="copy-text" readonly></textarea>
      <p class="copy-note">Select all and copy, or use the button above.</p>
    </div>
  `;

  const copyText = toCopyText(draft);
  (document.getElementById('copy-text') as HTMLTextAreaElement).value = copyText;

  document.getElementById('btn-mailto')!.onclick = () => {
    browser.tabs.create({ url: mailtoUrl(draft) });
  };

  document.getElementById('btn-eml')!.onclick = async () => {
    const emlContent = toEml(draft);
    const bytes      = new TextEncoder().encode(emlContent);
    let binary       = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    const b64  = btoa(binary);
    const url  = `data:message/rfc822;base64,${b64}`;
    await browser.downloads.download({
      url,
      filename: `expurge-optout-${brokerId}.eml`,
      saveAs: false,
    });
  };

  const copyArea = document.getElementById('copy-area')!;
  const btnCopy  = document.getElementById('btn-copy')!;
  btnCopy.onclick = async () => {
    copyArea.classList.remove('hidden');
    try {
      await navigator.clipboard.writeText(copyText);
      btnCopy.textContent = 'Copied!';
      setTimeout(() => { btnCopy.textContent = 'Copy to clipboard'; }, 2000);
    } catch {
      (document.getElementById('copy-text') as HTMLTextAreaElement).select();
    }
  };
}

// ── form card display ────────────────────────────────────────────────────────

function renderFormDraftSection(draft: FormDraft): void {
  showSection('draft');
  wireBackButton();

  const fieldsHtml = draft.fields.map(f => `
    <tr>
      <td class="form-field-label">${escHtml(f.label)}</td>
      <td class="form-field-value">
        ${f.value
          ? `<span class="form-value-text">${escHtml(f.value)}</span>`
          : `<em class="form-value-empty">you fill in</em>`}
        ${f.note ? `<div class="form-field-note">${escHtml(f.note)}</div>` : ''}
      </td>
    </tr>
  `).join('');

  const stepsHtml = draft.steps.map(s => `<li>${escHtml(s)}</li>`).join('');

  const content = document.getElementById('draft-content')!;
  content.innerHTML = `
    <div class="draft-box">
      <div class="field-row"><strong>Broker:</strong> ${escHtml(draft.brokerName)}</div>
      <div class="field-row form-channel-note">Opt-out is via web form — follow the steps below.</div>
    </div>
    <div class="form-card-section">
      <p class="form-card-label">Fill in these fields</p>
      <table class="form-fields-table">${fieldsHtml}</table>
    </div>
    <div class="form-card-section">
      <p class="form-card-label">Steps</p>
      <ol class="form-steps-list">${stepsHtml}</ol>
    </div>
    <button id="btn-open-form" class="btn-send btn-form">Open opt-out form →</button>
  `;

  document.getElementById('btn-open-form')!.onclick = () => {
    browser.tabs.create({ url: draft.formUrl });
  };
}

// ── draft dispatch ────────────────────────────────────────────────────────────

function renderDraftSection(draft: Draft, brokerId: string): void {
  if (draft.kind === 'form') {
    renderFormDraftSection(draft);
  } else {
    renderEmailDraftSection(draft, brokerId);
  }
}

// ── draft loading ─────────────────────────────────────────────────────────────

async function loadAndRenderDraft(run: RunState): Promise<boolean> {
  const hitItem = run.items.find(i => i.verdict === 'hit');
  if (!hitItem) return false;
  const res = await browser.runtime.sendMessage({ type: 'GET_DRAFT', brokerId: hitItem.brokerId });
  const d = (res as { draft?: Draft }).draft;
  if (!d) return false;
  renderDraftSection(d, hitItem.brokerId);
  return true;
}

// ── profile form submit ──────────────────────────────────────────────────────

async function handleFormSubmit(e: Event): Promise<void> {
  e.preventDefault();
  clearError();

  const form  = e.target as HTMLFormElement;
  const data  = new FormData(form);
  const first = (data.get('first') as string).trim();
  const last  = (data.get('last') as string).trim();
  const city  = (data.get('city') as string).trim();
  const state = (data.get('state') as string).trim().toUpperCase();
  const akaRaw = (data.get('also_known_as') as string ?? '').trim();
  const also_known_as = akaRaw
    ? akaRaw.split('\n').map(s => s.trim()).filter(Boolean)
    : undefined;

  if (!first || !last || !city || !state) {
    showError('Please fill in all fields.');
    return;
  }

  const btn = document.getElementById('btn-start') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Requesting access…';

  try {
    // Must be called from a user gesture — this click handler IS the gesture.
    const granted = await browser.permissions.request({
      origins: ['*://*.truepeoplesearch.com/*'],
    });

    if (!granted) {
      showError(
        'Permission not granted. Allow access to TruePeopleSearch when prompted to continue.'
      );
      btn.disabled = false;
      btn.textContent = 'Check for my data';
      return;
    }

    btn.textContent = 'Opening search…';
    await browser.runtime.sendMessage({
      type: 'START_RUN',
      profile: { first, last, city, state, ...(also_known_as ? { also_known_as } : {}) },
    });

    const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
    const run = (res as { run?: RunState }).run;
    if (run) showRunActive(run);
    else showProfileForm();
  } catch {
    showError('Something went wrong. Is the extension active?');
    btn.disabled = false;
    btn.textContent = 'Check for my data';
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
  const run = (res as { run?: RunState }).run;

  if (!run) {
    showProfileForm();
    return;
  }

  if (await loadAndRenderDraft(run)) return;

  showRunActive(run);
}

// ── event wiring ─────────────────────────────────────────────────────────────

document.getElementById('profile-form')!.addEventListener('submit', (e) => {
  void handleFormSubmit(e);
});

document.getElementById('btn-restore-overlay')!.addEventListener('click', async () => {
  const btn = document.getElementById('btn-restore-overlay') as HTMLButtonElement;
  btn.disabled = true;
  const res = await browser.runtime.sendMessage({ type: 'REINJECT_OVERLAY' }) as { ok?: boolean };
  if (!res?.ok) {
    btn.textContent = 'Nothing left to check';
    setTimeout(() => { btn.textContent = 'Restore overlay'; btn.disabled = false; }, 2000);
  } else {
    btn.disabled = false; // popup will close when the browser switches to the tab
  }
});

document.getElementById('btn-stop-run')!.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'STOP_RUN' });
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
  const run = (res as { run?: RunState }).run;
  if (run) showRunActive(run);
});

document.getElementById('btn-view-drafts')!.addEventListener('click', async () => {
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
  const run = (res as { run?: RunState }).run;
  if (run) await loadAndRenderDraft(run);
});

init().catch(console.error);
