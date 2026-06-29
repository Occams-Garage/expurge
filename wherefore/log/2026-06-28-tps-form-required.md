---
date: 2026-06-28
title: "TPS opt-out channel: web form replaces email; Draft discriminated union"
areas: [opt-out-drafts, broker-dataset]
topics: [ux, data-model, verification]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
Live testing revealed that TruePeopleSearch does not offer an email opt-out — the correct
channel is a web form at `https://www.truepeoplesearch.com/removal`. The broker record was
corrected and the `Draft` type was extended to a discriminated union to support instruction
cards alongside email drafts without losing type safety. See also:
2026-06-28-draft-opt-out-status, 2026-06-28-draft-send-mechanism.

## Decisions / outcomes

### TPS channel corrected to web_form / form_required
The broker record's optout array was updated from `method: email, kind: dedicated_optout`
to `method: web_form, kind: form_required, target: https://www.truepeoplesearch.com/removal`.
Trust fields set: `trust: verified, last_checked: 2026-06-28, verified_by: dustinrvk@gmail.com`.

The old `optout@truepeoplesearch.com` email address in the prior record was never verified;
the form at `/removal` is the real, current opt-out path.

The form requires:
- Role dropdown: "Exercise my rights as" → "The subject of the request"
- First Name, Middle Name (optional), Last Name
- Email Address (required for confirmation link; not stored by expurge)
- Authorization checkbox
- hCaptcha ("I am human")
- Confirmation: an email with a link is sent; clicking it completes removal.

### Draft → discriminated union (EmailDraft | FormDraft)
`Draft` was a flat interface with `to/subject/body`. Changed to a discriminated union:

```typescript
type Draft = EmailDraft | FormDraft
```

- `EmailDraft { kind: 'email'; brokerName; to; subject; body; isGeneralContact? }`
- `FormDraft  { kind: 'form';  brokerName; formUrl; fields: FormField[]; steps: string[] }`

`buildDraft()` dispatches on `channel.kind === 'form_required'` and calls `buildFormCard()`.
Email send helpers (`mailtoUrl`, `toEml`, `toCopyText`) now take `EmailDraft` specifically,
preventing accidental use on a form draft.

Why a discriminated union over a nullable-field flat interface: TypeScript exhaustive checks
on `draft.kind` ensure every rendering path handles both shapes at compile time. Nullable
fields (`to?: string`) would allow silent omission in the email path.

### buildFormCard(): fields and steps from profile
`buildFormCard()` generates the `FormDraft` content from the profile and broker channel:

**Fields table** (shown with copy-paste values where available):
| Field | Source | Display |
|-------|--------|---------|
| First Name | `profile.first` | monospace highlight |
| Middle Name | — | "you fill in" placeholder |
| Last Name | `profile.last` | monospace highlight |
| Email Address | — | "you fill in" + note about confirmation link |

Why "you fill in" for email address: expurge does not store the user's email address (not a
profile field). Including it would require a new profile field, consent implications, and
storage handling out of scope for M0-M3. The note makes it clear why it's needed.

**Steps** (7 steps, walks the user through the full form submission including the
confirmation-link step which many users miss).

### Popup renders form card (M3 interim, moves to options page in M6)
`renderDraftSection()` dispatches on `draft.kind`. For `form_required`:
- `renderFormDraftSection()` injects: broker summary, fields table, steps list, "Open opt-out
  form →" button (calls `browser.tabs.create`).
- Section-draft HTML simplified: static email-specific elements removed; all send surfaces now
  rendered from JS into `#draft-content`.
- `general_contact` amber callout and "Mark as submitted" are deferred to M6 options page.

The form card in the popup is an M3 interim; in M6 it moves to the options page Results /
draft panels alongside the other post-run send surfaces.

## Why
The email address was a best-effort guess that was never verified. The form is what TPS
actually uses. Implementing it now (rather than shipping a wrong email channel) avoids mailing
a user's opt-out request to a dead or wrong address — exactly the failure mode the draft gate
is designed to prevent.

## Alternatives considered
- Keep the stub `trust: unverified` email channel and skip TPS until a proper channel is
  verified: would mean no draft generated for any TPS hit — not useful for testing.
- Flat nullable interface for Draft with `kind?: 'email' | 'form'`: loses type narrowing and
  requires runtime guards throughout. Rejected in favor of discriminated union.

## Open questions / follow-ups
- `isGeneralContact` amber callout is wired in `EmailDraft` but not yet rendered in the popup
  (M6 options page item).
- Middle Name and Email Address not in Profile — both deferred: middle name to AKA/full-name
  disambiguation work (M5); email address requires a separate design decision on storage and
  consent implications.
