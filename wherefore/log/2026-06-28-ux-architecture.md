---
date: 2026-06-28
title: "UX architecture: popup as control panel, options page as primary UI"
areas: [run-model, profile, coverage-report, opt-out-drafts]
topics: [webextensions, ux]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The popup (toolbar icon click) is a compact run control panel, not the primary UI. The Firefox options page — opened as a full browser tab via `options_ui.open_in_tab: true` — is the primary UI and hosts all persistent navigation. Four sections: Run, Results, Profile, Settings. `browser.runtime.onInstalled` opens the options page on first install. The current M0–M3 popup (which contained the profile form and draft surfaces) is the prototype scaffolding; those surfaces migrate to the options page in M4+.

## Decisions / outcomes

### Popup (toolbar click)
- Compact, no persistent nav.
- Shows: current run status summary (progress indicator, hit count badge), pause/resume button, "Open full dashboard →" link to the options page.
- Pre-run: "No active run" + "Open dashboard →" — does not duplicate the profile form.
- The popup does not host the profile form, results, draft surfaces, or settings.

### Options page
- `options_ui.open_in_tab: true` — opens as a dedicated browser tab, not an about:addons panel. Required for the persistent-nav layout.
- `browser.runtime.onInstalled` handler calls `browser.runtime.openOptionsPage()` on first install — new users land directly on the options page (specifically the Run section, which shows the welcome/pitch state before any profile exists).
- Four nav sections with a persistent top nav:
  - **Run**: run control and live monitor (see 2026-06-28-run-section-states)
  - **Results**: post-run findings browser (see 2026-06-28-results-section)
  - **Profile**: identity fields, AKA management, first-fetch consent prompt
  - **Settings**: four sub-sections — Storage, Preferences, Broker list, Your data

### Settings sub-sections
- **Storage**: the three persistence opt-in toggles (see 2026-06-28-persistence-inversion). Each toggle shows its privacy boundary inline (what is stored, where, for how long). Contextual first-exposure banners appear in the relevant section where the benefit is concrete (Run done, Results, Profile); Settings is the permanent home.
- **Preferences**: preferred send method (mailto / .eml / copy-paste), radio buttons, default: mailto.
- **Broker list**: list of known brokers, their status (active/broken/disabled), last-checked date, opt-out channel trust state. Manual "Check for updates" button. Auto-update toggle and schedule indicator (see 2026-06-28-first-fetch-consent).
- **Your data**: export button (JSON, no draft bodies), delete-all button with inline single-confirmation panel (not a modal), import button.

### AKA profile fields
- The Profile section shows all profile fields at once (not progressive disclosure within the form).
- AKA entries have: first, last, middle (optional). Not name_full — atomic fields for correct template substitution.
- Enrichment fields (zip, age, emails, phones, relatives, AKAs) are visible but optional; the no-nag rule from 2026-06-28-profile-intake-ux applies — the form shows what's available without pushing.

## Why
The popup toolbar click is a habitual quick-access gesture for extensions; it suits a run-control widget (pause/resume, quick status check) but is too small and too transient for a persistent-nav app. The options page as a full browser tab supports the level of structure the dashboard requires (four sections, sortable results, form fields, settings sub-sections). `open_in_tab: true` is the correct Firefox mechanism for this: the options page behaves like a web app, not a preferences panel. onInstalled → openOptionsPage ensures new users see the pitch and profile form without needing to discover the options page themselves.

## Alternatives considered
- Popup as primary UI: rejected — too narrow, no persistent navigation, transient lifecycle.
- Sidebar: provides persistence but conflicts with existing extension sidebars and is harder to navigate to.
- options_ui without open_in_tab: about:addons panel is too cramped and sandboxed from the full tab experience.

## Open questions / follow-ups
- None.
