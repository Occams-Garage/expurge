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

function buildOverlay(exposes: string[]): { host: HTMLElement; refs: OverlayRefs } {
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

// ── verdict send + ack with retry ────────────────────────────────────────────

async function sendVerdict(
  itemId: string,
  verdict: Verdict,
  attempt = 0,
): Promise<boolean> {
  const TIMEOUT_MS = 6_000;
  const MAX_ATTEMPTS = 3;

  try {
    const race = await Promise.race([
      browser.runtime.sendMessage({ type: 'VERDICT', itemId, verdict }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)
      ),
    ]);
    return (race as { type?: string })?.type === 'ACK';
  } catch {
    if (attempt < MAX_ATTEMPTS - 1) {
      return sendVerdict(itemId, verdict, attempt + 1);
    }
    return false;
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Ask the background which work item this tab belongs to.
  let info: ItemInfoMsg | null = null;
  try {
    info = await browser.runtime.sendMessage({ type: 'GET_ITEM' }) as ItemInfoMsg | null;
  } catch {
    // Extension not reachable (e.g., disabled mid-load) — do nothing.
    return;
  }

  if (!info) return;  // not a run tab

  const { itemId, exposes } = info;
  const { host, refs } = buildOverlay(exposes);
  document.documentElement.appendChild(host);

  const onVerdict = async (verdict: Verdict) => {
    setOverlayState(refs, 'saving');
    const ok = await sendVerdict(itemId, verdict);
    const label =
      verdict === 'hit'     ? 'Listed'    :
      verdict === 'clear'   ? 'Not Listed':
      verdict === 'unknown' ? 'Not Sure'  :
      'Skipped';
    setOverlayState(refs, 'recorded', ok ? label : `${label} (retry failed — please reopen)`);
  };

  refs.btnHit.addEventListener('click',     () => onVerdict('hit'));
  refs.btnClear.addEventListener('click',   () => onVerdict('clear'));
  refs.btnUnknown.addEventListener('click', () => onVerdict('unknown'));
  refs.btnSkip.addEventListener('click',    () => onVerdict('skipped'));
}

init();
