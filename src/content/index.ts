import browser from 'webextension-polyfill';
import type { ChallengeDetectedMsg, ChallengeResolvedMsg } from '../shared/types';
import { detectChallenge } from './classify';

// Headless challenge reporter. The sidebar owns all verdict UI (later slices), so this
// content script has NO UI and never touches the page DOM. Its only job: tell the background
// when a broker page is gated behind a bot-challenge, and when that challenge clears.
// Background identifies the tab via sender.tab.id — this script runs in the broker tab.

// If a challenge is up on load, report it and watch for it clearing. A clean load reports
// nothing (parity with the old overlay, which only challenge-detected on init).
function reportChallenges(): void {
  if (!detectChallenge()) return;

  browser.runtime.sendMessage({ type: 'CHALLENGE_DETECTED' } satisfies ChallengeDetectedMsg).catch(() => {});

  // Watch for the challenge clearing. The 250 ms debounce guards against CAPTCHA widgets
  // (notably Turnstile) briefly detaching their container mid-transition, which would read
  // as "resolved" for an instant. Lifted from the old buildChallengePanel observer.
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

// Idempotency guard: the manifest auto-injects on navigation and (until Slice 5) background
// still re-executeScripts on a missing PING. Without this latch we'd stack MutationObservers
// and emit duplicate CHALLENGE_DETECTED. Mirrors the old __expurgePingBound flag.
const w = window as Window & { __expurgeReporterBound?: boolean };
if (!w.__expurgeReporterBound) {
  w.__expurgeReporterBound = true;
  reportChallenges();
}
