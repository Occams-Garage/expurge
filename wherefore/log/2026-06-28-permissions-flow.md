---
date: 2026-06-28
title: "Permissions flow: all-at-once at run start, denied brokers skipped"
areas: [permissions, run-model]
topics: [webextensions, ux]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
All optional host permissions needed for an upcoming run are requested in a single `browser.permissions.request()` call at run start. Firefox presents one dialog covering all needed domains. Denied domains are skipped that run with reason `permission_denied` (satisfies the no-wedge rule). Previously-granted permissions persist in Firefox across sessions and are not re-requested. Resolves Q-009 by design. See also: 2026-06-28-mv3-and-manifest.

## Decisions / outcomes
- At "Start run" click, the background calculates which broker domains are needed for the run (enabled brokers × profile fields that satisfy `requires[]`) and calls `browser.permissions.request()` with all needed `origins` at once.
- `browser.permissions.request()` must be called from a user gesture. The "Start run" button click IS that gesture. The call is made from the click handler, satisfying the requirement without any workaround.
- Firefox presents a single consent dialog covering all requested domains. The user can grant all or deny all (Firefox does not support per-domain granular selection within one request call).
- If the user denies: the run proceeds with zero host permissions. Each item without permission is immediately marked `skipped/permission_denied`. The run completes (possibly with all items skipped). No error state.
- Partially denied (domains granted in a prior run, new brokers added): only new domains appear in the dialog. Previously-granted permissions are already in Firefox's permission store and are not re-shown.
- After the dialog, the content script injection for approved domains is handled automatically by Firefox's static `content_scripts` declaration with `optional_host_permissions`. No dynamic `scripting.registerContentScripts()` needed.
- `permission_denied` skip reason is visible in Results section → Skipped group, with a link to re-run (which will re-prompt for those domains).

### Q-009 resolution
Q-009 asked whether `browser.permissions.request()` requires a user gesture in Firefox 140+. Answer: yes, it requires a user gesture. Resolution is by design: the Start button click is the user gesture, so the handler can call `permissions.request()` immediately. No workaround or deferred call is needed. See also M0 to M3 implementation where the popup's Start button already uses this pattern.

## Why
Requesting all permissions at once is less disruptive than per-domain lazy-permission during the run (which would interrupt the user mid-run with repeated prompts, mid-batch). One dialog at run start is the right trade-off: the user approves the scope before anything opens. The denied-means-skipped behavior keeps the no-wedge rule intact: the run is never blocked waiting for a permission that was denied. Firefox's static content_scripts + optional_host_permissions is the correct MV3 mechanism; it avoids the complexity of dynamic scripting registration.

## Alternatives considered
- Per-broker lazy permission (request when opening each tab): rejected. Mid-run interruptions destroy the batch rhythm and confuse users.
- Permissions granted during onboarding (before first run): rejected. The set of needed domains depends on which brokers are enabled and what profile fields are set; this is only knowable at run time.
- Fail the run if any domain is denied: rejected. Violates the no-wedge rule. The run must always complete.

## Open questions / follow-ups
- None. (Q-009 resolved by design.)
