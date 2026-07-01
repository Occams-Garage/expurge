import browser from 'webextension-polyfill';
import type { ChallengeDetectedMsg, ChallengeResolvedMsg } from '../shared/types';
import { detectChallenge } from './classify';

// Headless challenge reporter. The sidebar owns all verdict UI (later slices), so this
// content script has NO UI and never touches the page DOM. Its only job: report whether the
// broker page is gated behind a bot-challenge. Background identifies the tab via sender.tab.id
// — this script runs in the broker tab.

// Report the page's challenge state on EVERY load, either way — the content script is the
// single per-load source of truth (background no longer guesses challenge state from
// navigation). An on-host Cloudflare interstitial reports DETECTED and stays challenged;
// the redirect to the real page is a fresh load that reports RESOLVED and clears the flag.
// (Out of scope: a challenge APPEARING after a clean load without a navigation — e.g. a
// mid-run rate-limit that swaps the page in place. The load-time report wouldn't catch it.)
function reportChallenges(): void {
  if (!detectChallenge()) {
    browser.runtime.sendMessage({ type: 'CHALLENGE_RESOLVED' } satisfies ChallengeResolvedMsg).catch(() => {});
    return;
  }

  browser.runtime.sendMessage({ type: 'CHALLENGE_DETECTED' } satisfies ChallengeDetectedMsg).catch(() => {});

  // Also watch for an IN-PAGE clear (e.g. Turnstile solved inline, no navigation). The 250 ms
  // debounce guards against CAPTCHA widgets briefly detaching their container mid-transition,
  // which would read as "resolved" for an instant. Lifted from the old buildChallengePanel.
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (detectChallenge()) {
      if (dismissTimer !== null) { clearTimeout(dismissTimer); dismissTimer = null; }
      return;
    }
    if (dismissTimer !== null) return;
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (!detectChallenge()) {
        observer.disconnect();
        browser.runtime.sendMessage({ type: 'CHALLENGE_RESOLVED' } satisfies ChallengeResolvedMsg).catch(() => {});
      }
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
