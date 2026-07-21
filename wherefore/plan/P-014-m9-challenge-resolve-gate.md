---
id: P-014
title: M9 per-broker challenge-resolve gate (onboarding checklist)
status: todo
created: 2026-07-19
area: matching-overlay
topics: [testing, webextensions]
milestone: M9
decision_ref: 2026-06-29-cloudflare-challenge-handling, 2026-07-03-tab-registry-challenge-state
---

Resolve-safety of the challenge detector is proven on TPS only (n=1). `detectChallenge()`'s
Turnstile-script signal assumes the gate navigates away on solve (like TPS
`/InternalCaptcha`). A broker that resolves inline (results swap in place, URL unchanged,
the `challenges.cloudflare.com/turnstile` script persists) would strand the challenge
view over real results, forcing a Skip and a missed hit. This is the onboarding gate each
new broker in [[P-012-m9-populate-verified-brokers]] must pass. The human-in-the-loop +
Skip is the recoverable backstop (see memory: scope-defer-to-human). Source:
`plan/expurge-progress.md` -> M9, `src/content/classify.ts` TODO.

- [ ] For each new broker, confirm its bot-gate navigates away on solve, or classify it as inline-resolving
- [ ] For inline-resolving brokers, add a resolve signal (URL-path check or solved-token) or an option-2 per-broker `challenge` hint
- [ ] Add a challenge fixture per broker to `classify.test.ts` (interstitial + inline-resolve cases)
- [ ] Fold the check into the broker-onboarding checklist so no broker is enabled without it
