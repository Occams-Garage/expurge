# wherefore/plan

Forward-looking work items, one file per commitment, tracking what is committed and
how far along it is. A plan item is a commitment, not a decision. The why lives in
`log/`; open questions live in `questions/`. This directory holds only the what and
its progress.

The loader globs `P-*.md`, so this README (and any other non-`P` doc) is ignored. The
`id` frontmatter field is authoritative; the filename slug is browsability sugar.

## Frontmatter

```yaml
---
id: P-001                    # authoritative, P + zero-padded number, never reused
title: Short human title     # quote if it contains ": " or a leading -, #, [, {, "
status: todo                 # todo | doing | done | dropped
created: 2026-07-19          # YYYY-MM-DD, set once on open
updated: 2026-07-19          # YYYY-MM-DD, set on ANY write (status OR a single checkbox)
area: broker-dataset         # single area from topics.md Areas; optional
topics: [security-signing]   # inline list from topics.md Topics; omit when empty
milestone: M7                # milestone this serves (M-series in plan/expurge-progress.md); optional
decision_ref: 2026-07-09-slug   # originating decision(s), comma-separated, no .md; optional
question_ref: Q-006          # a single open question this item is blocked on; optional
answers: Q-010               # a single question this item is the work of answering (spike); optional
dropped_reason: >            # why, when status is dropped; optional
  Short reason kept for history.
---
```

- `status` is its own state machine, separate from decision status. Normal flow
  `todo -> doing -> done`; reopening `done -> doing` is allowed.
- `updated` is the plan-change timestamp and must not lie: bump it on any edit,
  including toggling one checkbox. A brand-new untouched `todo` has no `updated` key.
- `blocked` is not a status. An item is blocked when it carries a `question_ref` to a
  still-open question. `answers` is the opposite: the item is the work of answering
  that question (a spike), so it is not blocked.
- Compound keys use underscores (`decision_ref`, `question_ref`, `dropped_reason`).

## Body

Break the work into `- [ ]` checkboxes concrete enough to actually check off. Link
related items with `[[P-00N-slug]]`. A spike's checkboxes are the questions to answer,
not steps to take.

No em dashes anywhere in this collection. Use periods, commas, colons, semicolons, or
parentheses instead.
