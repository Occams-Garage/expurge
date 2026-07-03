---
date: 2026-06-28
title: "Subject line as structured field, not template"
areas: [broker-dataset]
topics: [data-model]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
An optional `subject` field was added to the email channel schema to hold a required opt-out subject line. A required subject is a discrete machine-relevant fact, so it belongs in a structured field, not embedded in a per-broker custom template. This preserves the 2-3-templates goal and establishes a named pattern for future similar constraints. See also: 2026-06-28-broker-dataset-schema.

## Decisions / outcomes
- Add an optional `subject` field to the email channel schema.
- Store a required opt-out subject as a structured field, not embedded template text.
- Establish a named pattern, "broker-specific request constraint": when the next discrete per-broker constraint appears (specific headers, specific body format), add a structured field for it rather than a custom per-broker template.
- Do not generalize the pattern further until a second instance appears.

## Why
A subject's value is exact and machine-relevant, not presentational, so it belongs in a structured field. That field lets one shared template serve many brokers, each providing its own subject, which preserves the 2-3-templates goal. Burying a required subject in a per-broker custom template would instead require either a unique template per broker or a per-broker template parameter, both of which erode the "small number of shared templates" design. A named field keeps the constraint schema-visible, validator-checkable, and template-agnostic. Flagging the pattern now means the next instance gets handled consistently rather than rediscovered.

## Alternatives considered
- Per-broker custom template: rejected. Breaks the shared-template model and turns every new broker constraint into a new template.

## Open questions / follow-ups
- None.
