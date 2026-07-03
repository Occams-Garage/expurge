---
date: 2026-06-28
title: "Draft panels: opt-out status tracking, form instruction cards, general_contact callout"
areas: [opt-out-drafts]
topics: [ux, data-model]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
Draft panels gain a lightweight opt-out status tracking feature ("Mark as sent" / "Mark form as submitted") for both email and form channels. form_required brokers generate instruction cards instead of draft emails. general_contact channels get an amber callout warning. These three augment the existing three-surface send mechanism (see 2026-06-28-draft-send-mechanism); they do not replace it.

## Decisions / outcomes

### "Mark as sent" (email channels: method = email)
- A "Mark as sent" button records an `opted_out_at` timestamp on the work item, below the three send surfaces (mailto / .eml / copy-paste).
- After marking: button label changes to "Sent, [date]" with a secondary "Unmark" link.
- Applies to all email channels regardless of `kind` (dedicated_optout or general_contact).
- The timestamp is display-only UX: a memory aid, not a legal record or a guarantee.
- Stored with the hit record under the rich-history opt-in. Ephemeral-default users see the marked state only for the current session.

### "Mark form as submitted" (form_required channels: method = web_form)
- form_required channels generate an instruction card rather than a draft email. The card contains:
  - The opt-out URL (click to open the form in a new tab).
  - Copy-paste values for each required field (name, city, state, etc.) formatted to match the form's expected inputs.
  - Step-by-step instructions specific to the broker.
- "Mark form as submitted" button below the instruction card. Same timestamp semantics as email channels.
- After marking: "Submitted, [date]" label with "Unmark" link.

### general_contact amber callout
- Channels with `kind: general_contact` show an amber callout at the top of the draft panel, before the draft body and before the send surfaces:
  > "This site doesn't have a dedicated opt-out address. This request goes to their general contact. Results may vary and follow-up may be needed."
- The callout is informational, not a blocker. All send surfaces are fully available.

### Scope
- These additions apply per draft panel (per broker × hit). They do not affect the draft gate logic (see 2026-06-28-verification-draft-gate) or channel selection (walk the optout list in order, take the first verified+unexpired channel).
- "Mark as sent/submitted" is the user's statement, not the extension's; expurge does not verify delivery.

## Why
"Mark as sent" answers the practical need: a user who ran the extension a month ago needs to know which opt-outs they already sent without re-reading every draft. A timestamp tied to the hit record is the minimal tracking that answers "did I send this and when." It extends naturally to form channels where the equivalent action is submitting the form. The amber callout for general_contact channels is a trust disclosure, not friction. Users should know they're sending to a general inbox before they compose and send, not discover it afterward when there's no response; a user who discovers weeks later that their opt-out went to a generic inbox will feel misled if the extension didn't warn them. The form instruction card replaces the draft email for web_form channels because there is no draft to compose: the user fills out a form, not their own email client.

## Alternatives considered
- No opt-out status tracking: rejected. Leaves users with no memory of which opt-outs they've acted on across sessions.
- Tracking sent status automatically (e.g., monitoring mailto success): impossible without sending on the user's behalf; the send-it-yourself model deliberately avoids this.
- Modal confirmation before send: rejected. Adds friction without adding value; the callout at the top of the panel is sufficient warning.

## Open questions / follow-ups
- None.
