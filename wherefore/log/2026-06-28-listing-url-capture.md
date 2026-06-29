---
date: 2026-06-28
title: "Listing URL capture: navigate-to-details flow with paste fallback"
areas: [matching-overlay, run-model, opt-out-drafts]
topics: [ux, data-model]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
When a broker's search opens a results page, the content script must guide the user to navigate to their individual profile/details page before casting a verdict. The profile page URL (`window.location.href` at verdict time) is captured as `listingUrl` and included in the opt-out email body. A paste-URL fallback handles paywalled or inaccessible detail pages. Post-verdict guidance directs the user back to the popup.

Trigger: first live test revealed that (1) the results page URL is useless in opt-out emails — brokers need the direct listing URL — and (2) after confirming a "Listed" verdict, the user had no signal to go back to the popup. See also: 2026-06-28-run-section-states, 2026-06-28-draft-opt-out-status.

## Decisions / outcomes

### Results page: guidance only, no verdict buttons
When the content script detects it is on the broker's search results page (current URL path matches the rendered search URL's path), it renders a **guidance panel** instead of the verdict panel. Guidance shows:
- The same "Look for" hints from `exposes[]`.
- Instruction: "Find yourself? Click 'View Details →' to confirm on your profile page."
- No verdict buttons. The user must navigate before they can act.

Why no buttons on results page: if the user confirms from results, `window.location.href` at verdict time is the search URL — useless in the opt-out email and not what brokers need to identify a specific record. Forcing navigation ensures `listingUrl` is always the direct profile URL.

### Navigate-to-details (primary path)
When the user clicks "View Details" and the tab navigates to the profile page, the content script re-injects on the new URL. The tab ID is unchanged, so `GET_ITEM` maps back to the same work item. The verdict panel appears on the profile page. `window.location.href` is included in the `VERDICT` message as `listingUrl`.

This works without any special handling — the existing tab-ID → item mapping and content script injection-on-load already support it.

### Paste-URL fallback (paywalled or inaccessible detail pages)
Below the main guidance on the results page, a **collapsed secondary section**: "Can't access the details page? →" toggle that expands a URL paste field.

Paste field behavior:
- Verdict buttons appear as soon as the field is **non-empty** (no extra confirm step).
- On each input change: check that the pasted value's hostname matches the broker's domain. If not, show an **amber warning** ("This doesn't look like a TruePeopleSearch URL — double-check before confirming"). Warning is informational only — it does NOT block the verdict buttons.
- Verdict sent with `listingUrl: pastedValue`.

Why warning-only, not a block: the paste field exists precisely for edge cases (paywall, unusual URL structures). Blocking on domain mismatch would fail exactly the users who need the fallback most. The warning is sufficient — a user who reads "this doesn't look like a TPS URL" and still proceeds has made an informed choice.

Why buttons appear on non-empty: requiring an extra "Use this URL" step adds ceremony with no safety benefit the warning doesn't already provide.

### `listingUrl` data flow
`listingUrl?: string` is added to:
- `WorkItem`: stored alongside verdict.
- `VerdictMsg`: carries it from content script to background.
- `buildDraft()`: optional parameter; included in draft body if present.

### Draft body placement
When `listingUrl` is present, it is inserted **near the top of the email body, right after the opening line**:
> The following profile contains my information and I am requesting its removal:
> [listingUrl]

Rationale: opt-out teams process high volumes of requests; the listing URL near the top minimizes the work to locate and action the specific record. Most broker opt-out instructions explicitly say to include a link to your listing.

`listingUrl` is optional at all stages — if absent (user confirmed without capturing a URL), the draft still generates, just without the URL line.

### Post-verdict guidance
After the ACK is received, the overlay status line changes to:
> ✓ Listed — open expurge to send your opt-out request.

Applies to both the navigate path (details page) and the paste path (results page). Replaces the previous dead-end "✓ Listed" which gave no next-step signal.

## Why
The overlay on the results page knowing it's on a results page is simple (`window.location.pathname` comparison to the rendered search URL's path). Captured at verdict time from `window.location.href`, so no DOM field extraction is needed — just the URL of the page the user is currently on. This is not per-site logic: any broker where the search page and profile page have different paths benefits automatically.

## Alternatives considered
- Confirm on results page, extract "View Details" href from DOM: requires per-site DOM selector, more fragile than `window.location.href` on the profile page, gets results page href not the canonical profile URL. Rejected.
- Manual copy-paste without guidance (user right-clicks and pastes): no guidance to do so; most users wouldn't know to do this. The paste fallback exists for edge cases, not the primary path. Rejected as primary path.
- Auto-open popup after verdict: `browser.action.openPopup()` requires a user gesture in most Firefox versions — cannot be called programmatically from a background/content script. The "open expurge" instruction in the overlay is the correct mechanism.

## Open questions / follow-ups
- None.