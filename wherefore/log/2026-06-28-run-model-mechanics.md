---
date: 2026-06-28
title: "Run model mechanics and execution contract"
areas: [run-model, coverage-report]
topics: [webextensions, data-model]
stories: []
status: superseded
supersedes:
superseded_by: 2026-06-28-persistence-inversion
superseded_date: 2026-06-28
---

SUPERSEDED 2026-06-28 -> see 2026-06-28-persistence-inversion. "Resumable across sessions for free" is now wrong: spindown is always survived, but cross-session resume requires the profile-storage opt-in. Kept for history, not current.

## Summary
Run state lives in browser.storage.local as a first-class persisted object; the background script is a stateless coordinator that rehydrates from storage on every event. The no-wedge rule guarantees runs never stall. Messaging uses storage as source of truth with explicit acks and idempotent writes. End-of-run skip surfacing offers tailored one-click remedies per skip reason. See also: 2026-06-28-run-model-storage-coverage (high-level decisions); this entry covers the detailed execution contract.

## Decisions / outcomes
- Run state in storage: background script rehydrates from browser.storage.local on every event. Required because MV3 event pages can spin down mid-run. Crash-resilient and session-resumable for free.
- Unit of work: run iterates over (broker × name-variant) items. Each item carries: status (pending / open / verdicted / errored), rendered URL, tab ID when open, verdict.
- Tab-opening pacing: paced-automatic with a one-batch ceiling. Next batch never opens until current batch is fully cleared. At most one batch open at any time.
- Run controls: persistent UI shows progress; pause (stop opening new tabs, keep open ones, stays resumable) and stop (end run, offer to close open tabs).
- No-wedge rule: an item is cleared by verdict OR skip OR park (error/challenge). Nothing can permanently stall a run.
- Verdict messaging contract: storage is the source of truth; messages propose, acks confirm, writes are idempotent (keyed by item ID). Content script sends verdict → waits for ack → shows "saving" then "recorded." No ack within timeout → safe retry. Overlay states: unjudged / saving / recorded.
- Tab closed without verdict: background watches `tabs.onRemoved`; counts as skipped with reason `tab_closed`. Valid fast dismissal under the no-wedge rule.
- Skip surfacing at run end: skips grouped by reason, each with a tailored one-click remedy framed as "what's left to finish." `tab_closed` → reopen-these mini-run; `challenge` → reopen-and-solve; `load_error` → reopen-to-retry (repeated failures hint at broken record). "Reopen skipped" seeds a new run from the prior run's skipped subset. Headline coverage stays in broker-units.

## Why
Run state in storage (not memory) is the MV3 constraint: the event page can vanish mid-run without warning. Making the background stateless means every state transition is a storage write; losing the process loses nothing. The no-wedge rule prevents silent stalls on captchas or closed tabs. Idempotent acks make the messaging contract safe under retry without coordination overhead. Skip-surfacing framed as "what's left" discourages nothing: surfacing skips as failure would deter users from partial runs, which are legitimate.

## Alternatives considered
- Run state in memory: rejected. MV3 event page lifespan is unpredictable; in-memory state is lost on spin-down.

## Open questions / follow-ups
- Q-007: How does a generated .eml actually reach the user's mail client from inside Firefox? (downloads API vs mailto: vs other; send-it-yourself UX needs to be designed.) Identified as the next branch to interview.
