---
date: 2026-06-29
title: "Per-component licensing: GPL/AGPL/ODbL"
areas: [broker-dataset]
topics: [licensing, dataset-distribution]
stories: []
status: active
supersedes:
superseded_by:
superseded_date:
---

## Summary
The project will license each part according to how it's distributed rather than applying one license everywhere. Client (browser extension) → GPL-3.0; server (dataset feed + future submission/vetting tooling) → AGPL-3.0; dataset (curated broker list) → ODbL. The client was moved from AGPL-3.0 to GPL-3.0 as part of this. Technical-moat "protection" ideas (token gating, anti-scrape ToS, canary/poison data) were rejected as contrary to the tool's identity.

## Decisions / outcomes
- Client (extension): GPL-3.0. It's distributed, so GPL already forces redistributed forks to open their changes; the AGPL network clause adds nothing for a distributed binary, and GPL is friendlier to contributors (fewer "no-AGPL" policies). Moved client from AGPL-3.0 → GPL-3.0.
- Server (dataset feed + vetting tooling): AGPL-3.0. It's hosted, not distributed, so plain GPL's copyleft is sidesteppable via the SaaS loophole; AGPL closes that and protects the server-side logic most at risk of being taken closed.
- Dataset (broker list): ODbL. A code license does not reliably cover raw facts/lists, so a competitor could lift the data and ignore the code license. ODbL is purpose-built for databases and is strong copyleft: commercial use allowed, but derived databases must be opened, which proprietary services (DeleteMe, etc.) won't do.
- Repo structure: clearly separated locations, each with its own LICENSE file (`extension/` GPL-3.0, `server/` AGPL-3.0, `data/` ODbL), plus a README/LICENSING section mapping license→component. Separate repos each carry one LICENSE + badge; a monorepo badges only top-level, so the README must spell out the rest.

## Why
Match each license to the distribution model it was designed for: strong protection where the hosted risk actually lives (server), lighter contributor-friendly terms where it doesn't (client), and purpose-built protection for the asset most worth defending (the dataset, the project's moat). GPL-3.0 and AGPL-3.0 are designed to be compatible, and client/server stay separate codebases talking over the network, so each keeps its own license cleanly. Care is only needed if code is ever pulled from one into the other.

## Alternatives considered
- One license across everything: rejected. A single license can't simultaneously close the server SaaS loophole, stay contributor-friendly on the client, and cover raw data.
- CC BY-NC-SA for the dataset: rejected. NonCommercial would block legitimate open uses and contradicts the open public-good identity; ODbL keeps it genuinely open while remaining un-enclosable.
- Technical moats (API token gating, rate-limit-as-protection, ToS anti-scraping, and especially canary/poison data that phones home): rejected. They contradict the trust-first, local-first, no-covert-callbacks identity. Canary data in particular is exactly the hidden server-callback the architecture was built never to do. License-level share-alike (ODbL) gives the meaningful defense without the sketch.

## Open questions / follow-ups
- Q-011: Confirm the exact data-license pick (ODbL vs alternatives) and verify the actual license texts against current licensing guidance before committing the LICENSE files. Consequential; not to be relied on from memory. (Not legal advice.)