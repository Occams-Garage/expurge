---
id: P-017
title: M9 AMO submission prep
status: todo
created: 2026-07-19
area: permissions
topics: [webextensions, privacy]
milestone: M9
decision_ref: 2026-06-28-amo-compliance
---

The launch gate: package and list the extension on AMO. Depends on the dataset and
hardening being real ([[P-012-m9-populate-verified-brokers]], [[P-016-m9-deferred-cleanups-hardening]])
and on the legal review ([[P-015-m9-ccpa-drop-legal-verify]]). Source:
`plan/expurge-progress.md` -> M9, `plan/dataset-delivery-runbook.md` §8,
`plan/expurge-plan.md` §8a, `plan/sidebar-nav-follow-up.md` §7.

- [ ] Strip the manifest `_notes` block before submission (documents M7/M9 requirements; not for shipping)
- [ ] Confirm `data_collection_permissions` stays `["none"]` (the opt-in fetch sends no user data: `credentials: 'omit'`, no identifiers)
- [ ] Disclose the opt-in dataset-update fetch in the AMO listing (the in-product disclosure already lives in Settings)
- [ ] Produce screenshots, description, and privacy notice
- [ ] Complete the AMO data-practices declaration
- [ ] Verify AMO compliance constraints from §8a hold against the final build
