---
date: 2026-06-29
title: "Local LLM for opt-out form field discovery"
areas: [matching-overlay, opt-out-drafts]
topics: [webextensions, privacy, local-llm]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Discussed using a local LLM (Ollama) to identify opt-out form fields dynamically in v2, eliminating the need for per-broker CSS selector mappings in `brokers.json`. The approach is technically plausible and privacy-preserving. Key open questions are localhost CORS (Q-003) and user setup friction.

## Decisions / outcomes
- Planned approach for v2 investigation: content script captures form HTML structure only (labels, input names, placeholders — no user data), POSTs to `http://localhost:11434`, LLM returns JSON field mappings (`{"first_name": "#fname", ...}`), content script fills using those selectors.
- PII never enters the LLM prompt: the LLM sees form structure only; user data enters the DOM only at fill time. This separates the LLM call from the DOM-injection constraint.
- Q-003 scope broadened: originally about LLM-based page-content extraction; now also covers field-discovery for form-fill. The same localhost/CORS question governs both.
- v2 shape: LLM discovers and fills fields, user clicks Submit — mirrors the pre-fill assist decision (see `2026-06-29-autofill-optout-forms`).

## Why
Static selector mappings in `brokers.json` are brittle (sites redesign without notice) and require ongoing maintenance per broker. An LLM that reads form structure semantically is resilient to redesigns and doesn't require per-site curation. Keeping PII out of the LLM call preserves the privacy model — the LLM is doing structural reasoning, not data handling.

## Alternatives considered
- Static per-broker CSS selector mappings: simpler, no Ollama dependency, but high maintenance burden and breaks silently on site redesigns.
- Cloud LLM for field discovery: rejected — would require sending form HTML (potentially containing user-identifying context) off-device. Contradicts local-first design.

## Open questions / follow-ups
- Q-003: Can `moz-extension://` reach `http://localhost:11434`? Does Ollama need CORS configuration to whitelist extension origins? Does the `http://localhost/*` optional permission suffice?
- Setup friction: Ollama must be installed and a model running. What's the fallback if it's absent? (static mappings? skip LLM fill?)
- Which model size gives reliable JSON output for form-structure prompts on typical consumer hardware?
- CAPTCHAs and multi-step flows are still unsolved regardless of field-discovery method.