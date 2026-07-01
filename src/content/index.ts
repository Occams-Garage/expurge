import browser from 'webextension-polyfill';
import type { Verdict, ItemInfoMsg } from '../shared/types';
import { detectChallenge, isResultsPage, brokerHostname } from './classify';

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
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wordmark {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
  color: var(--strip-ko);
  line-height: 1;
}

.progress {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--strip-ko);
  opacity: 0.7;
  letter-spacing: 0.05em;
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

// ── shared overlay scaffold ───────────────────────────────────────────────────

interface OverlayShell { host: HTMLElement; panel: HTMLDivElement; }

function createOverlayShell(): OverlayShell {
  const host = document.createElement('div');
  host.id = 'expurge-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;
  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.appendChild(style);
  shadow.appendChild(panel);
  return { host, panel };
}

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

function buildVerdictPanel(
  exposes: string[],
  progress: { done: number; total: number } | null,
): { host: HTMLElement; refs: OverlayRefs } {
  const { host, panel } = createOverlayShell();

  const progressText = progress ? `${progress.done} / ${progress.total}` : '';

  panel.innerHTML = `
    <div class="strip">
      <span class="wordmark">expurge</span>
      <span class="progress" id="strip-progress">${progressText}</span>
    </div>
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
  progress: { done: number; total: number } | null,
  onVerdict: (verdict: Verdict, listingUrl: string) => void,
): HTMLElement {
  const { host, panel } = createOverlayShell();

  const progressText = progress ? `${progress.done} / ${progress.total}` : '';

  panel.innerHTML = `
    <div class="strip">
      <span class="wordmark">expurge</span>
      <span class="progress" id="strip-progress">${progressText}</span>
    </div>
    <div class="body">
      <div class="label">Look for</div>
      <ul class="exposes" id="exp-list"></ul>
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

  // Populate exposes with textContent — same pattern as buildVerdictPanel.
  const exposesList = panel.querySelector('#exp-list')!;
  for (const item of exposes) {
    const li = document.createElement('li');
    li.textContent = item;
    exposesList.appendChild(li);
  }

  const toggleBtn    = panel.querySelector('#toggle-paste')   as HTMLButtonElement;
  const pasteSection = panel.querySelector('#paste-section')  as HTMLElement;
  const pasteInput   = panel.querySelector('#paste-input')    as HTMLInputElement;
  const pasteWarn    = panel.querySelector('#paste-warning')  as HTMLElement;
  const pasteBtns    = panel.querySelector('#paste-btns')     as HTMLElement;
  const statusEl     = panel.querySelector('#overlay-status') as HTMLElement;

  toggleBtn.addEventListener('click', () => {
    pasteSection.style.display = pasteSection.style.display === 'none' ? 'block' : 'none';
    toggleBtn.textContent = pasteSection.style.display === 'none'
      ? 'Can\'t reach the details page? →'
      : 'Can\'t reach the details page? ↓';
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
      const matches =
        parsed.hostname === brokerHostname ||
        parsed.hostname.endsWith('.' + brokerHostname);
      pasteWarn.classList.toggle('visible', !matches);
    } catch {
      pasteWarn.classList.add('visible');
    }
  });

  const castFromPaste = async (verdict: Verdict) => {
    const listingUrl = pasteInput.value.trim();
    pasteBtns.querySelectorAll('button').forEach(b => { (b as HTMLButtonElement).disabled = true; });
    statusEl.className = 'status saving';
    try {
      await onVerdict(verdict, listingUrl);
    } catch {
      statusEl.className = 'status';
      statusEl.textContent = 'Save failed — try again.';
      pasteBtns.querySelectorAll('button').forEach(b => { (b as HTMLButtonElement).disabled = false; });
    }
  };

  panel.querySelector('#btn-hit')!.addEventListener('click',     () => void castFromPaste('hit'));
  panel.querySelector('#btn-clear')!.addEventListener('click',   () => void castFromPaste('clear'));
  panel.querySelector('#btn-unknown')!.addEventListener('click', () => void castFromPaste('unknown'));
  panel.querySelector('#btn-skip')!.addEventListener('click',    () => void castFromPaste('skipped'));

  return host;
}

// ── post-verdict status copy ─────────────────────────────────────────────────

function verdictMsg(verdict: Verdict, ok: boolean): string {
  if (verdict === 'hit') {
    return ok
      ? '✓ Listed — open expurge to send your opt-out request.'
      : '✓ Listed — saved locally; open expurge to send your opt-out request.';
  }
  if (verdict === 'clear')   return '✓ Not listed.';
  if (verdict === 'unknown') return '✓ Not sure — open expurge to continue.';
  return '✓ Skipped.';
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

// Ask the background to close this tab (a content script can't reliably close a
// tab it didn't open). The short delay lets the user read the "✓ recorded" status
// before the tab disappears. The latch makes the close idempotent regardless of
// whether callers disabled their buttons, so rapid actions can't stack timers.
let closingSelf = false;
function closeSelfTab(): void {
  if (closingSelf) return;
  closingSelf = true;
  setTimeout(() => {
    browser.runtime.sendMessage({ type: 'CLOSE_TAB' }).catch(() => {});
  }, 800);
}

// ── PING handler (background → content) ─────────────────────────────────────
// Guarded by a window flag so each executeScript reinject doesn't stack another
// listener — all would respond identically but they accumulate across reinjections.

const w = window as Window & { __expurgePingBound?: boolean };
if (!w.__expurgePingBound) {
  w.__expurgePingBound = true;
  browser.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (m.type === 'PING') {
      return Promise.resolve({
        type: 'PONG',
        hasOverlay: !!document.getElementById('expurge-host'),
      });
    }
    return undefined;
  });
}

// ── challenge panel ──────────────────────────────────────────────────────────

function buildChallengePanel(info: ItemInfoMsg, onResolved: () => void): void {
  const { host, panel } = createOverlayShell();

  const progressText = `${info.progress.done} / ${info.progress.total}`;
  panel.innerHTML = `
    <div class="strip">
      <span class="wordmark">expurge</span>
      <span class="progress" id="strip-progress">${progressText}</span>
    </div>
    <div class="body">
      <div class="label">Security check</div>
      <p class="question">This site is running a security check. Complete it, then expurge will show your results.</p>
      <div class="buttons">
        <button class="btn btn-skip" style="grid-column:1/-1" id="btn-challenge-skip">Skip this site</button>
      </div>
      <div class="status" id="overlay-status"></div>
    </div>
  `;

  document.documentElement.appendChild(host);

  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (detectChallenge()) {
      if (dismissTimer !== null) { clearTimeout(dismissTimer); dismissTimer = null; }
      return;
    }
    if (dismissTimer !== null) return;
    // Wait 250 ms before acting — CAPTCHA libraries sometimes briefly detach their container
    // during internal state transitions, which would trigger a false positive immediately.
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (!detectChallenge()) {
        observer.disconnect();
        host.remove();
        onResolved();
      }
    }, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const skipBtn  = panel.querySelector('#btn-challenge-skip') as HTMLButtonElement;
  const statusEl = panel.querySelector('#overlay-status')    as HTMLElement;

  skipBtn.addEventListener('click', async () => {
    if (dismissTimer !== null) { clearTimeout(dismissTimer); dismissTimer = null; }
    observer.disconnect();
    skipBtn.disabled     = true;
    statusEl.className   = 'status saving';
    statusEl.textContent = 'Skipping…';
    const ok = await sendVerdict(info.itemId, 'skipped', '');
    if (ok) {
      statusEl.className   = 'status recorded';
      statusEl.textContent = '✓ Skipped.';
      closeSelfTab();
    } else {
      statusEl.className   = 'status';
      statusEl.textContent = 'Save failed — try again.';
      skipBtn.disabled     = false;
    }
  });
}

// ── main panel (verdict or guidance) ────────────────────────────────────────

function showMainPanel(info: ItemInfoMsg): void {
  const { itemId, exposes, renderedUrl, progress } = info;

  const onResults = isResultsPage(window.location.href, renderedUrl);
  const hostname = brokerHostname(renderedUrl);

  if (onResults) {
    const onVerdict = async (verdict: Verdict, listingUrl: string) => {
      const host     = document.getElementById('expurge-host')!;
      const shadow   = host.shadowRoot!;
      const statusEl = shadow.querySelector('#overlay-status') as HTMLElement;
      const ok  = await sendVerdict(itemId, verdict, listingUrl);
      statusEl.className   = 'status recorded';
      statusEl.textContent = verdictMsg(verdict, ok);
      if (ok) closeSelfTab();
    };

    const host = buildGuidancePanel(exposes, hostname, progress, onVerdict);
    document.documentElement.appendChild(host);
  } else {
    const { host, refs } = buildVerdictPanel(exposes, progress);
    document.documentElement.appendChild(host);

    const onVerdict = async (verdict: Verdict) => {
      setOverlayState(refs, 'saving');
      const ok = await sendVerdict(itemId, verdict, window.location.href);
      setOverlayState(refs, 'recorded', verdictMsg(verdict, ok));
      if (ok) closeSelfTab();
    };

    refs.btnHit.addEventListener('click',     () => onVerdict('hit'));
    refs.btnClear.addEventListener('click',   () => onVerdict('clear'));
    refs.btnUnknown.addEventListener('click', () => onVerdict('unknown'));
    refs.btnSkip.addEventListener('click',    () => onVerdict('skipped'));
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  if (document.getElementById('expurge-host')) return;

  let info: ItemInfoMsg | null = null;
  try {
    info = await browser.runtime.sendMessage({ type: 'GET_ITEM' }) as ItemInfoMsg | null;
  } catch {
    return;
  }

  if (!info) return;

  // Re-check after the async yield — another concurrent injection may have already appended.
  if (document.getElementById('expurge-host')) return;

  const itemInfo = info;

  if (detectChallenge()) {
    buildChallengePanel(itemInfo, () => showMainPanel(itemInfo));
  } else {
    showMainPanel(itemInfo);
  }
}

init();
