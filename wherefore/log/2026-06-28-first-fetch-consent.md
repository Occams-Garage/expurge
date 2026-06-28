---
date: 2026-06-28
title: "First-fetch consent: in Profile section at setup, weekly auto-cadence"
areas: [broker-dataset, profile]
topics: [dataset-distribution, ux, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The first-fetch consent prompt for remote dataset updates appears in the Profile section during initial profile setup — not in the Run done state. This ensures users can fetch an updated broker list before their first run rather than after it. Weekly cadence is confirmed for the auto-update schedule (lazy-triggered). After runs where auto-update is disabled, a single quiet non-annoying notice appears in the Run done state. Amends 2026-06-28-dataset-update-preference (which left placement and cadence open). See also: Q-006 (consent-prompt copy still open).

## Decisions / outcomes

### Placement of first-fetch consent prompt
- Shown in the **Profile section**, after the form fields and before the save / "ready to run" CTA.
- Context: user has just filled in their profile and is about to start their first run. The prompt appears here so they have the option to fetch fresh broker data before that first run — not after.
- Prompt sets the update preference (manual or auto) and discloses that the request carries no user data. This is also the user's first exposure to the auto-update toggle they'll find later in Settings → Broker list.
- The prompt appears only once at first setup. After that, the preference is set and lives in Settings → Broker list.

### Weekly auto-cadence
- When auto-update is enabled: fetch runs at most once per week.
- The fetch is **lazy-triggered**: it does not run on a cron schedule. Instead, it runs when the user opens the options page and the elapsed time since the last fetch exceeds 7 days.
- No background fetch. No wake-on-schedule. The fetch only happens in an active session, initiated by the user opening the dashboard.
- Rationale: avoids the network-contact-without-user-presence pattern. The user is present and the fetch is triggered by their action (opening the dashboard).

### After-run notice (auto-update disabled)
- If auto-update is disabled and the broker list is more than 30 days old, the Run done state shows a **single quiet line**: "Broker list is N days old. Enable auto-updates in Settings →" or "Update manually in Settings →."
- Not a banner, not a modal, not a repeated pop-up. One line, one link. The no-nag rule (from 2026-06-28-profile-intake-ux) applies: shown once per run, not repeated.
- The notice does not appear if the broker list is current (< 30 days) or if auto-update is already enabled.

## Why
Placing the first-fetch prompt in Profile at setup is the correct moment: the user is about to run for the first time and has just stated who they are. "Check for updates before we search?" is a natural next step. Placing it in Run done (as originally noted) would mean the first run uses a potentially stale broker list — the user fetches fresh data only after the run they needed it for. The weekly lazy cadence avoids background network activity and is honest: the fetch happens when the user is actively using the tool, not silently in the background. The 30-day threshold for the after-run notice gives a reasonable grace period before the list becomes meaningfully stale.

## Alternatives considered
- First-fetch prompt in Run done state (original position in design doc): rejected — the user already ran with whatever data the bundled baseline had. Consent-before-run is more useful.
- First-fetch prompt on first install (onInstalled): rejected — user hasn't set up a profile yet; the prompt has no context ("you're about to search for yourself using this broker list" is the framing that makes sense).
- Scheduled background fetch: rejected — network contact without user presence is counter to the local-first posture.
- Cron-based weekly cadence: rejected — same reason. Lazy-triggered keeps network contact user-present.

## Open questions / follow-ups
- Q-006 (consent-prompt copy): cadence resolved (weekly, lazy). Exact consent-prompt copy still TBD — requires legal review to ensure the disclosure is accurate and clear. See Q-006.
