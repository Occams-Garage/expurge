import browser from 'webextension-polyfill';
import type { Verdict, ItemInfoMsg } from '../shared/types';

// ── Shadow DOM overlay ───────────────────────────────────────────────────────
// The overlay NEVER injects the user's profile data into the page DOM.
// It shows only the broker's generic exposes[] list ("full name", "age", etc.)
// so page scripts cannot read the user's actual values from the DOM.

const OVERLAY_STYLES = `
:host {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.4;
}
.panel {
  background: #1e293b;
  color: #f1f5f9;
  border-radius: 12px;
  padding: 16px;
  width: 292px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3);
}
.header {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 12px;
}
.label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
  margin-bottom: 5px;
}
.exposes {
  list-style: none;
  padding: 0;
  margin: 0 0 10px 0;
}
.exposes li {
  font-size: 13px;
  color: #cbd5e1;
  padding: 1px 0;
}
.exposes li::before {
  content: "·";
  color: #475569;
  margin-right: 7px;
}
.question {
  font-size: 13px;
  color: #94a3b8;
  margin: 0 0 12px 0;
}
.buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.btn {
  padding: 8px 4px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.1s;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn:not(:disabled):hover { filter: brightness(1.12); }
.btn-hit     { background: #16a34a; color: #fff; }
.btn-clear   { background: #2563eb; color: #fff; }
.btn-unknown { background: #475569; color: #f1f5f9; }
.btn-skip    { background: transparent; color: #94a3b8; border: 1px solid #334155; }
.status {
  margin-top: 10px;
  font-size: 12px;
  min-height: 18px;
  color: #94a3b8;
  text-align: center;
}
.status.saving   { color: #fbbf24; }
.status.recorded { color: #34d399; font-weight: 600; }

/* ── guidance panel (results page) ── */
.guidance-msg {
  font-size: 13px;
  color: #cbd5e1;
  margin: 0 0 12px 0;
  line-height: 1.5;
}
.toggle-link {
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  text-decoration: underline;
  display: block;
  margin-top: 4px;
}
.toggle-link:hover { color: #94a3b8; }
.paste-section {
  margin-top: 10px;
}
.paste-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 6px;
  color: #f1f5f9;
  font-size: 12px;
  outline: none;
  margin-bottom: 6px;
}
.paste-input:focus { border-color: #2563eb; }
.paste-warning {
  font-size: 11px;
  color: #f59e0b;
  margin-bottom: 6px;
  display: none;
}
.paste-warning.visible { display: block; }
`;

type OverlayState = 'unjudged' | 'saving' | 'recorded';

interface OverlayRefs {
  buttons: HTMLElement;
  btnHit: HTMLButtonElement;
  btnClear: HTMLButtonElement;
  btnUnknown: HTMLButtonElement;
  btnSkip: HTMLButtonElement;
  status: HTMLElement;
}

function setOverlayState(refs: OverlayRefs, state: OverlayState, label = ''): void {
  const disabled = state !== 'unjudged';
  refs.btnHit.disabled     = disabled;
  refs.btnClear.disabled   = disabled;
  refs.btnUnknown.disabled = disabled;
  refs.btnSkip.disabled    = disabled;

  refs.status.className = `status ${state === 'unjudged' ? '' : state}`;
  refs.status.textContent =
    state === 'saving'   ? '⋯ Saving…'    :
    state === 'recorded' ? `✓ ${label}`   :
    '';
}

// ── verdict panel (details / profile page) ───────────────────────────────────

function buildVerdictPanel(exposes: string[]): { host: HTMLElement; refs: OverlayRefs } {
  const host = document.createElement('div');
  host.id = 'expurge-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="header">expurge</div>
    <div class="guidance">
      <div class="label">Look for</div>
      <ul class="exposes" id="exp-list"></ul>
      <p class="question">Is your information listed on this page?</p>
    </div>
    <div class="buttons" id="verdict-btns">
      <button class="btn btn-hit"     id="btn-hit">Listed (Yes)</button>
      <button class="btn btn-clear"   id="btn-clear">Not Listed (No)</button>
      <button class="btn btn-unknown" id="btn-unknown">Not Sure</button>
      <button class="btn btn-skip"    id="btn-skip">Skip</button>
    </div>
    <div class="status" id="overlay-status"></div>
  `;

  const list = panel.querySelector('#exp-list')!;
  for (const item of exposes) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }

  shadow.appendChild(style);
  shadow.appendChild(panel);

  const refs: OverlayRefs = {
    buttons:    panel.querySelector('#verdict-btns') as HTMLElement,
    btnHit:     panel.querySelector('#btn-hit')      as HTMLButtonElement,
    btnClear:   panel.querySelector('#btn-clear')    as HTMLButtonElement,
    btnUnknown: panel.querySelector('#btn-unknown')  as HTMLButtonElement,
    btnSkip:    panel.querySelector('#btn-skip')     as HTMLButtonElement,
    status:     panel.querySelector('#overlay-status') as HTMLElement,
  };

  return { host, refs };
}

// ── guidance panel (results page) ────────────────────────────────────────────

function buildGuidancePanel(
  exposes: string[],
  brokerHostname: string,
  onVerdict: (verdict: Verdict, listingUrl: string) => void,
): HTMLElement {
  const host = document.createElement('div');
  host.id = 'expurge-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;

  const panel = document.createElement('div');
  panel.className = 'panel';

  // Exposes list HTML
  const exposesHtml = exposes.map(e => `<li>${e}</li>`).join('');

  panel.innerHTML = `
    <div class="header">expurge</div>
    <div class="label">Look for</div>
    <ul class="exposes">${exposesHtml}</ul>
    <p class="guidance-msg">
      Found yourself? Click <strong>View Details →</strong> on your listing
      to open your profile, then confirm there.
    </p>
    <button class="toggle-link" id="toggle-paste">Can't access the details page? →</button>
    <div class="paste-section" id="paste-section" style="display:none">
      <input class="paste-input" id="paste-input" type="text"
             placeholder="Paste a link to your listing…" autocomplete="off">
      <div class="paste-warning" id="paste-warning">
        This doesn't look like a ${brokerHostname} URL — double-check before confirming.
      </div>
      <div class="buttons" id="paste-btns" style="display:none">
        <button class="btn btn-hit"     id="btn-hit">Listed (Yes)</button>
        <button class="btn btn-clear"   id="btn-clear">Not Listed (No)</button>
        <button class="btn btn-unknown" id="btn-unknown">Not Sure</button>
        <button class="btn btn-skip"    id="btn-skip">Skip</button>
      </div>
    </div>
    <div class="status" id="overlay-status"></div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(panel);

  const toggleBtn   = panel.querySelector('#toggle-paste')   as HTMLButtonElement;
  const pasteSection = panel.querySelector('#paste-section') as HTMLElement;
  const pasteInput  = panel.querySelector('#paste-input')    as HTMLInputElement;
  const pasteWarn   = panel.querySelector('#paste-warning')  as HTMLElement;
  const pasteBtns   = panel.querySelector('#paste-btns')     as HTMLElement;
  const statusEl    = panel.querySelector('#overlay-status') as HTMLElement;

  toggleBtn.addEventListener('click', () => {
    pasteSection.style.display = pasteSection.style.display === 'none' ? 'block' : 'none';
    toggleBtn.textContent = pasteSection.style.display === 'none'
      ? 'Can\'t access the details page? →'
      : 'Can\'t access the details page? ↓';
  });

  pasteInput.addEventListener('input', () => {
    const val = pasteInput.value.trim();
    if (!val) {
      pasteBtns.style.display = 'none';
      pasteWarn.classList.remove('visible');
      return;
    }

    // Show verdict buttons as soon as field is non-empty.
    pasteBtns.style.display = 'grid';

    // Same-domain check — warning only, never blocks.
    try {
      const parsed = new URL(val);
      const matches = parsed.hostname.endsWith(brokerHostname);
      pasteWarn.classList.toggle('visible', !matches);
    } catch {
      pasteWarn.classList.add('visible');
    }
  });

  const disableAll = () => {
    [panel.querySelector('#btn-hit'), panel.querySelector('#btn-clear'),
     panel.querySelector('#btn-unknown'), panel.querySelector('#btn-skip')]
      .forEach(b => { if (b) (b as HTMLButtonElement).disabled = true; });
  };

  const castFromPaste = async (verdict: Verdict) => {
    const listingUrl = pasteInput.value.trim();
    disableAll();
    statusEl.className = 'status saving';
    statusEl.textContent = '⋯ Saving…';
    onVerdict(verdict, listingUrl);
  };

  panel.querySelector('#btn-hit')!.addEventListener('click',     () => castFromPaste('hit'));
  panel.querySelector('#btn-clear')!.addEventListener('click',   () => castFromPaste('clear'));
  panel.querySelector('#btn-unknown')!.addEventListener('click', () => castFromPaste('unknown'));
  panel.querySelector('#btn-skip')!.addEventListener('click',    () => castFromPaste('skipped'));

  return host;
}

// ── verdict send + ack with retry ────────────────────────────────────────────

async function sendVerdict(
  itemId: string,
  verdict: Verdict,
  listingUrl: string,
  attempt = 0,
): Promise<boolean> {
  const TIMEOUT_MS = 6_000;
  const MAX_ATTEMPTS = 3;

  try {
    const race = await Promise.race([
      browser.runtime.sendMessage({ type: 'VERDICT', itemId, verdict, listingUrl }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)
      ),
    ]);
    return (race as { type?: string })?.type === 'ACK';
  } catch {
    if (attempt < MAX_ATTEMPTS - 1) {
      return sendVerdict(itemId, verdict, listingUrl, attempt + 1);
    }
    return false;
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  let info: ItemInfoMsg | null = null;
  try {
    info = await browser.runtime.sendMessage({ type: 'GET_ITEM' }) as ItemInfoMsg | null;
  } catch {
    return;
  }

  if (!info) return;

  const { itemId, exposes, renderedUrl } = info;

  // Detect results page: current path matches the search URL's path.
  const isResultsPage = (() => {
    try {
      return window.location.pathname === new URL(renderedUrl).pathname;
    } catch {
      return false;
    }
  })();

  const brokerHostname = (() => {
    try { return new URL(renderedUrl).hostname; } catch { return ''; }
  })();

  if (isResultsPage) {
    const onVerdict = async (verdict: Verdict, listingUrl: string) => {
      const host = document.getElementById('expurge-host')!;
      const shadow = host.shadowRoot!;
      const statusEl = shadow.querySelector('#overlay-status') as HTMLElement;

      const label =
        verdict === 'hit'     ? 'Listed'     :
        verdict === 'clear'   ? 'Not Listed' :
        verdict === 'unknown' ? 'Not Sure'   :
        'Skipped';

      const ok = await sendVerdict(itemId, verdict, listingUrl);
      statusEl.className = 'status recorded';
      statusEl.textContent = ok
        ? `✓ ${label} — open expurge to send your opt-out request.`
        : `✓ ${label} (retry failed — please reopen)`;
    };

    const host = buildGuidancePanel(exposes, brokerHostname, onVerdict);
    document.documentElement.appendChild(host);
  } else {
    // Details / profile page — full verdict panel.
    const { host, refs } = buildVerdictPanel(exposes);
    document.documentElement.appendChild(host);

    const onVerdict = async (verdict: Verdict) => {
      setOverlayState(refs, 'saving');
      const ok = await sendVerdict(itemId, verdict, window.location.href);
      const label =
        verdict === 'hit'     ? 'Listed'     :
        verdict === 'clear'   ? 'Not Listed' :
        verdict === 'unknown' ? 'Not Sure'   :
        'Skipped';
      const msg = ok
        ? `${label} — open expurge to send your opt-out request.`
        : `${label} (retry failed — please reopen)`;
      setOverlayState(refs, 'recorded', msg);
    };

    refs.btnHit.addEventListener('click',     () => onVerdict('hit'));
    refs.btnClear.addEventListener('click',   () => onVerdict('clear'));
    refs.btnUnknown.addEventListener('click', () => onVerdict('unknown'));
    refs.btnSkip.addEventListener('click',    () => onVerdict('skipped'));
  }
}

init();
