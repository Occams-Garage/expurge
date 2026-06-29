# expurge — build progress

---

## What exists today

**M0–M3 vertical slice is complete and buildable.** The codebase is a working
end-to-end skeleton: one broker (TruePeopleSearch), one profile variant (primary only),
no persistence opt-ins, no options page, no challenge/load-error handling, no batch pacing.

### Files in place

| File | What it does |
|------|--------------|
| `manifest.json` | MV3, Firefox 140+, data-taxonomy declaration, optional_host_permissions for TruePeopleSearch, permissions: storage/tabs/webNavigation/downloads |
| `package.json` | webextension-polyfill, esbuild, typescript; scripts: build / dev (--watch) / typecheck |
| `tsconfig.json` | ES2022 target, moduleResolution: bundler, noEmit: true |
| `build.mjs` | esbuild; three IIFE bundles (background, content, popup); copies popup.html and style.css to dist/ |
| `src/shared/types.ts` | Verdict, WorkItem (tabId as scratch-only), RunState, Profile, all message types |
| `src/shared/brokers.ts` | ChannelTrust enum, BrokerChannel/Broker interfaces, BROKERS const (TruePeopleSearch only; trust stubbed as 'verified') |
| `src/shared/transforms.ts` | Four transforms (slug/q/upper/raw), deriveFields(), renderUrl() |
| `src/shared/gate.ts` | evaluateGate(), channelExpiryState(), WARN_MONTHS=6, EXPIRE_MONTHS=12 |
| `src/shared/templates.ts` | Draft discriminated union (EmailDraft \| FormDraft); buildDraft() dispatches on channel.kind; buildFormCard() generates form instruction card; mailtoUrl/toEml/toCopyText on EmailDraft; US general + CA CCPA templates (copy TBD Q-010) |
| `src/background/index.ts` | Stateless coordinator; saveRun() strips tabIds; expurge_tab_{tabId} session keys; handles START_RUN/GET_RUN_STATE/GET_ITEM/VERDICT/GET_DRAFT; tabs.onRemoved → tab_closed; webNavigation.onErrorOccurred → load_error; listingUrl stored on WorkItem; renderedUrl included in ITEM_INFO |
| `src/content/index.ts` | Shadow DOM overlay; two-path rendering (results page: guidance panel with paste fallback; details page: full verdict panel); page detection via pathname comparison; sendVerdict() with listingUrl, 6s timeout + 3 retries; post-ACK guidance "open expurge to send your opt-out request" |
| `src/popup/index.html` | Three sections: profile form, run status, draft content (email or form card, rendered by JS) |
| `src/popup/index.ts` | handleFormSubmit(); permissions.request() from click handler; renderDraftSection() dispatches on draft.kind; renderEmailDraftSection() / renderFormDraftSection(); init() |
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

### Remaining

#### M4 — Single-broker robustness
- Challenge detection in content script (Cloudflare/Turnstile/hCaptcha/reCAPTCHA/DataDome via shared signals; MutationObserver re-shows overlay after solve)
- Load-error path verified (webNavigation.onErrorOccurred already wired; add test)
- Pause/stop controls in popup (currently no controls beyond Refresh)
- Stop → `run_stopped` skip reason for open/pending items
- Verify no-wedge rule across all three clearing paths (verdict, skip-by-button, tab-closed)

#### M5 — Multi-broker paced batching + AKA fan-out
- Background: batch opening (default 5), next batch waits for full clear
- `also_known_as[]` expansion in buildItems() — one item per (broker × name-variant)
- `matched_as` field on WorkItem, populated on hit verdict
- Run monitor: one row per broker with AKAs folded in
- Badge: hit count during active run (browser.action.setBadgeText)
- Coverage report: broker-unit counts, missing-field breakdown, unverified/broken/not-enabled
- `missing:<field>` skip reason when requires[] not satisfied

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
| `src/background/index.ts` | No batch pacing — opens one tab, no batch ceiling — add in M5 |
| `src/background/index.ts` | No AKA fan-out in buildItems() — add in M5 |
| `src/content/index.ts` | No challenge detection — add in M4 |
| `manifest.json` | No `options_ui` entry — add in M6 |

---

## Consciously deferred (code review, 2026-06-28)

These findings were surfaced in the pre-M4 code review and explicitly deferred rather than
fixed. Recorded here so the decision isn't re-litigated in future sessions.

| Finding | Deferred to | Rationale |
|---------|-------------|-----------|
| TOCTOU race in `handleVerdict` (`loadRun` → mutate → `saveRun` not atomic) | M5 | Batching makes concurrent verdicts from two open tabs more likely; fixing the race correctly requires a queued-write or mutex pattern that's easier to introduce alongside batch work |
| Duplicate PING listener registered on every overlay re-inject | M4 testing | Need the reinject path exercised with real challenge scenarios before the right fix is obvious; may resolve itself once reinject logic stabilises |
| Popup routes to first hit only; subsequent hits unreachable | M5/M6 | Requires the Results section (options page, M6) or a multi-hit picker (M5); not worth hacking around in the popup |
| `buildFormCard()` steps are TPS-specific (role dropdown, hCaptcha step) | M5 | Generalise when a second `form_required` broker is added; premature abstraction with one data point |
| Background PING handler always returns `hasOverlay: false` | M6 | Content script is authoritative for overlay presence; background stub is incorrect but harmless until REINJECT_OVERLAY is wired into the options page |
| SPA / History API navigation not handled (overlay disappears on client-side route change) | M5 | No current broker in the set is a SPA; revisit when adding brokers that use pushState |
| `Profile` type has only 4 of 14 planned fields (`first`, `last`, `city`, `state`) | M5 | Remaining fields (`middle`, `zip`, `age`, `emails[]`, `phones[]`, `relatives[]`, `also_known_as[]`) are needed for AKA fan-out; premature to add fields with no consumers yet |
