---
date: 2026-06-28
title: "Page classification: shallow-first, human matcher"
areas: [matching-overlay, broker-dataset]
topics: [data-model]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
v1 uses no per-site DOM selectors: the human is the matcher. The content script auto-classifies only two cross-site signals (challenge pages and load failures); every other loaded page gets an overlay telling the human what to look for from the broker's `exposes[]`. This collapses the friendly/hostile tier distinction entirely — every broker is just a tab the human can see. A reserved schema block holds extraction hints for optional future enrichment on high-value sites only. This reverses the earlier plan-doc claim that the matcher would pre-fill hostile-site overlays in v1. See also: 2026-06-28-run-model-storage-coverage.

## Decisions / outcomes
- **No per-site DOM selectors in v1.** Per-site selectors are too brittle and would turn broker-list verification into selector maintenance.
- **Auto-classified cross-site signals (content script only):**
  - Challenge pages (Cloudflare / Turnstile / hCaptcha / reCAPTCHA / DataDome) via shared signals. MutationObserver triggers overlay once human solves; unsolved → skip reason `challenge`.
  - Load failures via `webNavigation.onErrorOccurred` → skip reason `load_error`.
- **All other pages**: overlay tells the human what to look for from broker's `exposes[]`, then hit / clear / skip. No auto "no results" detection.
- Friendly/hostile tier distinction **eliminated**: all brokers are treated identically.
- **Reserved enrichment block**: schema reserves a per-broker extraction-hint block. When present and verified, content script may pre-extract fields and show a confidence score. Optional; added only to a few high-value sites in future; never blocks a broker from being checked.

## Why
Per-site DOM selectors look like a shortcut but become a maintenance liability: every broker redesign breaks them, redirecting effort from coverage to selector upkeep. The human-as-matcher model makes the tool resilient to site redesigns by design. Challenge-page and load-error detection are worth the cross-site automation cost because they are unambiguously machine-detectable signals with no matching judgment involved. The reserved enrichment block preserves optionality for later automation without any v1 commitments that would constrain the data model.

## Alternatives considered
- Per-site DOM selectors for field extraction: rejected — too brittle; turns every broker site redesign into a maintenance event.
- Auto "no results" detection: rejected — cross-site signals are too inconsistent; human confirmation is more reliable.

## Open questions / follow-ups
- v2 local-LLM extraction as the successor to shallow-first (privacy preserved if model stays local) tracked as Q-003. Hard constraint: any automation must preserve human-navigates property — an unattended agent reopens the bot-detection wall.
