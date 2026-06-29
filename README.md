# expurge

A Firefox browser extension that finds your personal data on people-search sites and generates opt-out requests. Nothing about you leaves your machine.

## What it does

expurge opens people-search broker sites in paced batches, shows you an overlay asking you to look for your information, and collects your verdict (hit / clear / unknown / skip). For confirmed hits where an opt-out channel has been independently verified, it generates a ready-to-send email draft or instruction card. You send it yourself — the extension never touches your mail or submits anything on your behalf.

## Requirements

- Firefox 140+
- Node.js (for building from source)

## Setup

```sh
npm install
npm run build
```

For live rebuilding during development:

```sh
npm run dev
```

Type-check without building:

```sh
npm run typecheck
```

## Loading in Firefox

1. Build the extension (`npm run build`)
2. Open Firefox and navigate to `about:debugging`
3. Click **This Firefox** in the left sidebar
4. Click **Load Temporary Add-on...**
5. Navigate to the `dist/` folder and select any file (e.g. `manifest.json`)

The extension stays loaded until Firefox is closed. After each rebuild, click **Reload** in `about:debugging` to pick up the new build.

## Project structure

```
src/
  background/   — event-page coordinator (stateless, rehydrates from session storage)
  content/      — per-broker content scripts (overlay, verdict handling)
  popup/        — popup UI and options page
  shared/       — types, utilities, dataset logic
  styles/       — design tokens and global styles
dist/           — compiled output (gitignored)
design/         — brand guide, style guide, animation reference
wherefore/      — discussion log and open questions index
manifest.json
build.mjs
```

## Architecture overview

**Background script** — stateless coordinator. Holds run state in `browser.storage.session`, opens broker tabs in paced batches (default 5), drives draft generation. Rehydrates from storage on every event because MV3 event pages can spin down between events.

**Content scripts** — injected only on approved broker domains. Detect challenges and load errors, paint the on-page overlay, send verdicts back to background. The overlay never injects the user's actual data into the DOM — only generic guidance like "look for your name and address."

**Popup / options page** — profile entry, run dashboard, coverage report, export/import.

**Broker dataset (`brokers.json`)** — bundled with the extension. Can be updated remotely; remote updates are verified with an Ed25519 signature before any field is trusted. The bundled baseline works fully offline.

## Privacy model

- No network requests except optional, user-initiated dataset updates (Ed25519-verified).
- No `<all_urls>` — broker host permissions are declared in `optional_host_permissions` and Firefox prompts per domain at runtime.
- Nothing persisted by default. Three independent opt-ins (all off): profile storage, run metadata, rich hits/drafts history.
- Draft send never leaves the extension — output is a mailto link, .eml download, or copy-paste block for your own mail client.

## Design

All UI and visual work follows the `design/` folder:

- `design/STYLEGUIDE.md` — voice/tone, component patterns, ethics invariants (read first for any UI work)
- `src/styles/tokens.css` / `src/styles/tokens.json` — design tokens; never hard-code hex values or raw sizes
- `design/expurge brand & UI guide.dc.html` — visual brand reference
- `design/expurge cut animation.dc.html` — animation reference

The seven ethics invariants in `STYLEGUIDE.md §0` are non-negotiable.