# expurge

A Firefox browser extension that finds a user's personal data on people-search sites and generates opt-out requests. Nothing about the user leaves their machine.

## Stack

TypeScript + WebExtensions API, Manifest V3, Firefox 140+. Three components:

- **Background script** — stateless event-page coordinator. Holds run state, opens broker tabs in paced batches, manages dataset, drives draft generation. Rehydrates from storage on every event (MV3 event pages can spin down mid-run).
- **Content scripts** — injected only on approved broker domains. Classify the page (challenge / load-error / normal), paint the on-page overlay, send verdicts back to background.
- **Popup / options page** — profile form, run dashboard, coverage report, export/import.

## Core model

### The broker dataset (`brokers.json`)

Shipped bundled, with a signed remote update layer on top (Ed25519, dual-key). Schema:

- `id`: stable slug, never changes after shipping (hit records reference it).
- `status`: `active | broken | disabled`. Operational — should the engine attempt this broker. Records are never deleted.
- `search.url`: template with `{placeholder|transform}` tokens. `requires[]` lists raw profile fields needed to attempt. `exposes[]` describes what the site shows (drives the confirm prompt).
- `optout[]`: ordered list of channels. First verified, unexpired channel wins. Each channel has `method` (email/web_form/mail), `target`, `kind` (dedicated_optout / general_contact / form_required), optional `subject`, `template`, and `trust` (unverified / verified / broken). Trust has `last_checked`, `source`, `verified_by`.

The search and optout halves fail independently and have separate status axes: broker-level `status` (can we find them?) vs channel-level `trust` (can we act?).

### The draft gate

A draft is generated ONLY when: (1) the broker is a confirmed hit AND (2) the selected optout channel has `trust: verified` AND `last_checked` within 12 months. No override. Wrong opt-out address mails PII to the wrong place — this gate is strict.

Channel selection: walk the optout list in order, take the first verified+unexpired channel. The channel's method/kind determines output type (email draft / instruction card), not whether it's selected.

Verification trust bits (`trust`, `source`, `last_checked`, `verified_by`) are project-assigned only. Contributed records always land `trust: unverified`. CI enforces this mechanically.

### The profile

Raw atomic fields only — `first`, `last`, `city`, `state`, `middle`, `zip`, `age`, `emails[]`, `phones[]`, `relatives[]`, `also_known_as[]`. Derived fields (`name`, `name_full`, `citystate`, etc.) are computed at runtime, never stored. Derivation is pure formatting only, no judgment calls.

### Run model

A run expands the profile across enabled brokers and aka variants, opens search URLs in paced batches (default 5), collects verdicts. The unit is **(broker × name-variant)**.

- Run state is a first-class object. The background is a stateless coordinator that rehydrates from `browser.storage.session` on every event.
- `tab_id` is live-session scratch only — never written to durable storage. On resume, `open` items revert to `pending`; verdicted items keep verdicts.
- Verdict contract: content script sends verdict → waits for explicit ack that background wrote to storage → then shows "recorded". No ack within timeout → retry (write is idempotent, keyed by item id).
- No-wedge rule: a verdict, a skip, or a park (error/challenge) all count as cleared. Nothing can wedge a run.
- Closing a tab without verdict = `skipped` reason `tab_closed` (background watches `tabs.onRemoved`).

### Persistence

Nothing is persisted by default. Three independent opt-ins, all default OFF:

1. **Profile storage** — stores profile in `browser.storage.local`; also enables cross-session run resume.
2. **Run metadata** — per-broker last-checked date + result, no PII.
3. **Rich hits/drafts history** — rides the profile opt-in.

`browser.storage.session` holds ephemeral run state (survives event-page spindown, clears on browser close).

### Permissions

No `<all_urls>`. Host patterns are in `optional_host_permissions` (MV3). New broker domains trigger Firefox's per-domain consent prompt at runtime. API permissions (downloads, tabs, webNavigation) go in `permissions`/`optional_permissions`.

## Key constraints / non-obvious decisions

- **Overlay must never inject the user's actual data into the DOM.** Shows generic guidance only ("look for your age, address"). Page scripts could read anything rendered into the DOM.
- **No per-site field extraction in v1.** Content scripts make only two cross-site automatic classifications (challenge detection, load failure). The human reads the page and clicks a verdict (hit / clear / unknown / skip). `unknown` is a real distinct verdict, not the same as skip.
- **age, not DOB.** Less sensitive, sufficient for matching. DOB deferred to a later version.
- **Two email templates only in v1**: general US opt-out and California CCPA. CA users also get a DROP informational notice (California's state removal tool covers a different, overlapping set of brokers). Auto-selected by `state` field.
- **Remote dataset is data, not code.** Extension verifies Ed25519 signature before trusting any field. Public keys are baked into the reviewed build as a `TRUSTED_PUBKEYS` constant. Signature verification happens via Web Crypto (`crypto.subtle.verify`).
- **Dataset fetch is user-initiated by default.** First fetch requires explicit consent. Auto-fetch is opt-in. The bundled baseline works fully offline.
- **Draft send never leaves the extension.** The extension generates a ready-to-send request; actual send happens in the user's own mail client (mailto: / .eml download / copy-paste). This keeps v1 out of authorized-agent obligations.

## Open questions (need live doc verification, not memory)

- **Q-003**: Can an extension reach a localhost Ollama endpoint for local-LLM extraction? (v2 concern)
- **Q-006**: Automatic fetch cadence and exact consent-prompt copy.
- **Q-008**: Exact manifest data-taxonomy format for Firefox 140+ declaration.
- **Q-009**: Does `browser.permissions.request()` require a user gesture in current Firefox?
- **Q-010**: CCPA template legal language and DROP-registry overlap verification (pre-launch).

## UI/UX design

All visual and interaction work must follow the `design/` folder:

- **`design/STYLEGUIDE.md`** — canonical guide for voice/tone, component patterns, ethics invariants (read this first for any UI work).
- **`src/styles/tokens.css`** / **`src/styles/tokens.json`** — design tokens. Always reference tokens; never hard-code hex values or raw sizes in components.
- **`design/expurge brand & UI guide.dc.html`** — visual brand reference.
- **`design/expurge cut animation.dc.html`** — animation reference.

The seven ethics invariants in `STYLEGUIDE.md §0` are non-negotiable and override any other instruction.

## Project state

Design phase. No source files yet. `expurge-plan.md` is the canonical design document. `wherefore/` contains the discussion log and open questions index.
