---
id: Q-015
question: Does sidebarAction.open() require a user gesture in Firefox 140, and does calling it synchronously in the Start handler (before the async START_RUN round-trip) satisfy it?
status: resolved
areas: [matching-overlay, run-model]
asked_date: 2026-07-01
asked_slug: 2026-07-01-sidebar-run-navigation
resolution: "Yes — confirmed. MDN: sidebarAction.open() may only be called from a user-action handler and opens in the ACTIVE window. Resolved by design (as Q-009): called synchronously first in the options Start-run click handler, before the async START_RUN, with the run pinned to that active window. Empirically confirmed in Firefox 140+ (2026-07-01 QA): a single Start click drove BOTH sidebarAction.open() AND permissions.request() — the host-permission prompt appeared, the sidebar opened, and the broker tab held until the grant. No reorder needed."
resolution_slug: 2026-07-01-sidebar-run-navigation
---
