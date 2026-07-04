---
date: 2026-07-03
title: "Challenge detection misses explicit Turnstile"
areas: [matching-overlay]
topics: [webextensions]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
QA of PR #6 on a live TruePeopleSearch gate showed `detectChallenge()` failing to catch the site's real Cloudflare challenge, so the sidebar rendered verdict buttons over a live bot-gate. The gap is pre-existing (classify.ts is untouched by PR #6), not a regression. Root cause and a fix approach are captured here; the fix ships on a separate follow-up branch.

## Decisions / outcomes
- Fix on a separate branch, not in PR #6. The detection heuristics live in classify.ts, which the refactor does not touch, so PR #6 merges as-is.
- Detect explicitly-rendered Turnstile by its API script: match `script[src*="challenges.cloudflare.com/turnstile"]`, the only reliable top-document signal.
- Rely on navigation-away for the resolve. Solving the `/InternalCaptcha` interstitial reloads the target page, where the content script re-reports clean, so no in-page solved-state detection is needed.
- Do not broaden the match to `cloudflare` or `cf`. One page iframe is a Clym consent widget (`cf.clym-widget.net`); a loose match false-positives on it.

## Why
- TPS renders Turnstile explicitly: no `.cf-turnstile` container and the widget iframes are `about:blank`, so every existing selector misses it. The "verify you are human" text lives inside the cross-origin iframe and is not readable from the top document. The API script is the one element always present in the top document while gated.
- Script-presence is safe as a signal here because the challenge is a full-page interstitial that navigates on solve. The script tag lingering after solve would only matter for a hypothetical inline re-gate with no navigation.

## Alternatives considered
- Match iframe src or `.cf-turnstile`, rejected: explicit render uses about:blank iframes and no container class.
- Text heuristic on "verify you are human", rejected: the text is inside the cross-origin iframe, so `document.body.innerText` does not see it (`verifyText` was false in the DOM probe).

## Open questions / follow-ups
- Q-018: Should per-broker challenge hints live in brokers.json (signed data), or should challenge detection stay purely generic and cross-site?
- Full write-up plus the DOM-probe evidence live in temp/challenge-detection-fix.md (local handoff doc).
- See also: 2026-07-03-tab-registry-challenge-state. The 2026-06-29-cloudflare-challenge-handling entry predates the sidebar migration and may need its own cleanup.
