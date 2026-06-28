---
date: 2026-06-28
title: "Subject line as structured field, not template"
areas: [broker-dataset]
topics: [data-model]
stories: []
status: active
supersedes:
superseded-by:
superseded-date:
---

## Summary
An optional `subject` field was added to the email channel schema to hold a required opt-out subject line. A required subject is a discrete machine-relevant fact, so it belongs in a structured field, not embedded in a per-broker custom template. This preserves the 2-3-templates goal and establishes a named pattern for future similar constraints. See also: 2026-06-28-broker-dataset-schema.

## Decisions / outcomes
- Optional `subject` field added to email channel schema.
- A required opt-out subject is a structured field because its value is exact and machine-relevant, not presentational.
- Structured field lets one shared template serve many brokers, each providing its own subject — the 2-3-templates goal is preserved.
- Named pattern going forward: **"broker-specific request constraint"** — when the next discrete per-broker constraint appears (specific headers, specific body format), add a field for it rather than reaching for a custom per-broker template. Don't generalize further until the second instance appears.

## Why
Burying a required subject in a per-broker custom template would require either a unique template per broker or a per-broker template parameter, both of which erode the "small number of shared templates" design. A named field keeps the constraint schema-visible, validator-checkable, and template-agnostic. Flagging the pattern now means the next instance gets handled consistently rather than rediscovered.

## Alternatives considered
- Per-broker custom template: rejected — breaks the shared-template model and turns every new broker constraint into a new template.

## Open questions / follow-ups
- None.
