---
date: 2026-06-28
title: "Profile intake: value-first, no-nag, trust-first"
areas: [profile]
topics: [privacy]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
The profile intake screen is the make-or-break trust moment: a privacy tool asking a worried person for the exact data they're worried about. The governing principle is "ask for personal data in a way that feels like the opposite of what the brokers did." The design is value-first (show results before asking for more), minimal-first (4 fields runs a real search), and deliberately undersells coverage on the first run. See also: 2026-06-28-profile-model.

## Decisions / outcomes
- First screen is not a form and not a manifesto. It states the bargain plainly (finds where you're listed, helps you request removal), the deal that makes it safe (nothing stored or sent unless you choose), and one verifiable claim: the extension can only talk to broker domains the user approves, checkable in Firefox's permissions and network tools.
- Minimal core first: first, last, city, state runs a real tier-1 search and shows actual results. User sees the tool find them before being asked for anything sensitive.
- The first run deliberately undersells coverage, an accepted cost. A shallow run that earns trust beats a thorough run that scares the user off.
- Enrichment is "expand your coverage," never a second form. Optional fields (age, zip, emails, phones, relatives, aka) surfaced in-context via the coverage report's missing-field nudge, each tied to the specific brokers or capability it unlocks, only when it actually buys something for this user.
- No-nag rule: the prompt states what's available and stops. A four-field user can stay four fields indefinitely; the gap is shown honestly but never pushed. This restraint is the product, noted explicitly to resist future "improve activation" pressure.
- Editing: core-field edits update raw atoms; derived fields recompute live (derivation purity rule paying off).
- Widening edits (add ZIP/aka) leave old hits and surface the new coverage opportunity.
- Correcting edits (wrong city) flag affected past hits as stale rather than deleting or hiding them.
- Deletion is a trivial single-confirmation "delete all my data," a deliberate contrast to broker deletion friction. The one place expurge makes deletion easier than the brokers do. Export pairs with it. Nearly a no-op for ephemeral-default users.

## Why
The intake frame is set before the user types a single character. A form-first or manifesto-first screen signals that the tool is about data collection; a results-first screen signals that it's about privacy recovery. The verifiable claim (not a vibe) is important: a worried user won't believe a privacy promise they can't check, but they can open Firefox's permissions panel. The no-nag rule is load-bearing: an app that pressures users to share more data is the thing they're trying to escape.

## Alternatives considered
- Lead with all optional fields upfront: rejected. A long form is exactly what the brokers present; leading with it signals the same posture.
- Context-based field prompting (prompt for fields at the right moment in the flow): merged into the coverage-report nudge approach instead of a separate flow.

## Open questions / follow-ups
- None.
