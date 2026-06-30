import browser from 'webextension-polyfill';
import type { RunState } from '../shared/types';

function openDashboard(): void {
  browser.runtime.openOptionsPage().catch(console.error);
}

async function init(): Promise<void> {
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' }) as { run?: RunState };
  const run = res.run ?? null;

  if (!run) {
    document.getElementById('popup-no-run')!.classList.remove('hidden');
    return;
  }

  const checkable = run.items.filter(
    i => !(typeof i.skipReason === 'string' && i.skipReason.startsWith('missing:'))
  );
  const done  = checkable.filter(i => i.status === 'verdicted').length;
  const total = checkable.length;
  const hits  = run.items.filter(i => i.verdict === 'hit').length;
  const allDone = run.items.every(i => i.status === 'verdicted');

  if (allDone) {
    document.getElementById('popup-done')!.classList.remove('hidden');
    document.getElementById('popup-done-summary')!.textContent = hits > 0
      ? `Found on ${hits} site${hits !== 1 ? 's' : ''}. ${done} checked.`
      : `Checked ${done} site${done !== 1 ? 's' : ''} — no matches.`;
  } else {
    document.getElementById('popup-active')!.classList.remove('hidden');
    document.getElementById('popup-progress')!.textContent =
      `${done} / ${total} checked${hits > 0 ? ` · ${hits} found` : ''}`;
  }
}

document.getElementById('btn-open-dashboard')!.addEventListener('click', openDashboard);
document.getElementById('btn-open-dashboard-active')!.addEventListener('click', openDashboard);
document.getElementById('btn-open-dashboard-done')!.addEventListener('click', openDashboard);

document.getElementById('btn-restore-overlay')!.addEventListener('click', async () => {
  const btn = document.getElementById('btn-restore-overlay') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const res = await browser.runtime.sendMessage({ type: 'REINJECT_OVERLAY' }) as { ok?: boolean };
    if (!res?.ok) {
      btn.textContent = 'Nothing to restore';
      setTimeout(() => { btn.textContent = 'Restore overlay'; btn.disabled = false; }, 2000);
    } else {
      btn.disabled = false;
    }
  } catch {
    btn.disabled = false;
  }
});

document.getElementById('btn-stop-run')!.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'STOP_RUN' });
  window.close();
});

init().catch(console.error);
