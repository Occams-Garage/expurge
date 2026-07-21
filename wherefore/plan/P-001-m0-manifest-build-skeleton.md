---
id: P-001
title: "M0: manifest + build skeleton"
status: done
created: 2026-06-28
updated: 2026-06-28
topics: [webextensions, typescript]
milestone: M0
decision_ref: 2026-06-28-mv3-and-manifest, 2026-06-28-firefox-extension-pivot
---

Retroactive record of a shipped milestone: the buildable foundation. Manifest V3
targeting Firefox 140+, the esbuild pipeline, and the TypeScript toolchain. Source:
`plan/expurge-progress.md` (What exists today; Milestones, M0). All work complete.

- [x] `manifest.json`: MV3, Firefox 140+ target, data-taxonomy declaration, base permissions, `optional_host_permissions` for the first broker domain
- [x] `package.json`: webextension-polyfill, esbuild, typescript; build / dev (--watch) / typecheck scripts
- [x] `tsconfig.json`: ES2022 target, moduleResolution bundler, noEmit
- [x] `build.mjs`: esbuild producing the IIFE bundles and copying the static HTML/CSS into `dist/`