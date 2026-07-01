---
date: 2026-06-30
title: "Overlay-on-page vs side-by-side tab"
areas: [matching-overlay]
topics: [ux]
stories: []
status: superseded
supersedes:
superseded-by: 2026-07-01-sidebar-run-navigation
superseded-date: 2026-07-01
---

SUPERSEDED 2026-07-01 -> see 2026-07-01-sidebar-run-navigation. Kept for history, not current.

## Summary
Question raised about the on-page verdict UI: should the overlay stop painting *over* the broker page and instead live *alongside* it (some kind of docked tab / panel)? Not yet discussed or decided — recorded for a future design pass.

## Decisions / outcomes
- No decision — see Open questions.

## Why
An overlay drawn over the page risks obscuring the very listing the user must read to judge hit / clear / unknown (see 2026-06-28-overlay-unknown-verdict). A side-by-side surface could keep the page fully visible while the verdict controls stay reachable. Counter-constraint: whatever the form, the overlay invariant still holds — the UI must never inject the user's actual profile data into the page DOM (page scripts could read it), so a "tab alongside" still shows generic guidance only.

## Alternatives considered
- (None discussed yet — the alternatives *are* the question: overlay-over-page vs docked panel/tab vs something else.)

## Open questions / follow-ups
- Q-013: Should the overlay UI be changed to a tab/panel that lives alongside the page instead of over top of it?