import browser from 'webextension-polyfill';
import type { ChallengeDetectedMsg, ChallengeResolvedMsg } from '../shared/types';
import { detectChallenge } from './classify';

// Headless challenge reporter. The sidebar owns all verdict UI (later slices), so this
// content script has NO UI and never touches the page DOM. Its only job: report whether the
// broker page is gated behind a bot-challenge. Background identifies the tab via sender.tab.id
// — this script runs in the broker tab.

// Report the page's challenge state — on load AND on any in-place change thereafter. The
// content script is the single per-tab owner of the challenge signal; background only stores
// what it's told and drops it when the tab closes. Only TRANSITIONS are sent (deduped against
// the last thing reported), in BOTH directions:
//   - an on-host Cloudflare interstitial loads → DETECTED; its redirect to the real page is a
//     fresh load that reports RESOLVED.
//   - a challenge that APPEARS after a clean load — a mid-run rate-limit re-gate that swaps the
//     page in place, no navigation → DETECTED, so verdict buttons never render over a live gate.
//   - a challenge SOLVED inline (Turnstile, no navigation) → RESOLVED.
function reportChallenges(): void {
  let lastReported: boolean | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (challenged: boolean): void => {
    if (challenged === lastReported) return; // only send on a real transition
    lastReported = challenged;
    const msg = challenged
      ? ({ type: 'CHALLENGE_DETECTED' } satisfies ChallengeDetectedMsg)
      : ({ type: 'CHALLENGE_RESOLVED' } satisfies ChallengeResolvedMsg);
    browser.runtime.sendMessage(msg).catch(() => {});
  };

  // Load-time report, synchronous, either direction — a fresh load has no mid-transition to
  // ride out, so report it immediately.
  send(detectChallenge());

  // On each mutation, evaluate the current state. The two directions are handled asymmetrically
  // on purpose:
  //   - APPEARS (→ DETECTED): reported on the LEADING edge, immediately. A gate must never sit
  //     un-reported while the sidebar shows verdict buttons, and detecting one a beat early is
  //     harmless. This is never debounced, so sustained DOM churn can't delay or starve it.
  //   - CLEARS (→ RESOLVED): confirmed after a 250 ms settle so a CAPTCHA widget briefly
  //     detaching its container mid-transition can't read as a false clear. The timer is armed
  //     ONCE per clear and NOT reset on later mutations (unlike a trailing debounce, which a
  //     mutating page would perpetually reset and never fire) — so a busy page can't starve it.
  const evaluate = (): void => {
    if (detectChallenge()) {
      if (clearTimer !== null) { clearTimeout(clearTimer); clearTimer = null; }
      send(true);
      return;
    }
    if (lastReported === false || clearTimer !== null) return; // already clear / clear pending
    clearTimer = setTimeout(() => {
      clearTimer = null;
      if (!detectChallenge()) send(false);
    }, 250);
  };

  // Persistent, always-armed observer — NEVER disconnects, so a challenge is caught whether it
  // appears or clears in place.
  const observer = new MutationObserver(evaluate);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

// Idempotency guard: the manifest auto-injects the content script on every navigation. Without
// this latch a re-injection would stack a second MutationObserver. Mirrors the old
// __expurgePingBound flag.
const w = window as Window & { __expurgeReporterBound?: boolean };
if (!w.__expurgeReporterBound) {
  w.__expurgeReporterBound = true;
  reportChallenges();
}
