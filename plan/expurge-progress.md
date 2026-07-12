# expurge — build progress

---

## What exists today

**M0–M6 is complete and buildable.** The codebase supports multi-broker paced
batching, AKA name-variant fan-out, and a full options-page UI. One broker
(TruePeopleSearch), up to BATCH_SIZE=5 concurrent tabs, `also_known_as[]`
expansion, serial write queue, badge, options dashboard with Run/Results/Profile/Settings
sections, redesigned popup (run-control-panel only). No persistence opt-ins.

### Files in place

| File | What it does |
|------|--------------|
| `manifest.json` | MV3, Firefox 140+, data-taxonomy declaration; permissions: storage/tabs/downloads/scripting/webNavigation (webNavigation declared for `onErrorOccurred`, not yet wired in background); host_permissions: updates.expurge.dev (M7 remote fetch); optional_host_permissions: TruePeopleSearch; `options_ui.open_in_tab: true`; `_notes` block documents M7/M9 requirements (strip before AMO submission) |
| `package.json` | webextension-polyfill, esbuild, typescript; scripts: build / dev (--watch) / typecheck |
| `tsconfig.json` | ES2022 target, moduleResolution: bundler, noEmit: true |
| `build.mjs` | esbuild; five IIFE bundles (background, content, popup, options, options.css); copies popup.html, options.html, style.css to dist/ |
| `src/shared/types.ts` | Verdict, WorkItem (tabId scratch-only, matchedAs on hit, optedOutAt on send), RunState, Profile (all 10 fields), all message types including SAVE_PROFILE/GET_PROFILE/MARK_SENT/DELETE_ALL |
| `src/shared/brokers.ts` | ChannelTrust enum, BrokerChannel/Broker interfaces, BROKERS const (TruePeopleSearch only; trust stubbed as 'verified') |
| `src/shared/transforms.ts` | Four transforms (slug/q/upper/raw), deriveFields(), renderUrl() |
| `src/shared/gate.ts` | evaluateGate(), channelExpiryState(), WARN_MONTHS=6, EXPIRE_MONTHS=12 |
| `src/shared/templates.ts` | Draft discriminated union (EmailDraft \| FormDraft); buildDraft() dispatches on channel.kind; buildFormCard() generates form instruction card; mailtoUrl/toEml/toCopyText on EmailDraft; US general + CA CCPA templates (copy TBD Q-010) |
| `src/background/index.ts` | Stateless coordinator; serialWrite queue (prevents TOCTOU); saveRun() strips tabIds; expurge_tab_{tabId} session keys; handles START_RUN/GET_RUN_STATE/GET_ITEM/VERDICT/GET_DRAFT/STOP_RUN/REINJECT_OVERLAY/SAVE_PROFILE/GET_PROFILE/MARK_SENT/DELETE_ALL; onInstalled → openOptionsPage(); buildItems() fans out across primary + AKA variants, pre-verdicts missing-field items; matchedAs populated on hit; updateBadge() (hit count); handleStopRun() marks open+pending as run_stopped + removes tab keys; findActiveBrokerTab() with mid-redirect fallback; tabs.onUpdated hostname guard (skips off-host reinject); tabs.onRemoved → tab_closed |
| `src/content/index.ts` | Shadow DOM overlay; PING listener guarded by window.__expurgePingBound; CHALLENGE_SELECTORS + detectChallenge() (two-group: interstitial always blocks; Turnstile blocks only when token absent); buildChallengePanel() with debounced MutationObserver (250 ms guard against transient reflows); showMainPanel() (results page: guidance panel with paste fallback; details page: full verdict panel); page detection via pathname comparison; sendVerdict() with 6s timeout + 3 retries |
| `src/popup/index.html` | Run control panel only: no-run / active / done states; dashboard and restore-overlay buttons |
| `src/popup/index.ts` | init() checks GET_RUN_STATE → routes to no-run/active/done; stop fires STOP_RUN; restore-overlay fires REINJECT_OVERLAY; all three dashboard buttons → openOptionsPage() |
| `src/popup/style.css` | Popup styles; badge variants |
| `src/options/index.html` | Full options page: sidebar nav (Run/Results/Profile/Settings); run section (welcome/ready/active/done states); results section (verdict groups + inline draft panels); profile section (all 10 fields); settings section (send-method radio, broker list, export, delete-all with confirm) |
| `src/options/style.css` | Options page styles: layout, nav, form fields, broker table, run monitor, results groups, draft panels (email + form card), callout-amber, radio group |
| `src/options/index.ts` | Full options page TypeScript: init() → GET_PROFILE + GET_RUN_STATE → routes new users to Profile; renderRunActive() 2s poll; renderResults() with four verdict groups; loadDraftPanel() → GET_DRAFT → renderEmailDraftInPanel / renderFormDraftInPanel; MARK_SENT; SAVE_PROFILE on form submit; saveSendMethod to storage.local; DELETE_ALL; export JSON via downloads API; handleStartRun() with dynamic permissions.request() |

### Prototype vs. target architecture

The popup currently contains the profile form and draft surfaces. Per the design interview,
these move to the options page in M4+. The popup becomes a compact run control panel only.

### Done: overlay → sidebar migration (decided + built 2026-07-01)

The in-page shadow-DOM overlay was **replaced by a Firefox native `sidebar_action`** — a
persistent, window-level run-wide checklist that drives navigation itself. Beyond what the
per-tab overlay could do, the sidebar adds an **interactive checklist** (grouped In progress /
Waiting / Done; click any non-terminal row to jump to that tab) and an always-available
**Defer** control. The migration also added a first-class `deferred` work-item state, a
`MAX_OPEN_TABS=15` ceiling, per-broker `search.guidance`, a shared `progressOf`/`isComplete`
definition, and shrank the content script to a **headless challenge reporter** (no UI, ~45
lines). The reinjection machinery (Restore-Overlay / PING / `reinjectIfMissing` / `GET_ITEM`)
is gone, and the dead `scripting` permission was dropped.

View truth lives in one pure function, `deriveView` (`src/sidebar/state.ts`); the background
builds its inputs and pushes `SIDEBAR_UPDATE`, and the sidebar renders without re-deriving.
Full plan (§-by-§ with commit refs) in **`plan/sidebar-nav.md`**; rationale in wherefore
`2026-07-01-sidebar-run-navigation` (resolves Q-013; Q-015 pending empirical Firefox check).
The `content` / `popup` / `background` rows above describe the **pre-migration** build and are
superseded by the sidebar architecture — see `sidebar-nav.md` for the current shape.

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
- **M6** — Options page (primary UI) + popup redesign: `options_ui.open_in_tab: true`; `onInstalled` → `openOptionsPage()`; four-section options page (Run / Results / Profile / Settings) with 2s polling, run state machine, all 10 Profile fields, verdict groups with inline draft panels, `general_contact` amber callout, mark-as-sent (`optedOutAt`), preferred send method in `storage.local`, broker coverage list, export, delete-all; popup stripped to run-control-panel (open dashboard / restore overlay / stop); Profile type expanded to 10 fields; SAVE_PROFILE/GET_PROFILE/MARK_SENT/DELETE_ALL message handlers in background

### Remaining

#### M7 — Signed remote dataset (Ed25519)

**Decisions (confirmed 2026-07-09):** Posture B (accept either pinned key) · custom domain
`data.expurge.dev` (host single-sourced as `DATASET_HOST_PATTERN` in `src/shared/dataset.ts` +
the manifest `optional_host_permissions`) · WebCrypto (no crypto dependency). Full design in
`plan/dataset-delivery.md`; infra half in `plan/dataset-delivery-runbook.md`.

**Extension-side — DONE (2026-07-09):**
- `src/shared/dataset.ts` — pure, unit-tested core: `Dataset`/`SigEnvelope`/`DatasetStatus`
  types, host constants, `BUNDLED_DATASET` (wraps `BROKERS`, `dataset_version: 0`), pure
  `decideDatasetUpdate()` (signature→shape→anti-rollback→expiry), `isValidDataset()`,
  `isDatasetExpired()`, `isAutoFetchDue()` (weekly cadence), and WebCrypto Ed25519 verify
  (`loadTrustedKeys` / `anyValidSignature`, Posture B = any pinned key validates).
- `src/background/dataset-store.ts` — IO wrapper (coverage-excluded): `verifyAndLoadDataset()`
  (conditional `If-None-Match` GET → verify-before-parse → anti-rollback via a raw-stored-version
  floor → expiry → swap; fail-safe keeps last-good on every error), `getActiveBrokers()` /
  `getActiveBroker()` (verified remote if present+unexpired, else bundled), `getDatasetStatus()`,
  `setAutoFetch()`, `autoFetchIfDue()`, ETag + prefs in `storage.local`.
- Background wiring: run construction (`buildItems`) and the draft-gate broker lookup read the
  **active** dataset; `CHECK_DATASET_UPDATE` / `GET_DATASET_STATUS` / `SET_DATASET_AUTOFETCH`
  message handlers.
- Settings → **Broker data updates**: version/source/last-checked status line, opt-in
  "Check automatically" toggle (off by default), "Check for updates now" button, host-permission
  grant requested in the click/change gesture, in-product privacy disclosure. Lazy weekly
  auto-fetch fires on options open when due. Controls disable themselves in a placeholder-key
  build (`configured: false`).
- `src/shared/dataset.test.ts` — 18 tests incl. a real generate→sign→verify Ed25519 roundtrip,
  tamper/wrong-key/wrong-alg rejection, Posture-B any-key acceptance, the full accept/ignore/
  reject decision matrix, and the auto-fetch cadence.

**Infra half — PENDING (runbook, requires the human; private keys must stay yours):** see
`plan/dataset-delivery-runbook.md`. Until the real keypair is generated and its public halves
replace the `TRUSTED_PUBKEYS_RAW` placeholders in `dataset.ts`, `loadTrustedKeys()` yields no
usable key → `configured: false` → the feature is inert by design and the bundled baseline is
always used. Steps: generate keypair · pin public keys · stand up `data.expurge.dev` on Pages ·
sign `brokers.json` → `brokers.sig.json` · CI validate-sign-publish workflow · first real
end-to-end fetch in Firefox.

**Deferred to M9 (documented):** the sidebar/options **display-path** broker lookups still read
the compile-time `BROKERS`; migrate them to the active dataset when the full/remote broker set
actually lands (with only the bundled dataset today the two are identical). Also: first-fetch
consent-prompt copy still needs legal review (Q-006).

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
- **Per-broker challenge-resolve gate** (onboarding checklist item): for each new broker, confirm its bot-gate **navigates away on solve** (like TPS `/InternalCaptcha`). `detectChallenge()`'s Turnstile-script signal is generic and manifest-bounded (it only runs where `content_scripts.matches` injects), but resolve-safety is proven on TPS **only (n=1)**. If a broker instead resolves **inline** — results swap in place, URL unchanged, the `challenges.cloudflare.com/turnstile` `<script>` persists — the detector would strand the challenge view over real results → forced Skip → missed hit. Before enabling such a broker, add a resolve signal (URL-path check or solved-token) or an option-2 per-broker `challenge` hint, plus a challenge fixture in `classify.test.ts`. (Origin: `fix/challenge-detection-managed`, 2026-07-03; the human-in-the-loop + Skip is the backstop that keeps a miss recoverable, not silent.)
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
| `src/background/index.ts` | AKA parsing splits on first space only — "Mary Jane Smith" gives first="Mary", last="Jane Smith"; smarter parsing (e.g. last-space split) deferred |
| `src/options/index.ts` | Settings section has no import JSON (export only); import deferred to M8 alongside persistence opt-ins |
| `src/background/index.ts` | `webNavigation` is declared in manifest permissions but `browser.webNavigation.onErrorOccurred` is not yet wired — add when M9 broker set makes load-error detection meaningful |
| `src/content/classify.ts` | Turnstile-script detection assumes solve **navigates away** (proven on TPS only). A broker that resolves the gate **inline** would strand the challenge view — see the M9 per-broker challenge-resolve gate before onboarding one |
| `src/shared/dataset.ts` | `TRUSTED_PUBKEYS_RAW` holds **placeholder** keys — replace with the real published Ed25519 public keys (runbook). Until then no remote dataset validates (feature inert by design). Host finalized `data.expurge.dev` (2026-07-12), matching extension id `expurge@expurge.dev` — no id reconcile needed |

---

## Consciously deferred (code review, 2026-06-28 / 2026-06-29)

These findings were surfaced in code reviews and explicitly deferred rather than
fixed. Recorded here so the decision isn't re-litigated in future sessions.

| Finding | Deferred to | Rationale |
|---------|-------------|-----------|
| `buildFormCard()` steps are TPS-specific (role dropdown, hCaptcha step) | M9 | Generalise when a second `form_required` broker is added; premature abstraction with one data point |
| Background PING handler always returns `hasOverlay: false` | — | Content script is authoritative for overlay presence; background stub is harmless; options page REINJECT_OVERLAY flow does not depend on this value |
| SPA / History API navigation not handled (overlay disappears on client-side route change) | M9 | No current broker in the set is a SPA; revisit when adding brokers that use pushState |
| REINJECT_OVERLAY fallback opens exactly 1 tab regardless of BATCH_SIZE (duplication of `openNextBatch`) | M7 | Acceptable with one broker; replace with `openOrRecoverBatch()` when the full broker set ships |
| Settings import JSON | M8 | Export is present; import deferred to M8 alongside the persistence opt-in toggles it depends on |
