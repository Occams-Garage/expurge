import browser from 'webextension-polyfill';
import type { RunState } from '../shared/types';
import type { Draft } from '../shared/templates';
import { mailtoUrl, toEml, toCopyText } from '../shared/templates';

// ── section routing ──────────────────────────────────────────────────────────

const SECTIONS = ['profile', 'run', 'draft'] as const;
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

// ── run status display ───────────────────────────────────────────────────────

function badgeClass(status: string, verdict?: string): string {
  if (verdict) return `badge badge-${verdict}`;
  return `badge badge-${status}`;
}

function renderRunSection(run: RunState): void {
  showSection('run');
  const container = document.getElementById('run-items')!;
  container.innerHTML = '';

  for (const item of run.items) {
    const row = document.createElement('div');
    row.className = 'run-item';

    const name = document.createElement('span');
    name.className = 'broker-name';
    name.textContent = item.brokerId;
    row.appendChild(name);

    const badge = document.createElement('span');
    badge.className = badgeClass(item.status, item.verdict);
    badge.textContent = item.verdict ?? item.status;
    row.appendChild(badge);

    container.appendChild(row);
  }
}

// ── draft display (M3) ───────────────────────────────────────────────────────

function renderDraftSection(draft: Draft, brokerId: string): void {
  showSection('draft');

  const summary = document.getElementById('draft-summary')!;
  summary.innerHTML = `
    <div class="field-row"><strong>Broker:</strong> ${escHtml(brokerId)}</div>
    <div class="field-row"><strong>To:</strong> ${escHtml(draft.to)}</div>
    <div class="field-row"><strong>Subject:</strong> ${escHtml(draft.subject)}</div>
  `;

  const copyText = toCopyText(draft);
  const copyArea = document.getElementById('copy-area')!;
  const copyTextEl = document.getElementById('copy-text') as HTMLTextAreaElement;
  copyTextEl.value = copyText;

  const btnMailto = document.getElementById('btn-mailto')!;
  const btnEml    = document.getElementById('btn-eml')!;
  const btnCopy   = document.getElementById('btn-copy')!;

  // "Open in mail app" — browser.tabs.create with a mailto: URL invokes the OS mail handler.
  btnMailto.onclick = () => {
    browser.tabs.create({ url: mailtoUrl(draft) });
  };

  // ".eml download" — encodes as a data: URL so browser.downloads can fetch it cross-context.
  btnEml.onclick = async () => {
    const content = toEml(draft);
    const bytes   = new TextEncoder().encode(content);
    let binary    = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    const b64     = btoa(binary);
    const url     = `data:message/rfc822;base64,${b64}`;
    await browser.downloads.download({
      url,
      filename: `expurge-optout-${brokerId}.eml`,
      saveAs: false,
    });
  };

  // "Copy to clipboard" — also reveals the textarea for manual selection.
  btnCopy.onclick = async () => {
    copyArea.classList.remove('hidden');
    try {
      await navigator.clipboard.writeText(copyText);
      btnCopy.textContent = 'Copied!';
      setTimeout(() => { btnCopy.textContent = 'Copy to clipboard'; }, 2000);
    } catch {
      // Clipboard API unavailable — the textarea fallback is already visible.
      copyTextEl.select();
    }
  };

  document.getElementById('btn-back')!.onclick = async () => {
    const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
    const run = (res as { run?: RunState }).run;
    if (run) renderRunSection(run);
    else showSection('profile');
  };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── profile form submit (M1) ─────────────────────────────────────────────────

async function handleFormSubmit(e: Event): Promise<void> {
  e.preventDefault();
  clearError();

  const form  = e.target as HTMLFormElement;
  const data  = new FormData(form);
  const first = (data.get('first') as string).trim();
  const last  = (data.get('last') as string).trim();
  const city  = (data.get('city') as string).trim();
  const state = (data.get('state') as string).trim().toUpperCase();

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
      profile: { first, last, city, state },
    });

    // Poll once immediately — the tab has been opened.
    const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
    const run = (res as { run?: RunState }).run;
    if (run) renderRunSection(run);
    else showSection('run');
  } catch (err) {
    showError('Something went wrong. Is the extension active?');
    btn.disabled = false;
    btn.textContent = 'Check for my data';
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Check for an active run first.
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
  const run = (res as { run?: RunState }).run;

  if (!run) {
    showSection('profile');
    return;
  }

  // If there's a hit, try to load the draft.
  const hitItem = run.items.find(i => i.verdict === 'hit');
  if (hitItem) {
    const draftRes = await browser.runtime.sendMessage({
      type: 'GET_DRAFT',
      brokerId: hitItem.brokerId,
    });
    const d = (draftRes as { draft?: Draft }).draft;
    if (d) {
      renderDraftSection(d, hitItem.brokerId);
      return;
    }
  }

  renderRunSection(run);
}

// Wire up the form.
document.getElementById('profile-form')!.addEventListener('submit', (e) => {
  void handleFormSubmit(e);
});

// Refresh button re-polls the background.
document.getElementById('btn-refresh')!.addEventListener('click', async () => {
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
  const run = (res as { run?: RunState }).run;
  if (!run) { showSection('profile'); return; }

  const hitItem = run.items.find(i => i.verdict === 'hit');
  if (hitItem) {
    const draftRes = await browser.runtime.sendMessage({
      type: 'GET_DRAFT',
      brokerId: hitItem.brokerId,
    });
    const d = (draftRes as { draft?: Draft }).draft;
    if (d) { renderDraftSection(d, hitItem.brokerId); return; }
  }
  renderRunSection(run);
});

init().catch(console.error);
