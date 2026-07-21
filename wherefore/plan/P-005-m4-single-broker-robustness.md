---
id: P-005
title: "M4: single-broker robustness"
status: done
created: 2026-06-29
updated: 2026-06-29
area: run-model
topics: [webextensions]
milestone: M4
decision_ref: 2026-06-29-cloudflare-challenge-handling, 2026-06-30-stop-only-run-control, 2026-06-28-run-model-mechanics
---

Retroactive record of a shipped milestone: made a single-broker run un-wedgeable.
Source: `plan/expurge-progress.md` (M4). Complete.

- [x] Challenge detection: selectors covering Cloudflare / Turnstile / hCaptcha / reCAPTCHA / DataDome; MutationObserver auto-transitions to the verdict panel on solve
- [x] Stop control: STOP_RUN marks all open + pending items as `run_stopped`; stop button hidden on completion
- [x] No-wedge verified across all three clearing paths (verdict, skip, tab-closed all call `openNextBatch`)
- [x] Restore-overlay path: `findActiveBrokerTab()` walks session keys to the live broker tab, else opens the next pending item
