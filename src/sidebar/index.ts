import browser from 'webextension-polyfill';
import type { RunState, SidebarView, SidebarUpdateMsg } from '../shared/types';
import { progressOf } from '../background/coordinator';

// The sidebar is a thin render layer over the view background derives (deriveView) — it never
// re-derives. Init order matters (Slice-5 review): attach the push listener FIRST, then resolve
// our windowId, then PULL the current view — so a push that lands between them isn't missed.

let windowId: number | undefined;

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as Partial<SidebarUpdateMsg>;
  if (m?.type !== 'SIDEBAR_UPDATE') return;
  // Ignore updates for other windows — runtime.sendMessage broadcasts to every open sidebar.
  if (windowId === undefined || m.windowId !== windowId) return;
  renderView(m.view!);
});

async function init(): Promise<void> {
  const win = await browser.windows.getCurrent();
  windowId = win.id;
  const res = await browser.runtime.sendMessage({ type: 'SIDEBAR_GET_STATE', windowId }) as SidebarUpdateMsg;
  renderView(res.view);
}

function renderView(view: SidebarView): void {
  document.getElementById('detail')!.textContent = view.view;
  void refreshProgress();
}

async function refreshProgress(): Promise<void> {
  const res = await browser.runtime.sendMessage({ type: 'GET_RUN_STATE' }) as { run?: RunState };
  const run = res.run ?? null;
  const p = document.getElementById('progress')!;
  if (!run) { p.textContent = ''; return; }
  const { done, total, hits } = progressOf(run);
  p.textContent = `${done} / ${total} checked${hits > 0 ? ` · ${hits} found` : ''}`;
}

init().catch(() => {});
