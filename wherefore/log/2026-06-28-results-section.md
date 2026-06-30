---
date: 2026-06-28
title: "Results section: four verdict groups, clear collapsed, nudge pattern, mini-run"
areas: [coverage-report, run-model]
topics: [ux, data-model]
stories: []
status: superseded
supersedes:
superseded-by: 2026-06-30-results-broker-grouped
superseded-date: 2026-06-30
---

SUPERSEDED 2026-06-30 -> see 2026-06-30-results-broker-grouped. Kept for history, not current.

## Summary
The Results section groups outcomes into four named buckets, collapses the "not found" majority to reduce visual noise, surfaces profile gaps as inline nudge cards, and offers a mini-run to re-check skipped items. Most recent run is expanded by default; prior runs are collapsed. See also: 2026-06-28-run-section-states, 2026-06-28-ux-architecture.

## Decisions / outcomes

### Four verdict groups
Results are grouped into four named sections within a run view:

- **Listed on** (verdict: `hit`): sites where the user was found. Action available: draft opt-out. Listed first because it's the actionable result.
- **Couldn't tell** (verdict: `unknown`): sites visited but not resolved. Surfaced so users know these sites weren't confirmed clear, not ignored.
- **Skipped** (verdict: `skipped`): items not completed, with sub-reason shown per item (`tab_closed`, `load_error`, `challenge`, `permission_denied`, `run_stopped`). See mini-run below for the re-check path.
- **Not checked** (status: `pending`, not attempted): brokers that never opened, e.g. due to missing required profile fields. Each item shows which field would unlock it.

"Not listed" (verdict: `clear`) is **collapsed by default** — for most users, clear results are the majority. Showing 22 "clear" rows before the 3 hits creates visual noise and buries the actionable items. Collapsed section has a "Show N not-found results ▶" toggle.

### Run history layout
- Most recent run: expanded, shown at top.
- Prior runs (under the profile-storage opt-in): collapsed, each labeled by date and hit count. Expand to browse historical results.
- Ephemeral-default users: only the current session run is shown. Cross-session history requires the profile-storage opt-in.

### Nudge pattern
- Results section surfaces profile field gaps as inline nudge cards within the "Not checked" group, tied to specific brokers they would unlock.
- Example card: "Adding a ZIP code would let us check 4 more brokers → [Add to profile]". The CTA navigates directly to the Profile section.
- Cards appear only when the gap is real (the field is absent and there are active brokers that require it). No nudge for fields that would unlock zero brokers.
- The no-nag rule applies: cards are shown once per gap, not re-shown on every results view. A dismissed nudge stays dismissed. Users can open all their gaps from a "What else can I check? →" summary link rather than per-item nudges.

### Mini-run
- "Check skipped items" button in the Skipped group seeds a new run from the current run's skipped items only.
- This is a new run (new UUID, new `createdAt`), not a resume. The prior run's skipped items become the new run's item list.
- Rationale: skipped items often have a common cause (all `challenge`, or all from a single permission denial) that the user may have since resolved. A targeted mini-run is more efficient than re-running all brokers.
- Mini-run button label is reason-aware: "Retry load errors (N)" or "Retry challenges (N)" when all skips share a reason; "Check skipped items (N)" otherwise.

## Why
Four named groups rather than a flat list prevent the results from being a raw status dump. "Listed on" leading reflects that hits are the reason the user ran; burying them after 20 clear results misframes the outcome. Collapsing clear results by default is the right UX because clears are the expected majority and not individually actionable — they're reassurance, not a task list. The nudge-to-Profile pattern keeps enrichment pressure entirely in the results screen (where the gap has a concrete payoff) rather than in a first-run prompt. Mini-run from skipped items is a lightweight re-check path that respects the user's time and avoids repeating successfully-cleared brokers.

## Alternatives considered
- Flat verdict list (all results in one unsorted list): rejected — no visual hierarchy between actionable hits and the reassuring clear majority.
- Clear results always visible: rejected — creates the "22 clears before 3 hits" problem.
- Resume from skipped items (not a new run): rejected — a resume would re-open the stopped run's state, but the user may have since changed their profile or permissions. New run is cleaner.

## Open questions / follow-ups
- None.
