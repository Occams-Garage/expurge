---
date: 2026-06-29
title: "Cloudflare challenge handling and Restore Overlay"
areas: [matching-overlay, run-model]
topics: [webextensions, ux]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Four related bugs around Cloudflare challenge pages were diagnosed and fixed in one session. "Restore Overlay" was opening a fresh tab (triggering a new Cloudflare session instead of reusing the existing one); the Turnstile widget's persistent DOM node was permanently blocking the challenge→main panel transition; navigation errors on CDN validation paths were falsely marking items as skipped; and `tabs.onUpdated` was attempting overlay injection on off-host challenge domains. All four were addressed in `b800797`.

## Decisions / outcomes
- **Fallback tab pattern** (`findActiveBrokerTab`): mid-redirect tabs (hostname mismatch) are saved as a fallback rather than pruned. "Restore Overlay" now focuses the existing challenged tab instead of opening a new Cloudflare session.
- **Two-group `detectChallenge()`**: interstitial CF selectors always block; `.cf-turnstile` blocks only while `input[name="cf-turnstile-response"]` has no value. Solved Turnstile no longer prevents `onResolved()` from firing.
- **Remove `webNavigation.onErrorOccurred`**: handler deleted entirely; `webNavigation` removed from manifest permissions. Tab close (`tabs.onRemoved`) is now the sole skip signal for navigation failures.
- **Hostname guard on `tabs.onUpdated`**: skip reinject when the tab's current host doesn't match the broker's host (e.g. `challenges.cloudflare.com` during interstitial redirects).
- **Captcha reload loop**: diagnosed as Cloudflare session rate-limiting from repeated failed challenge attempts — not caused by the extension. Cleared by purging the broker's cookies.

## Why
**Turnstile**: `.cf-turnstile` persists in the DOM after solving (only the iframe content changes); the old flat selector list could never reach `onResolved()` for inline Turnstile. The response token value is the only reliable in-page "solved" signal without waiting for a page reload.

**`webNavigation` removal**: CDN validation paths (`broker.com/cdn-cgi/l/chk_jschl`) share the broker's hostname, so any hostname-based filter inside the error handler cannot distinguish them from genuine load failures. Removing the handler is cleaner — tab-close is unambiguous user intent, and the no-wedge rule means unverdicted items don't stall the run regardless.

**Fallback tab**: Cloudflare challenge sessions are scoped to a browser tab. Opening a new tab resets the session and forces the user to solve the challenge again. Preserving the existing tab (even while mid-redirect) keeps the session alive.

## Alternatives considered
- Hostname filter inside `webNavigation.onErrorOccurred` to skip CDN paths: rejected because CDN paths share the broker's hostname — indistinguishable from real pages.
- MutationObserver watching for `.cf-turnstile` removal: rejected because Turnstile leaves the container element in the DOM after solving.
- Auto-skip on genuine initial load failures: user preferred deferring to manual skip (tab close) rather than auto-skipping on navigation errors.

## Open questions / follow-ups
- `manifest.json` `content_scripts` entry auto-injects on `*://*.truepeoplesearch.com/*`, including CDN/validation paths. The `tabs.onUpdated` hostname guard doesn't cover this auto-inject vector. Assess whether to narrow or remove the `content_scripts` entry when the broker list expands.
