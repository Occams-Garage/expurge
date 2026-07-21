---
id: P-007
title: M9 CCPA template + DROP registry legal verify (pre-launch)
status: todo
created: 2026-07-19
area: opt-out-drafts
topics: [verification, privacy]
milestone: M9
answers: Q-010
---

Spike: a pre-launch legal verification, not a build task. The two email template bodies
(`src/shared/templates.ts`) are marked `// TODO Q-010` and must not ship without review.
This item is the work of answering Q-010; the checkboxes are the questions to settle, and
it ends by capturing a decision (or raising new questions). Source:
`plan/expurge-plan.md` §12, `plan/expurge-progress.md` open questions.

- [ ] Does the CA CCPA template body match current statute language? What exact wording is required?
- [ ] Does the US general opt-out template body hold up for the non-CA states in scope?
- [ ] Which of the ~25 sites in [[P-004-m9-populate-verified-brokers]] overlap the public California DROP registry, and how does the DROP informational notice need to describe that overlap?
- [ ] Is the auto-select-by-`state` behavior (US general vs CA CCPA + DROP notice) correct for the verified language?
- [ ] Capture the outcome as a decision and resolve Q-010; if unknowns remain, raise them via `ask`
