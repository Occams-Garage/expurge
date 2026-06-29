import browser from 'webextension-polyfill';
import type { RunState } from '../shared/types';
import type { Draft, EmailDraft, FormDraft } from '../shared/templates';
import { mailtoUrl, toEml, toCopyText } from '../shared/templates';

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

function showRunActive(run: RunState): void {
  showSection('profile');

  document.getElementById('profile-form-view')!.classList.add('hidden');
  const activeView = document.getElementById('run-active-view')!;
  activeView.classList.remove('hidden');

  const done    = run.items.filter(i => i.status === 'verdicted').length;
  const total   = run.items.length;
  const hits    = run.items.filter(i => i.verdict === 'hit').length;
  const allDone = done === total;

  document.getElementById('run-active-heading')!.textContent =
    allDone ? 'Run complete' : 'Run in progress';

  let summary = `${done} / ${total} checked`;
  if (hits > 0) summary += ` · ${hits} found`;
  document.getElementById('run-active-text')!.textContent = summary;

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
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return;
  await browser.runtime.sendMessage({ type: 'REINJECT_OVERLAY', tabId: tab.id });
});

document.getElementById('btn-view-drafts')!.addEventListener('click', async () => {
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' });
  const run = (res as { run?: RunState }).run;
  if (run) await loadAndRenderDraft(run);
});

init().catch(console.error);
