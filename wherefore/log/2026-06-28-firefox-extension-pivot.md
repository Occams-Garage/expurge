---
date: 2026-06-28
title: "Firefox extension as delivery platform"
areas: [run-model, permissions]
topics: [webextensions, privacy]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
The project pivoted from a Go CLI/binary to a Firefox browser extension. This dissolves the hardest problem in the original plan: reading hostile broker pages without triggering bot detection. A content script running in the user's real browser session is not a bot, and captcha challenges are solved by the human sitting there.

## Decisions / outcomes
- v1 ships as a Firefox extension (TypeScript + WebExtensions API), not a CLI or binary.
- Distribution: AMO (addons.mozilla.org) plus signed unlisted XPIs.
- Firefox-only for v1; Chrome port deferred to v2 (more permissive WebExtensions, target user skews Firefox).
- Go, GoReleaser, Homebrew/Scoop, cgo, Gatekeeper/SmartScreen signing: all retired.
- All downstream design (broker schema, matcher, draft gate, verification model) carries over from pre-pivot work untouched — it all lives downstream of "human at the gate."

## Why
The desired UX — a confirm/clear/skip overlay sitting on top of the real broker result page — is only cleanly achievable from inside the user's own browser. The extension reads DOM from pages the browser already loaded under the user's real session, so there is no `navigator.webdriver`, no CDP port, and no fingerprinting surface. The earlier CLI plan was not wrong about the data model; it was wrong about the request shape: "requesting sites like a robot" was the hard problem, not "reading hostile sites."

## Alternatives considered
- Go CLI binary: rejected because automating requests to hostile sites as an agent triggers bot detection and captcha walls the tool cannot solve. The extension sidesteps this entirely.

## Open questions / follow-ups
- Q-005: What is current Firefox AMO review policy for content-reading extensions, and should v1 target MV2 or MV3?
