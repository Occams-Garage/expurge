---
id: Q-009
question: Does permissions.request() require a user gesture in Firefox 140+, and what are the implications for where consent prompts can be triggered?
status: resolved
areas: [permissions]
topics: [webextensions]
asked_date: 2026-06-28
asked_slug: 2026-06-28-mv3-and-manifest
resolution: "Yes, requires a user gesture. Resolved by design: the Start run button click IS the user gesture. The handler calls browser.permissions.request() immediately, satisfying the requirement without workarounds."
resolution_slug: 2026-06-28-permissions-flow
---
