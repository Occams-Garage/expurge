---
id: Q-016
question: Should challenge state be modeled as content-script-owned structural state (one signal) instead of side-channel expurge_challenge_<tabId> session keys cleared by four disconnected paths?
status: resolved
areas: [matching-overlay, run-model]
asked_date: 2026-07-01
asked_slug: 2026-07-01-sidebar-nav-built
resolution: "Yes — modeled as content-script-owned structural state. All per-tab state (item↔tab map plus the challenge flag) now routes through one owned tab-registry module (src/background/tab-registry.ts), and the content script is the sole authority for the challenge signal via an always-armed MutationObserver that reports both appearance (leading edge) and clearing (debounced). Kept two atomic session-key families rather than one combined record so set/remove stay atomic under the serial-write queue; removeTab drops both keys (and the Stop sweep clears both) so a recycled tab id can't read a stale challenge flag, and the redundant tabs.onUpdated push was dropped. Shipped as PR #6 (refactor/challenge-tab-registry)."
resolution_slug: 2026-07-03-tab-registry-challenge-state
---
