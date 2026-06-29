# expurge — build progress

---

## What exists today

**M0–M5 is complete and buildable.** The codebase supports multi-broker paced
batching and AKA name-variant fan-out. One broker (TruePeopleSearch), up to
BATCH_SIZE=5 concurrent tabs, `also_known_as[]` expansion, serial write queue,
badge, run monitor, and coverage note. No persistence opt-ins, no options page.

### Files in place

| File | What it does |
|------|--------------|
| `manifest.json` | MV3, Firefox 140+, data-taxonomy declaration, optional_host_permissions for TruePeopleSearch, permissions: storage/tabs/webNavigation/downloads |
| `package.json` | webextension-polyfill, esbuild, typescript; scripts: build / dev (--watch) / typecheck |
| `tsconfig.json` | ES2022 target, moduleResolution: bundler, noEmit: true |
| `build.mjs` | esbuild; three IIFE bundles (background, content, popup); copies popup.html and style.css to dist/ |
| `src/shared/types.ts` | Verdict, WorkItem (tabId scratch-only, matchedAs on hit), RunState, Profile (also_known_as optional), all message types; StopRunMsg; ReinjMsg.tabId optional |
| `src/shared/brokers.ts` | ChannelTrust enum, BrokerChannel/Broker interfaces, BROKERS const (TruePeopleSearch only; trust stubbed as 'verified') |
| `src/shared/transforms.ts` | Four transforms (slug/q/upper/raw), deriveFields(), renderUrl() |
| `src/shared/gate.ts` | evaluateGate(), channelExpiryState(), WARN_MONTHS=6, EXPIRE_MONTHS=12 |
| `src/shared/templates.ts` | Draft discriminated union (EmailDraft \| FormDraft); buildDraft() dispatches on channel.kind; buildFormCard() generates form instruction card; mailtoUrl/toEml/toCopyText on EmailDraft; US general + CA CCPA templates (copy TBD Q-010) |
| `src/background/index.ts` | Stateless coordinator; serialWrite queue (prevents TOCTOU); saveRun() strips tabIds; expurge_tab_{tabId} session keys; handles START_RUN/GET_RUN_STATE/GET_ITEM/VERDICT/GET_DRAFT/STOP_RUN/REINJECT_OVERLAY; buildItems() fans out across primary + AKA variants, pre-verdicts missing-field items; matchedAs populated on hit; updateBadge() (hit count); handleStopRun() marks open+pending as run_stopped + removes tab keys; findActiveBrokerTab() walks session keys, checks URL against broker domain; REINJECT_OVERLAY switches to live tab or opens next pending item; tabs.onRemoved → tab_closed; webNavigation.onErrorOccurred → load_error |
| `src/content/index.ts` | Shadow DOM overlay; PING listener guarded by window.__expurgePingBound; CHALLENGE_SELECTORS + detectChallenge(); buildChallengePanel() with debounced MutationObserver (250 ms guard against transient reflows); showMainPanel() (results page: guidance panel with paste fallback; details page: full verdict panel); page detection via pathname comparison; sendVerdict() with 6s timeout + 3 retries |
| `src/popup/index.html` | Profile form (also_known_as textarea), run-active-view (broker table + coverage note + stop + restore overlay + view drafts), draft content |
| `src/popup/index.ts` | handleFormSubmit() parses also_known_as textarea; permissions.request() from click handler; showRunActive() renders broker table + coverage note, toggles stop/view-drafts visibility; STOP_RUN fires on stop click; REINJECT_OVERLAY sends without tabId, shows "Nothing left to check" on ok:false; renderDraftSection() dispatches on draft.kind |
| `src/popup/style.css` | Popup styles; badge variants; form card styles (fields table, steps list, open-form button) |

### Prototype vs. target architecture

The popup currently contains the profile form and draft surfaces. Per the design interview,
these move to the options page in M4+. The popup becomes a compact run control panel only.

---

## Milestones

### Done

- **M0** — Manifest + build skeleton (esbuild, TS, webextension-polyfill, dist/)
- **M1** — Profile form → URL render → open tab (popup form, permissions.request, START_RUN)
- **M2** — Content script overlay + four-way verdict + ACK contract (shadow DOM, retry logic, tab_closed skip)
- **M3** — Draft gate + three send surfaces (evaluateGate, buildDraft, mailto/.eml/copy-paste in popup)
- **M3+** — Listing URL capture: results-page guidance panel, navigate-to-details flow, paste fallback, post-ACK "open expurge" cue, listingUrl in draft body
- **M3+** — TPS form_required opt-out: corrected channel record, Draft discriminated union, buildFormCard(), form card in popup (fields table, 7-step walkthrough, open-form button)
- **M4** — Single-broker robustness: challenge detection (10 selectors covering Cloudflare/Turnstile/hCaptcha/reCAPTCHA/DataDome; MutationObserver auto-transitions to verdict panel on solve; Skip button sends skipped verdict); stop control (STOP_RUN marks all open+pending as run_stopped; popup stop button hidden on completion); no-wedge verified across all three clearing paths (verdict, skip, tab-closed all call openNextBatch); Restore overlay fixed (findActiveBrokerTab walks session keys to find live broker tab, switches to it; falls back to opening next pending item; correct dist/content.js inject path)
- **M5** — Multi-broker batching + AKA fan-out: buildItems() expands primary + also_known_as[] variants across all active brokers (one item per broker × name-variant); missing required field → pre-verdicted skip with `missing:<field>` reason; serialWrite queue prevents TOCTOU races when multiple browser tabs return verdicts concurrently; matchedAs field populated on hit verdict; browser.action badge shows hit count; popup run monitor renders per-broker table with rolled-up status badge + AKA count; coverage note shows brokers not in the run and missing-field skip count; PING listener guarded by window flag (deduplicates across executeScript reinjections); MutationObserver dismissal debounced 250 ms; challenge skip button checks sendVerdict return value

### Remaining

#### M6 — Options page (primary UI) + popup redesign
- `options_ui.open_in_tab: true` in manifest
- `browser.runtime.onInstalled` → `browser.runtime.openOptionsPage()`
- Options page: four-section persistent nav (Run / Results / Profile / Settings)
- **Run section**: four states (welcome/pitch → ready → active → done)
- **Profile section**: all fields (first/last/city/state/middle/zip/age/emails[]/phones[]/relatives[]/also_known_as[]), first-fetch consent prompt
- **Results section**: four verdict groups (Listed / Couldn't tell / Skipped / Not checked), clear collapsed, nudge cards, mini-run button, per-run history
- **Settings section**: four sub-sections (Storage / Preferences / Broker list / Your data); preferred-send-method radio; delete-all with inline confirmation; export JSON; import JSON
- Popup redesigned to run-control-panel only (badge, pause/resume, "Open dashboard →")
- Profile form, draft surfaces, results all moved out of popup and into options page
- "Mark as sent / submitted" on draft panels
- `general_contact` amber callout on draft panels
- `form_required` instruction card in options page (popup version exists; move + extend in M6)
- `opted_out_at` timestamp on WorkItem

#### M7 — Signed remote dataset (Ed25519)
- Keypair generation + key management docs
- `TRUSTED_PUBKEYS` constant baked into build (primary + backup)
- `crypto.subtle.verify` on fetch; reject-and-fallback on signature failure
- Remote fetch UI: "Check for updates" button in Settings → Broker list
- Auto-fetch: lazy-triggered when options page opens and ≥ 7 days elapsed
- First-fetch consent prompt in Profile section (copy TBD Q-006)
- New-domain permission request flow after verified dataset arrives
- Bundled dataset signed and shipped with extension

#### M8 — Persistence opt-ins
- Three independent toggles in Settings → Storage (all default OFF):
  1. Profile storage → `storage.local` (enables cross-session run resume)
  2. Run metadata (per-broker last-checked + result, no PII)
  3. Rich hits/drafts history (rides profile opt-in)
- Contextual first-exposure banners (Run done → run-metadata opt-in; Results → rich-history opt-in; Profile → profile-storage opt-in)
- Background: loadRun() / saveRun() promote to `storage.local` when profile-storage opt-in is active; cross-session resume on reopen
- Export: JSON (no draft bodies, raw data only), download via downloads API
- Import: read JSON, warn-and-overwrite if profile exists (no merge)
- Delete-all: inline single-confirmation panel, wipes all `storage.local` expurge keys

#### M9 — Full dataset + launch polish
- ~25 verified people-search brokers in brokers.json (all channels personally verified, trust bits stamped)
- Pre-launch verify: CCPA template legal language; DROP registry cross-reference (Q-010)
- CI schema validator: rejects malformed records, enforces trust-bit hygiene (contributed records must be `trust: unverified`)
- Optional stamp helper: `verify <broker-id> <channel>` CLI sets last_checked / verified_by / trust
- Full run on real brokers, bugs fixed
- AMO submission prep: screenshots, description, privacy notice, data-practices declaration

---

## Open design questions

| ID | Status | Question |
|----|--------|----------|
| Q-003 | open | Can a content/background script reach a localhost Ollama endpoint? (v2 concern) |
| Q-006 | partial | Weekly lazy cadence resolved; **exact consent-prompt copy still needs legal review** |
| Q-010 | open | CCPA template legal language + DROP registry overlap — pre-launch verify required |

---

## Known code TODOs

| Location | TODO |
|----------|------|
| `src/shared/brokers.ts` | TruePeopleSearch form channel verified 2026-06-28 — re-verify periodically; only one broker total (M9 expands to ~25) |
| `src/shared/templates.ts` | Both email template bodies marked `// TODO Q-010` — legal review before launch |
| `src/shared/templates.ts` | `buildFormCard()` fields are TPS-specific (role dropdown step, hCaptcha step); generalize when adding more form_required brokers |
| `src/popup/index.ts` | Profile form and draft surfaces are in popup — move to options page in M6 |
| `src/popup/index.ts` | `isGeneralContact` wired in EmailDraft but amber callout not yet rendered — add in M6 |
| `src/background/index.ts` | AKA parsing splits on first space only — "Mary Jane Smith" gives first="Mary", last="Jane Smith"; smarter parsing (e.g. last-space split) deferred |
| `src/popup/index.ts` | "View opt-out requests" routes to first hit only — multi-hit navigation needs M6 Results section |
| `manifest.json` | No `options_ui` entry — add in M6 |

---

## Consciously deferred (code review, 2026-06-28 / 2026-06-29)

These findings were surfaced in code reviews and explicitly deferred rather than
fixed. Recorded here so the decision isn't re-litigated in future sessions.

| Finding | Deferred to | Rationale |
|---------|-------------|-----------|
| Popup routes to first hit only; subsequent hits unreachable | M6 | Requires the Results section (options page, M6); the popup run monitor added in M5 shows per-broker status but does not support navigating to a second hit's draft |
| `buildFormCard()` steps are TPS-specific (role dropdown, hCaptcha step) | M5 | Generalise when a second `form_required` broker is added; premature abstraction with one data point |
| Background PING handler always returns `hasOverlay: false` | M6 | Content script is authoritative for overlay presence; background stub is incorrect but harmless until REINJECT_OVERLAY is wired into the options page |
| SPA / History API navigation not handled (overlay disappears on client-side route change) | M5 | No current broker in the set is a SPA; revisit when adding brokers that use pushState |
| `Profile` type has only 4 of 14 planned fields (`first`, `last`, `city`, `state`) | M5 | Remaining fields (`middle`, `zip`, `age`, `emails[]`, `phones[]`, `relatives[]`, `also_known_as[]`) are needed for AKA fan-out; premature to add fields with no consumers yet |
| REINJECT_OVERLAY fallback opens exactly 1 tab regardless of BATCH_SIZE (duplication of `openNextBatch`) | M5 | Correct for M4 (single broker); the inline copy should be replaced with a proper `openOrRecoverBatch()` when M5 adds batch pacing |
