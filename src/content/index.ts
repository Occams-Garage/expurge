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
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const report = (challenged: boolean): void => {
    if (challenged === lastReported) return; // only send on a real transition
    lastReported = challenged;
    const msg = challenged
      ? ({ type: 'CHALLENGE_DETECTED' } satisfies ChallengeDetectedMsg)
      : ({ type: 'CHALLENGE_RESOLVED' } satisfies ChallengeResolvedMsg);
    browser.runtime.sendMessage(msg).catch(() => {});
  };

  // Load-time report, synchronous, either direction.
  report(detectChallenge());

  // Persistent, always-armed observer — NEVER disconnects, so a challenge is caught whether it
  // appears or clears in place. The 250 ms debounce coalesces mutation bursts and rides out a
  // CAPTCHA widget briefly detaching its container mid-transition (a transient that re-settles
  // within the window nets no state change → deduped, nothing sent).
  const observer = new MutationObserver(() => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      report(detectChallenge());
    }, 250);
  });
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
