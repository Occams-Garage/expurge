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

  /* ── tokens: light ── */
  --surface:       #FBF6EE;
  --fill:          #ECE3D4;
  --border:        #ECE3D4;
  --text:          #211D18;
  --text-muted:    #6B6053;
  --text-faint:    #A99B8A;
  --primary:       #2C5446;
  --primary-hover: #244839;
  --on-primary:    #FBF6EE;
  --accent:        #B25C3C;
  --strip-bg:      #2C5446;
  --strip-ko:      #FBF6EE;
  --focus-shadow:  rgba(44,84,70,0.14);

  --font-display: "Newsreader", Georgia, serif;
  --font-ui:      "Hanken Grotesk", system-ui, sans-serif;
  --font-mono:    "IBM Plex Mono", ui-monospace, monospace;
}

@media (prefers-color-scheme: dark) {
  :host {
    --surface:       #2A2620;
    --fill:          #2E2A24;
    --border:        #3A342C;
    --text:          #FBF6EE;
    --text-muted:    #C9C2B6;
    --text-faint:    #9C9388;
    --primary:       #7FB89C;
    --primary-hover: #93C7AC;
    --on-primary:    #211D18;
    --accent:        #C9744E;
    --strip-bg:      #7FB89C;
    --strip-ko:      #211D18;
    --focus-shadow:  rgba(127,184,156,0.2);
  }
}

/* ── card ── */

.panel {
  background: var(--surface);
  border-radius: 14px;
  width: 292px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
}

/* ── top strip (brand identifier) ── */

.strip {
  background: var(--strip-bg);
  padding: 6px 14px 5px;
  border-bottom: 1.5px dashed var(--surface);
}

.wordmark {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: var(--strip-ko);
  line-height: 1;
}

/* ── body ── */

.body {
  padding: 12px 14px 14px;
}

/* ── labels ── */

.label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-bottom: 7px;
}

/* ── exposes chips ── */

.exposes {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.exposes li {
  background: var(--fill);
  color: var(--text-muted);
  border-radius: 9999px;
  padding: 2px 9px;
  font-size: 12px;
  line-height: 1.5;
}

/* ── question ── */

.question {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 12px;
  line-height: 1.5;
}

/* ── buttons ── */

.buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.btn {
  padding: 9px 6px;
  border-radius: 9px;
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
  min-height: 44px;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-hit {
  background: var(--primary);
  color: var(--on-primary);
  border: none;
}
.btn-hit:not(:disabled):hover { background: var(--primary-hover); }

.btn-clear {
  background: transparent;
  color: var(--primary);
  border: 1.5px solid var(--primary);
}
.btn-clear:not(:disabled):hover { background: var(--fill); }

.btn-unknown {
  background: transparent;
  color: var(--primary);
  border: none;
}
.btn-unknown:not(:disabled):hover { background: var(--fill); }

.btn-skip {
  background: transparent;
  color: var(--text-faint);
  border: none;
  font-weight: 400;
}
.btn-skip:not(:disabled):hover { background: var(--fill); }

/* ── status ── */

.status {
  margin-top: 10px;
  font-size: 12px;
  min-height: 18px;
  color: var(--text-faint);
  text-align: center;
}

@keyframes spin { to { transform: rotate(360deg); } }

.status.saving {
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}
.status.saving::before {
  content: "";
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--fill);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.status.recorded { color: var(--primary); font-weight: 600; }

/* ── guidance panel ── */

.guidance-msg {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 10px;
  line-height: 1.5;
}

.toggle-link {
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--text-faint);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  text-decoration: underline;
  display: block;
  margin-top: 4px;
}
.toggle-link:hover { color: var(--text-muted); }

.paste-section { margin-top: 10px; }

.paste-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: var(--fill);
  border: 1.5px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 12px;
  outline: none;
  margin-bottom: 6px;
}
.paste-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--focus-shadow);
}

.paste-warning {
  font-size: 11px;
  color: var(--accent);
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
    state === 'saving'   ? 'Saving your answer…' :
    state === 'recorded' ? `✓ ${label}`          :
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
    <div class="strip"><span class="wordmark">expurge</span></div>
    <div class="body">
      <div class="label">Look for</div>
      <ul class="exposes" id="exp-list"></ul>
      <p class="question">Could this listing be you?</p>
      <div class="buttons" id="verdict-btns">
        <button class="btn btn-hit"     id="btn-hit">Yes, this is me</button>
        <button class="btn btn-clear"   id="btn-clear">No, not me</button>
        <button class="btn btn-unknown" id="btn-unknown">Not sure</button>
        <button class="btn btn-skip"    id="btn-skip">Skip</button>
      </div>
      <div class="status" id="overlay-status"></div>
    </div>
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
    <div class="strip"><span class="wordmark">expurge</span></div>
    <div class="body">
      <div class="label">Look for</div>
      <ul class="exposes">${exposesHtml}</ul>
      <p class="guidance-msg">
        Found yourself? Click <strong>View Details →</strong> on your listing,
        then confirm on that page.
      </p>
      <button class="toggle-link" id="toggle-paste">Can't reach the details page? →</button>
      <div class="paste-section" id="paste-section" style="display:none">
        <input class="paste-input" id="paste-input" type="text"
               placeholder="Paste a link to your listing…" autocomplete="off">
        <div class="paste-warning" id="paste-warning">
          This doesn't look like a ${brokerHostname} URL — double-check before confirming.
        </div>
        <div class="buttons" id="paste-btns" style="display:none">
          <button class="btn btn-hit"     id="btn-hit">Yes, this is me</button>
          <button class="btn btn-clear"   id="btn-clear">No, not me</button>
          <button class="btn btn-unknown" id="btn-unknown">Not sure</button>
          <button class="btn btn-skip"    id="btn-skip">Skip</button>
        </div>
      </div>
      <div class="status" id="overlay-status"></div>
    </div>
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
        ? `✓ ${label} — open expurge to continue.`
        : `✓ ${label} — saved locally; reopen expurge to continue.`;
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
        ? `${label} — open expurge to continue.`
        : `${label} — saved locally; reopen expurge to continue.`;
      setOverlayState(refs, 'recorded', msg);
    };

    refs.btnHit.addEventListener('click',     () => onVerdict('hit'));
    refs.btnClear.addEventListener('click',   () => onVerdict('clear'));
    refs.btnUnknown.addEventListener('click', () => onVerdict('unknown'));
    refs.btnSkip.addEventListener('click',    () => onVerdict('skipped'));
  }
}

init();
