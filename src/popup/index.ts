import browser from 'webextension-polyfill';
import type { RunState } from '../shared/types';
import { progressOf, isComplete } from '../background/coordinator';

function openDashboard(): void {
  browser.runtime.openOptionsPage().catch(console.error);
}

// Re-open a closed sidebar. Must run synchronously in the click gesture; opens in the active
// window, which then SIDEBAR_GET_STATEs (shows the run if this is the run's window, else no-run).
function showSidebar(): void {
  browser.sidebarAction.open().catch(() => {});
}

async function init(): Promise<void> {
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' }) as { run?: RunState };
  const run = res.run ?? null;

  if (!run) {
    document.getElementById('popup-no-run')!.classList.remove('hidden');
    return;
  }

  const { done, total, hits } = progressOf(run);

  if (isComplete(run)) {
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

document.getElementById('btn-show-sidebar-active')!.addEventListener('click', showSidebar);
document.getElementById('btn-show-sidebar-done')!.addEventListener('click', showSidebar);

document.getElementById('btn-stop-run')!.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'STOP_RUN' });
  window.close();
});

init().catch(console.error);
