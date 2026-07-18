---
id: Q-019
question: "Before AMO, what exact dataset host subdomain ships (data. vs updates.expurge.com), and does the extension id expurge@expurge.dev change to match the expurge.com domain?"
status: resolved
areas: [permissions, broker-dataset]
asked_date: 2026-07-09
asked_slug: 2026-07-09-m7-signed-dataset-extension-side
resolution: "Ship data.expurge.com as the dataset host, and reconcile the extension id to expurge@expurge.com. data. names the resource (a static, signed dataset) rather than an action, keeps \"trust travels in the signature, not the host\" legible, matches the codebase vocabulary (DATASET_ORIGIN / Dataset / dataset_version), and stays forward-compatible for a future second static file; it is single-sourced as DATASET_HOST_PATTERN in src/shared/dataset.ts and matched verbatim by the manifest optional_host_permissions. The extension id changed from expurge@expurge.dev to expurge@expurge.com so browser_specific_settings.gecko.id matches the owned expurge.com domain the host lives under — fixed now, before any AMO listing, because the id ties AMO updates together. Standalone design decision (2026-07-18); no separate wherefore log entry."
resolution_slug:
---
