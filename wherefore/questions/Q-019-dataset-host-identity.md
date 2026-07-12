---
id: Q-019
question: "Before AMO, what exact dataset host subdomain ships (data. vs updates.expurge.com), and does the extension id expurge@expurge.dev change to match the expurge.com domain?"
status: resolved
areas: [permissions, broker-dataset]
asked_date: 2026-07-09
asked_slug: 2026-07-09-m7-signed-dataset-extension-side
resolution: "Host finalized as data.expurge.dev (the `data.` subdomain on the .dev TLD); the extension id is unchanged, since expurge@expurge.dev already matches — no reconcile needed."
resolution_slug:
resolution_date: 2026-07-12
---

## Resolution

The dataset host ships as **`data.expurge.dev`** — the `data.` subdomain (not `updates.`),
on the **`.dev`** TLD, chosen over `expurge.com` and `expurge.app` (both considered/held by
the owner).

Why `.dev`:

1. **Matches the extension id.** `browser_specific_settings.gecko.id` is already
   `expurge@expurge.dev`. Pinning the host on the same registrable domain means the earlier
   "id vs domain mismatch" concern is *dissolved*, not traded — no id change before AMO.
2. **`.dev` is HSTS-preloaded** (HTTPS-only in all browsers), which fits the https-only,
   signature-verified dataset fetch. Practical note: there is no http fallback while the
   Let's Encrypt cert provisions, so the host is briefly unreachable rather than serving plain
   HTTP — expected, not a fault.
3. **Separation of concerns.** `expurge.app` stays free for a future consumer/product/landing
   site; data infrastructure lives on `.dev`.

Pinned **now** (pre-launch, before real keys are pinned) deliberately: moving the host after
launch costs an extension update *and* a fresh per-user `optional_host_permissions` consent
prompt for every installed user.

Applied 2026-07-12 across code + docs: `DATASET_ORIGIN` / `DATASET_HOST_PATTERN` in
`src/shared/dataset.ts`; manifest `optional_host_permissions` + `_notes`;
`plan/dataset-delivery.md` (decisions block, §3.2, §3.3, §10); `plan/dataset-delivery-runbook.md`;
`plan/expurge-progress.md`; `plan/next-steps-jul-9-26.md`. Standalone resolution — no new
wherefore entry. Green bar confirmed (typecheck / 207 tests / build).
