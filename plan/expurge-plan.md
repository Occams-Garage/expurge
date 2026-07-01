# expurge — consolidated design plan

A lightweight, privacy-preserving tool that helps a person find their personal data on
people-search sites and generate opt-out requests. Local-first: nothing about the user
leaves their machine. Delivered as a **Firefox browser extension** (v1).

Name cleared on every axis: domains (expurge.dev, expurge.app) owned, USPTO TESS clear,
npm/PyPI/crates/GitHub namespaces open.

---

## 1. Platform and architecture

**v1 is a Firefox extension. Not a CLI, not a Go binary.** The earlier Go/CLI plan is
retired. The pivot happened because the desired UX, a confirm/clear/skip control sitting
on top of the real broker result page, is only achievable cleanly from inside the user's
own browser.

Why the extension is the right shape, not just a UX preference:
- A content script reads the DOM of a page the user's real browser already loaded. There
  is no automation framework, no `navigator.webdriver`, no CDP port. It is not a bot, so
  it does not trip Cloudflare / captcha / fingerprinting.
- This dissolves the single hardest problem in the old plan. "Reading hostile sites" was
  never the issue; "requesting them like a robot" was. The extension stops being a robot.
- If a site throws a human challenge, the user solves it themselves, because they are
  sitting right there in their own session. Then the overlay appears.

Stack:
- TypeScript + WebExtensions API. **Manifest V3**, targeting **Firefox 140+** so the
  extension can use Firefox's built-in data-collection consent experience and declare its
  data practices in the manifest via Mozilla's data-classification taxonomy (including the
  explicit "no data collection" declaration, AMO policy 6.2.1). MV3 locks: host patterns go
  in `optional_host_permissions` (NOT `optional_permissions`); API permissions (downloads,
  tabs, webNavigation) go in `permissions`/`optional_permissions`; ephemeral run state uses
  `browser.storage.session` (survives event-page spindown, clears on browser close). Verify
  the current taxonomy format against live Mozilla docs before writing the manifest.
- **Background script**: holds run state and profile (in-memory by default, persisted only
  under the storage opt-in, see 4a), iterates the dataset, opens broker tabs in paced
  batches, collects verdicts, runs draft generation, manages dataset fetch/verify.
- **Content scripts**: injected only on broker domains. Classify the page (challenge /
  load-error / normal), paint the on-page overlay telling the human what to look for, and
  send the verdict back to background. (v1 is shallow-first: no per-site field extraction on
  the page; the human is the matcher. See section 7.)
- **Popup / options page**: the toolbar popup is a compact **run control panel** only (current run status, hit-count badge, pause/resume button, "Open dashboard →" link). The **options page** (`options_ui.open_in_tab: true`) is the primary UI, opened as a full browser tab with persistent top navigation across four sections: **Run** (run control and live monitor), **Results** (post-run findings browser), **Profile** (identity fields, AKA management, dataset update preference), **Settings** (Storage / Preferences / Broker list / Your data). `browser.runtime.onInstalled` opens the options page on first install; new users land on Run, which shows a welcome/pitch state before any profile is set. Settings sub-sections: *Storage* (three persistence opt-in toggles with inline privacy-boundary descriptions and contextual first-exposure banners); *Preferences* (preferred send method, default: mailto); *Broker list* (per-broker status, last-checked, trust state, manual update button, auto-update toggle); *Your data* (export JSON / delete-all with inline single-confirmation / import).

What carried over untouched from the pre-pivot work (the expensive thinking survives,
because it all lives downstream of "human at the gate," and the human is still the gate):
the broker schema, the channel-list optout model, per-channel verification, the draft
gate, the withhold-by-default ID posture, the atomic profile + derivation purity rule,
the `also_known_as` fan-out, `matched_as` on hits, and the coverage report.

What died with the binary: Go, GoReleaser, Homebrew/Scoop, cgo, Gatekeeper/SmartScreen
signing. Distribution is now AMO (addons.mozilla.org) plus the option of signed unlisted
XPIs. Chrome is a later port; Firefox-only for v1 is deliberate (more permissive
WebExtensions, and the privacy-conscious user already skews Firefox).

---

## 2. Scope

**Two distinct populations, modeled separately:**
- **People-search sites** (Whitepages, Spokeo, BeenVerified, TruePeopleSearch, Radaris,
  etc.): publicly searchable, so locate-and-confirm works. **This is all of v1.**
- **Registered data brokers** (the 500+ on state registries): mostly no public search,
  B2B aggregators. No listing to confirm, only blind opt-out. **Deferred.** When added,
  it is a separate list with its own blind-send flow, not a retrofit.

Rationale: the publicly-searchable data is the exposure a normal person can actually feel
and verify, and the only population where the confirm loop is even meaningful.

**v1 broker list**: hand-curated, ~25 highest-exposure people-search sites, every record
personally verified before launch. State registries are NOT a source for this list (they
are the wrong population). Growth comes through contributor PRs, each landing as
unverified until a human verifies it.

---

## 3. The broker dataset (the central asset)

Ships as JSON. Schema is interface-agnostic; the engine substitutes values and follows
instructions with ZERO broker-specific branching. Per record:

**Identity**
- `id`: stable slug, lowercase. Primary key. Hit records reference this, so it must never
  change once shipped.
- `name`: display name. Mutable, presentational.
- `category`: `people_search` in v1. Populated but not branched on yet.
- `tier`: 1-3, exposure priority. Drives ordering (check tier 1 first) and future filters.
- `status`: `active | broken | disabled`. OPERATIONAL toggle: should the engine attempt
  this broker at all. Records are never deleted; retiring = `disabled`.

**search block**
- `url`: template with `{placeholder|transform}` tokens. Most fragile field in the
  dataset; quarantined by `status: broken` and verification when it drifts.
- `requires[]`: RAW profile fields that must be present to attempt this broker. Missing
  any -> skip with reason `missing:<field>`, which feeds the coverage nudge.
- `exposes[]`: data types the site publicly shows. Drives the confirm prompt ("look for
  your age, address, relatives"). In v1 this guides the human's eyes; with the deferred
  extraction-hint enrichment it would also tell an extractor which fields to look for.
  Descriptive, never gates.

**optout block — an ORDERED LIST of channels** (list position = preference; no explicit
order field). Each channel:
- `method`: `email | web_form | mail`.
- `target`: the email address or form URL.
- `kind`: `dedicated_optout | general_contact | form_required`. This is the safety field.
  It separates a real removal address from a footer "contact us" address from a
  form-only site, so email-as-fallback never silently mails PII to a `sales@` inbox.
- `subject` (optional, email channels): an exact subject line some brokers require for
  opt-out emails. Present -> used verbatim in mailto/.eml/copy-paste; absent -> the
  template supplies a default. Kept as a structured field, NOT folded into a custom
  template, so one shared template serves many brokers and the requirement stays
  machine-checkable. (First instance of a broader "broker-specific request constraint"
  pattern; add a field rather than a custom template when the next one appears.)
- `template`: named body template (email channels).
- `trust`: a THREE-VALUE enum, `unverified | verified | broken` (NOT a boolean), plus
  `last_checked`, `source`, `verified_by`. Per-channel, not per-broker. `broken` preserves
  provenance on a channel that was verified and later failed (distinct from `unverified`,
  which means never-checked). All are project-assigned and never honored from a PR (see 5a).
  NOTE: channel-level `broken` (the opt-out path failed) is distinct from broker-level
  `status: broken` (the search failed) — the two halves of the search-vs-optout split.

**identity sub-block** (at optout level, applies to whichever channel is used):
- `required` (default false), `accepted[]`, `redact[]`, `notes`. Encodes withhold-by-
  default: most "ID required" fields are dark patterns; the CCPA request is usually
  honored without one.

**Transforms**: a small fixed set (`slug`, `q`/url-encode, `upper`, raw default). A lookup
table from name to a one-line function. NOT a templating language.

---

## 4. The profile

Raw atomic fields only; derived fields computed at runtime, never stored stale.

**Raw fields**
- Core (required for any match): `first`, `last`, `city`, `state`.
- Atomic name parts: `middle` (enables both first+last and first+middle+last layouts).
- Encouraged optional: `zip`, `age`.
- Confirmation/optional: `emails[]`, `phones[]`, `relatives[]`.
- `also_known_as[]`: former/maiden names and user-typed nicknames.

**age, not DOB, for v1.** Age + city does almost all the matching work at a fraction of
the sensitivity, and a local store of full DOBs is a worse honeypot. Add DOB later only
if precision demands it. Cost accepted: common-name users in big metros hit slightly more
"is this you?" ambiguity, which the human resolves in the confirm step.

**Derived fields** (compose-upward only): `name` (first+last), `name_full`
(first+middle+last, collapsing to first+last when no middle, single-space join),
`citystate` ("City, ST"), `citystatezip` ("City, ST ZIP").

**Derivation purity rule**: derivation is pure, deterministic formatting with ZERO
judgment. It only composes atoms upward, never decomposes. Anything requiring a judgment
call (nicknames, maiden names, "St." vs "Saint") is a user-entered raw field or the
confirm step's job, never a derived field. False negatives are the dangerous failure in a
privacy tool, and silent guesses cause them.

Split-field vs combined-field sites need no special handling: templates reference raw
atoms (`{first}`, `{last}`) or derived combinations (`{name}`, `{name_full}`) as the site
demands.

### 4a. Intake UX and persistence

The intake screen is the first thing the user sees: a privacy tool asking a worried person
for the exact data they're worried about. The design problem is "ask for personal data in a
way that feels like the opposite of what the brokers did." This governs the whole flow.

**First run is value-first, minimal-first, trust-before-sensitive-data:**
- First screen is NOT a form and NOT a manifesto. It states the bargain plainly (finds where
  you're listed, helps you ask for removal), the deal that makes it safe (nothing is stored
  or sent unless you choose), and ONE verifiable claim, not a vibe: the extension can only
  talk to broker domains you approve, checkable in Firefox's permissions and network tools.
  The local-only promise is a checkable architectural property, not marketing.
- Then a minimal core (first, last, city, state) runs a real tier-1 search and shows actual
  results. Small ask, immediate proof. The user sees the tool find them BEFORE being asked
  for anything sensitive. This deliberately undersells coverage on the first run; that's
  accepted, because a shallow run that earns trust beats a thorough one that scares the user
  off.

**Enrichment is "expand your coverage," never a second form:**
- Optional fields (age, zip, emails, phones, relatives, aka) are surfaced in-context via the
  coverage report's existing missing-field computation, each justified by the specific
  brokers/capability it unlocks ("9 more sites need your ZIP — add it?"), and only when it
  actually buys something for this user.
- NO-NAG RULE: the prompt states what's available to unlock and stops. A four-field user can
  stay a four-field user indefinitely; the gap is shown honestly but never pushed. Resist
  "improve activation" pressure later — the restraint is the product.

**Persistence: nothing is kept unless the user opts in. Three independent choices, all
default OFF.** Out of the box expurge persists nothing and transmits nothing (no asterisk).
1. **Profile storage** ("remember my info on this device"): default OFF. By default the
   profile lives in memory for the run and is gone when the run ends or the browser closes,
   re-entered per session. Opting in stores it in `browser.storage.local` (OS-protected, NOT
   extension-encrypted in v1 — do not imply encryption; passphrase-at-rest is a clean v2
   upgrade scoped to this opt-in). This same toggle enables **cross-session run resume**,
   because resuming requires the profile to persist; the run model's persisted-state /
   rehydrate / resume design (section 7) applies to opt-in users, while ephemeral users get
   a session-scoped run.
2. **Run metadata** (per broker: last-checked date + last result, NO PII): a SEPARATE,
   lighter opt-in, default OFF, offered AFTER the first run when it's concrete ("remember
   which brokers you checked and what you found — just dates and results, never your personal
   info"). Kept separate so a user can have progress-memory without storing their identity.
3. **Rich hits/drafts history**: session-scoped for ephemeral users, persists only under the
   profile-storage opt-in.

**The one intentional exit point, disclosed proactively**: data leaves the device only when
the user SENDS an opt-out request, which necessarily contains their info and goes to the
broker — that's the purpose, not a leak. Stated plainly rather than discovered: "your data
stays on your device; the only thing that ever leaves is the removal request you choose to
send, to the broker you're asking to remove you." Run metadata is NEVER transmitted
regardless of toggle; "store locally" must never become "send us." Consequence accepted: the
in-the-wild drift signal (section 5 re-verification) only comes from opt-in-metadata users
who choose to report it, never silent telemetry.

**Editing and deletion:**
- Core-field edits just update raw atoms; derived fields recompute at runtime (no stored
  derived state to invalidate — the purity rule paying off).
- A trivial, single-confirmation **"delete all my data"** wipes everything, as a deliberate
  contrast to broker deletion friction; this is the one place the tool makes deletion EASIER
  than the brokers do. Export pairs with it (export, then wipe, both one click). For the
  ephemeral default user this is nearly a no-op, which is the strongest version of the story.
- Profile edits never silently rewrite history but make stale history visible: a *widening*
  edit (add ZIP/aka/relative) leaves old hits and lets coverage show the new opportunity; a
  *correcting* edit (wrong city, moved) flags affected past hits as superseded ("your city
  changed since these results; re-run to refresh") rather than deleting or hiding them. (This
  applies to hits that still exist, i.e. within the session for everyone, and across sessions
  only for persisted users; the ephemeral default simply has no cross-session hits to flag.)

---

## 5. Verification model

Protects the user from the project's own dataset. Per-channel.

- Lifecycle (the `trust` enum): channels start `unverified` (LLM-drafted at dev time, or
  PR'd). Become `verified` only when a human opens the real opt-out page, runs the checklist
  (5a), and the project stamps `last_checked` + `source` + `verified_by` (the receipt). A
  channel that was verified and later fails flips to `broken` (preserving provenance),
  distinct from `unverified`. Only `verified` (and unexpired) passes the draft gate.
- **Check step is lenient**: a wrong search URL just wastes a click. Skip unverified by
  default; a setting allows including them.
- **Draft step is strict**: only a verified channel can produce a draft. No override. A
  wrong opt-out address mails PII to the wrong place.
- Note the two distinct status axes, kept separate deliberately: `status` (operational:
  attempt or not) vs channel `verified` (trust: act or not).
- **Re-verification: hard expiry, long window, graded warning.** A `verified` claim has a
  shelf life, because the strict-gate logic (a wrong opt-out address causes real harm) only
  strengthens with time as the address grows more likely to have drifted. "Verified 14
  months ago and untouched" is epistemically close to unverified, so it must stop unlocking
  the gate. Soft expiry (keep working, just flag it) was rejected: it keeps the flag
  looking honest while the truth decays silently, the exact failure to prevent.
  - **Warn at 6 months, expire at 12.** The warning window surfaces the work with runway
    (maintainer view + coverage flag "verified 7mo ago, expires in 5") so re-checks happen
    before the cliff.
  - **Expiry is computed live from `last_checked`, not a written state.** The gate's check
    is "verified AND `last_checked` within shelf life." No background job flips flags;
    staleness is derived on every gate evaluation, so it can never get out of sync. An
    expired channel is NOT deleted or reset to `unverified` (that would lose provenance and
    the prior `source`); it simply stops satisfying the gate until re-checked.
  - **User-facing**: an expired broker shows in coverage as "needs re-checking, temporarily
    unavailable" (a maintenance state), never a silent vanish, never an alarm.
  - **Triggers**: v1 ships TIME-BASED EXPIRY as the SOLE re-verification trigger (self-
    contained, needs nothing from users, keeps the dataset honest on its own). The
    observed-in-the-wild failure trigger (aggregate `load_error`/`challenge` signalling drift
    before the calendar would) and its reporting mechanism are DEFERRED TO v2 — leaning
    toward a user-initiated "report this failure" button (explicit, no PII, no silent
    telemetry). v1 has no implementation path for it and shouldn't build one; it activates
    alongside the trusted-verifier tier at the same scale point.
  - **Re-verification is the same checklist** (5a). Its load is the signal for when to
    activate the deferred trusted-verifier tier: delegation turns on when re-check cost
    crosses what one person can carry, not on a guess.

**Verification mechanics (how the act is performed and recorded).** Verification is
*judgment* (eyes on the live page), not data entry; tooling can capture verdicts but can't
do the looking. So v1 keeps it manual and adds correctness guardrails rather than a guided
app:
- **v1: hand-edit the JSON.** The ~25-site launch pass is itself the requirements-gathering
  for any future tooling; building a guided tool first would target imagined friction.
- **CI schema validator from day one (double duty):**
  - *Correctness*: rejects malformed records (a `trust: verified` with no `source`, a future
    or malformed `last_checked`, an `email` channel missing `target`, an unknown `kind` or
    `trust` value, etc.).
  - *Trust enforcement*: gates on the PR's diff and author. If a diff touches the trust
    bits (`trust` / `source` / `last_checked` / `verified_by`) and the author isn't the
    maintainer (or a future trusted-verifier identity), CI fails it. Contributed records
    must carry `trust: unverified` and null `source`/`last_checked`/`verified_by`; anything
    else from a non-privileged author is rejected with a clear "verification is
    maintainer-set; leave these blank" message. This makes "the project assigns
    verification, never a PR" mechanically unmergeable rather than a review-time promise.
- **Optional one-line stamp helper** (`verify <broker-id> <channel>`): sets `last_checked`
  to today, `verified_by` to the maintainer, prompts for the `source` URL, sets
  `trust: verified`. Removes the error-prone clerical bit (typo'd date in the gate's key
  field) without being the guided-checklist tool. Build only if hand-stamping chafes during
  the launch pass.
- **Deferred to v2 (with a hard caveat): wider, easier submission intake.** A web form so
  non-technical people can submit brokers without PR knowledge, with LLM-agent/script
  pre-filtering for spam and plausibility. CAVEAT, load-bearing: automated vetting filters
  the FRONT of the funnel (volume, plausibility, spam) but CANNOT perform verification,
  which is the human act of looking at the real page. A lower-friction, identity-less intake
  is a more attractive vector for malicious records (a plausible site with an attacker-
  controlled "opt-out email"), so submissions from any source land `unverified`, and a human
  still does the checklist before anything unlocks the gate. The web form and agents may
  widen and pre-filter intake; they must NEVER assign trust. The full guided-checklist tool
  also belongs here, built when the trusted-verifier tier activates (when consistency across
  multiple verifiers becomes the actual problem).

### 5a. Verification workflow (the human act the draft gate trusts)

Verification is the pre-launch critical path: the draft gate generates nothing from
unverified channels, so the launch blocker is a human verifying ~25 sites. It must be a
**fixed, written checklist, identical for the maintainer and every contributor**, or
`verified` degrades into "someone glanced at it once" and the gate's guarantee rots.

Principle: a verifier confirms **exactly the fields the draft step mechanically trusts, and
nothing it ignores.** Not display name, not tier (a wrong tier just misorders). Only the
fields that, if wrong, cause a real-world bad send. That keeps the checklist short, focused
on harm, and repeatable.

**Channel verification checklist** (open the broker's real opt-out page beside its record;
if any item can't be confirmed, the channel stays `unverified`):
1. **Opt-out target correct and current** — `target` matches the live page, typed
   character-for-character (the dangerous field; check it first).
2. **`kind` is honest** — `dedicated_optout` vs `general_contact` vs `form_required`. If the
   record says email but the site insists on the form, it's `form_required`; fix the record.
3. **Method actually works as stated** — email channel genuinely accepts email removals;
   web_form exists and loads.
4. **Required subject, if any** — record an exact required subject in `subject`; else leave
   empty (template default applies).
5. **Requester requirements** — listing URL in body, reference number, request-from-listed-
   email, etc., reflected in the record.
6. **Identity requirements, checked honestly** — `required` true ONLY if the site truly
   won't process without ID (offered/optional = false, withhold-by-default); `accepted` and
   `redact` match the page.
7. **Search template resolves (sanity check only)** — render the search URL for a test
   identity, confirm a real results page. See asymmetry note below.
8. **Stamp the receipt** — `source` = exact URL looked at; `last_checked` = today.

A channel is `verified` only when 1-6 and 8 hold.

**Who may verify, and how contributor trust works.** `verified` is exactly as security-
critical as the opt-out field it unlocks: it is the flag that lets the draft gate act on a
channel, so a false `verified` mails real PII to a wrong/attacker address. This is the same
trust-assertion problem the signing keys solve, one layer up (signing = "is this dataset
from the maintainer"; verification = "is this `verified` backed by a human who did the
checklist").
- **`trust`, `source`, `last_checked`, and `verified_by` are project-assigned, never
  honored from a PR.** The dataset is open source, so a PR can set any field; the project
  ignores a contributed `trust: verified`. Contributed records ALWAYS land
  `trust: unverified` regardless of what the PR claims. Contributors can submit everything
  else (broker, search template, opt-out channel, notes); the trust bits are stamped by the
  project's own verification act.
- **v1 is maintainer-only verification.** At ~25 sites the maintainer verifies personally,
  so delegation buys nothing yet and every delegation model adds human-trust overhead
  (vetting, granting, revoking) that is pure cost until contributors actually arrive.
- **`verified_by` is recorded from day one** (provenance), even though it just says the
  maintainer on every v1 record. This is the cheap-now-expensive-later hedge: when a
  trusted-verifier tier is added later, provenance already exists, so a now-distrusted
  verifier's records can be found and re-checked (the human analogue of key rotation).
  Without the field, widening the circle later means you can't audit who vouched for what.
- Future tiers, designed-for-not-built: a **trusted-verifier** set (vetted contributors who
  may verify, like maintainers with merge rights) and, only if ever justified,
  **two-person ratification** (a second trusted human re-runs the checklist). Both are
  policy changes later, not schema migrations, because `verified_by` is already present.

**Search is a sanity check in v1, not a second formal flag.** Opt-out and search fail
independently and have different fixes, so they are conceptually separate verification acts.
But the harm is asymmetric: a wrong opt-out target mails PII to the wrong place (strict,
gated `verified`), while a wrong search URL just shows a dead page the user notices instantly
and a self-correcting false "not listed." So search gets a quick does-it-resolve glance
during the same pass plus `status: broken` as its safety valve, NOT its own `verified` flag.
Promote search to a formal flag only if search-rot later becomes a frequent, costly problem.
General rule this illustrates: build heavy trust machinery only for the failure that
actually causes harm.

---

## 6. The draft gate

A `.eml` (or instruction card) is produced for a broker ONLY when, as one composed check:
1. The broker is a confirmed hit.
2. The selected optout channel has `trust: verified` AND is not expired (12-month shelf
   life, computed live from `last_checked`). No override.

**Channel selection**: walk the optout list in order, take the first channel whose
`trust` is `verified` (and unexpired). The channel's `method`/`kind` then determines the
OUTPUT, not whether it's selected: an email channel yields a draft (mailto/.eml/copy-paste);
a `form_required` channel yields an instruction card (open this URL, paste these values); a
`general_contact` email yields a draft flagged best-effort. So a verified web_form-only
broker IS handled in v1 (as an instruction card), not skipped. If no channel is verified
(all `unverified`/`broken`/expired), no draft; the broker shows in coverage as such.

**ID handling shapes the draft body, never gates it.** The tool NEVER stores, redacts,
attaches, or reads an ID document. `required: false` -> draft doesn't mention ID.
`required: true` -> draft instructs the user to attach their own self-redacted copy
(black out `redact[]`, include only `accepted[]`) from their own client. No local
redaction helper is built.

**Body templates: two for v1.** A general US opt-out/deletion template, and a California
CCPA template citing CA deletion rights. Selection is auto-by-`state`: California gets the
CCPA template plus a **DROP informational notice** (California's free state tool removes you
from registered data brokers in one request; expurge covers the public people-search sites,
a different and overlapping set, so a Californian may want both — DROP and expurge are
complementary, not redundant). Everyone else gets the general template. A channel's optional
`subject` field overrides the template's default subject. Per-broker or per-state templates
are avoided (maintenance sprawl); add a third only with a concrete reason. PRE-LAUNCH
VERIFY: the CCPA template's legal language against current statute, and the ~25 sites
cross-referenced against the public DROP registry to size overlap for the notice wording.

---

## 7. Run model and UX (on-page overlay)

> **Superseded surface (2026-07-01):** the on-page overlay described below is being replaced
> by a Firefox native **sidebar** — a persistent, run-wide checklist that drives navigation
> (open-tab batching, deferred "come back later" state, focus-coupled active item, per-broker
> `search.guidance`). See **`plan/sidebar-nav.md`** and wherefore `2026-07-01-sidebar-run-navigation`
> (resolves Q-013). The *semantics* below still hold — four verdicts (hit/clear/unknown/skip),
> results-vs-details classification, challenge handling, the no-data-injection invariant, the
> no-wedge rule — but they now render in the sidebar, not an injected overlay. This section is
> kept for that carried-over detail; the surface is authoritative in `sidebar-nav.md`.

The v1 spine is **open-and-confirm with an on-page overlay**, all input in the browser, no
terminal, no separate app. A "run" expands the profile across enabled brokers (and aka
variants), opens search URLs as tabs in paced batches, lets the content script classify
and overlay each page, collects verdicts, and ends with the coverage report.

**Run state survives background spindown; cross-session resume is opt-in.** The MV3
background is an event page that can spin down mid-run, so run state is a first-class object
(not just a background variable) and the background is a **stateless coordinator** that
rehydrates and writes back on every event. The unit of work is the **(broker x name-variant)**
item, each with status (pending / open / verdicted / errored), rendered URL, tab id when
open, and verdict. Two persistence scopes, matching 4a: for the ephemeral default user, run
state is session-scoped (survives a spindown so the run isn't lost mid-session, but dies with
the browser, consistent with "nothing persisted"); for the profile-storage opt-in user, run
state persists to `storage.local` so a 25-site multi-session run is **resumable** after a
browser close. Resume-across-sessions is part of what the storage opt-in buys.

**Run identity and tab handling.** A run is identified by a UUID generated at creation plus
a separate `created_at` timestamp (not a sequential integer). `tab_id` is live-session
scratch ONLY: it is never written to durable storage. On any resume, `open` items drop
their tab and revert to `pending` to be reopened fresh, while verdicted items keep their
verdicts. The work-item list is the durable truth; tabs are disposable. This makes
recycled-tab-id hazards (acting on a tab id reassigned to an unrelated page in a new
session) structurally impossible.

**Run section states** (options page, Run tab):
- **Welcome/pitch** (no profile set): pitch + verifiable privacy claim + "Set up your profile →" CTA navigates to Profile. No form in Run.
- **Ready** (profile set, no active run): profile summary + "Start run" button. No auto-start. Shows link to prior results if any.
- **Active run**: run monitor + pause/stop controls (see below). Progress indicator "N of M checked."
- **Done**: summary ("Found on X, not found on Y, Z couldn't be checked" — in broker-units) + "View Results →" + "Run again" button. Includes low-key dataset-age notice if auto-update is disabled and list is > 30 days old.

**Run monitor** (active state): one row per broker (not per work item). AKA name-variants fold into the broker's row. Rows ordered: currently checking first, then pending, then completed. Full list always visible; no "current batch only" truncation.

**Toolbar badge**: shows hit count (integer) during an active run. Zero hits: no badge. Run complete: badge clears.

**Pacing: paced-automatic with a one-batch ceiling.** Batches (default 5, fixed in v1) open
automatically, but the next batch never opens until the current one is fully **cleared**.
So at most one batch of tabs is ever open; the system never races ahead of the user or
piles up tabs while they're away. **Pause**: stops opening new batches; current open batch finishes naturally; run stays paused — does NOT auto-unpause when the batch clears. **Stop**: immediately marks all `open` and `pending` items `skipped/run_stopped`; shows "Close open tabs?" inline (not modal).

**No-wedge rule**: an item counts as cleared by a verdict OR a skip OR a park (error /
challenge). Nothing can wedge a run on a stuck item.

**Verdict contract: storage is truth, messages propose, acks confirm, writes are
idempotent.** On a verdict click the content script sends the verdict and waits for an
explicit ack that it was written; until then the overlay shows "saving", then "recorded".
No ack within a timeout -> retry (safe, because the write is keyed by item id and
idempotent). The background writes to storage THEN acks, so an ack provably means the
verdict survived; a spun-down background wakes and rehydrates fresh, never acting on stale
memory. Overlay therefore has three states: unjudged / saving / recorded.

**Closing a tab without a verdict = `skipped` with reason `tab_closed`** (background
watches `tabs.onRemoved`). Under the no-wedge rule this counts as cleared, so closing a
tab is a valid, fast way to dismiss a site. The absence of a verdict on a closed tab is
itself recorded, so nothing is lost.

**Page classification is shallow-first; the human is the matcher.** The content script
does NOT do per-site field extraction in v1 (per-site selectors are the most brittle thing
in the project and would turn broker verification into selector maintenance). It makes
only two CROSS-SITE automatic classifications:
- **Challenge detection**: recognizes the handful of challenge vendors (Cloudflare /
  Turnstile / hCaptcha / reCAPTCHA / DataDome) via shared, centrally-maintained signals,
  not per-broker rules. Overlay says "solve this and I'll appear"; a MutationObserver makes
  the overlay appear automatically once the human solves it and real content loads.
  Unsolved during the run -> `skipped` reason `challenge`.
- **Load failure**: detected from the background via `webNavigation.onErrorOccurred` (the
  content script may not inject on a true error page). -> `skipped` reason `load_error`.

Every other loaded page gets NO deep parsing. The overlay appears and tells the human what
to look for, pulled from the broker's `exposes[]` ("look for your age, home address,
relatives. Listed?"), then offers FOUR verdicts: **yes (hit) / no (clear) / not sure
(unknown) / skip**. `unknown` is a real, distinct verdict ("I looked and genuinely can't
tell if this is me"), separate from skip; it feeds a disambiguation nudge in the coverage
report ("3 you couldn't tell on — add your middle name or ZIP to disambiguate"), which is
how the age-not-DOB ambiguity stays recoverable. No auto "no results" detection; the human
says clear. This collapses the old friendly/hostile tier distinction entirely: every broker
is just "a tab the human can see."

**Results page vs. details page: two-path overlay.** Most brokers open a *search results page* (e.g. `/results?name=…`) before the user navigates to their individual *profile/details page* (e.g. `/find/person/{id}`). The content script detects which it is by comparing `window.location.pathname` to the rendered search URL's path. On the **results page** it shows a *guidance panel* only ("Found yourself? Click 'View Details →' to open your profile, then confirm there") — no verdict buttons. On the **details/profile page** it shows the full four-button verdict panel.

Why no verdict buttons on the results page: if the user confirms from results, `window.location.href` at verdict time is the search URL, not the direct listing URL. Opt-out processes need the direct listing URL to find the specific record. The navigation requirement is also desirable independently — it lets the user verify their full profile before confirming a hit.

**`listingUrl` capture.** At verdict time on the details page, `window.location.href` is attached to the `VERDICT` message and stored as `listingUrl` on the `WorkItem`. `buildDraft()` threads it into the email body near the top: "The following profile contains my information and I am requesting its removal: [url]". `listingUrl` is optional end-to-end — if absent, the draft generates without the line.

**Paste-URL fallback (paywalled or inaccessible detail pages).** On the results page, below the main guidance, a collapsed section "Can't access the details page? →" reveals a URL paste field. Verdict buttons appear once the field is non-empty. A same-domain check shows an amber warning if the pasted URL doesn't match the broker's domain, but does NOT block the buttons — the warning is informational. `listingUrl` is set to the pasted value. This handles edge cases (paywalled profiles, URL-less search results) without blocking the primary path.

**Reserved enrichment (optional, later)**: the schema reserves a per-broker
extraction-hint block. When present AND verified, the content script may pre-extract fields
and show a confidence score on that specific site. Same graceful-degradation pattern as the
LLM: hints present -> richer overlay; absent -> human reads. Added later to the few
highest-value sites only; never blocks a broker.

**Permissions at run start.** All optional host permissions needed for a run are requested in a **single `browser.permissions.request()` call** at run start, not lazily per-broker. Firefox presents one dialog covering all needed domains. Denied domains are skipped that run with reason `permission_denied` (satisfies the no-wedge rule). Previously-granted permissions persist in Firefox and are not re-requested. `permissions.request()` requires a user gesture; the "Start run" click IS that gesture, so the call happens directly from the handler — no workaround needed. (Q-009 resolved by design.)

**Skip reasons**: `tab_closed`, `load_error`, `challenge`, `permission_denied`, `run_stopped`, `missing:<field>`.

**Results section** (options page, Results tab): four verdict groups.
- **Listed on** (hit): sites where the user was found. Action available: draft opt-out. Shown first.
- **Couldn't tell** (unknown): visited but unresolved. Not the same as clear; feeds the disambiguation nudge.
- **Skipped** (skipped): with per-item sub-reason. "Check skipped items (N)" button seeds a mini-run — a new run (new UUID), not a resume, using the skipped items as its list. Button label is reason-aware when all skips share one reason.
- **Not checked** (never opened): with per-item missing-field note pointing to Profile.
- **"Not listed" (clear) is collapsed by default**: for most users clears are the majority; surfacing 22 clears before 3 hits buries the actionable results. Toggle to expand.
- **Most recent run expanded**, prior runs collapsed and labeled by date. Prior run history visible only under the profile-storage opt-in.
- **Nudge pattern**: inline cards within "Not checked" tied to specific missing fields, each showing which brokers the field would unlock + "Add to profile →" CTA navigating directly to Profile. Shown at most once per gap; no-nag rule applies.

**End-of-run surfacing of skips.** Skips are grouped BY REASON, each with a tailored
one-click remedy, framed as "what's left to finish", never as failure:
- `tab_closed` ("you closed these 6 before deciding") -> mini-run seeded from those items.
- `challenge` ("showed a verify-you're-human page") -> mini-run; the user can solve it now.
- `load_error` ("didn't load") -> mini-run to retry; repeated failures hint at a `broken`
  record (a maintainer signal in aggregate).
- `permission_denied` -> mini-run; the permissions dialog will re-prompt for denied domains.
  Mini-run is always a NEW run seeded from the prior run's skipped subset. Headline coverage
  stays in broker-units; only brokers with no verdict under ANY variant appear here.

---

## 8. Permissions and dataset distribution

**No `<all_urls>`.** A privacy tool requesting "read your data on all websites" is
self-defeating and lands on exactly the anxious user. Instead:
- **Optional, per-domain host permissions.** Host patterns are declared in
  `optional_host_permissions` (MV3; NOT `optional_permissions`, which is for API
  permissions). At run start, all needed domains are requested in a single
  `browser.permissions.request()` call from the "Start run" click handler (which IS the
  required user gesture — Q-009 resolved by design). Firefox shows one dialog for all
  domains. Denied domains are skipped with reason `permission_denied`. Previously-granted
  permissions persist in Firefox and are not re-prompted. Store listing can honestly say the
  extension only reads the broker sites the user approved.

**Dataset distribution is a hybrid:**
- A known-good dataset is **bundled** in the extension (signed and reviewed as a unit, so a
  fresh install works offline and is fully trustworthy on day one).
- A **remote update layer** on top, signed and verified, can refresh data and add brokers
  between releases WITHOUT store review.
- Data changes (opt-out address, URL templates, verification refreshes) ride the no-review
  path; they are data on a server, not code.
- A new broker domain still needs a runtime permission grant (consent), but still no
  review.

**Update trigger: the user chooses, default manual.** An options-page setting governs
whether the extension checks the server for broker-list updates automatically (on a
schedule) or only when the user clicks a "check for updates" button. **Default is manual /
opt-in**, because a privacy tool should not phone home by default; the kind of user who
reads permissions will notice if it does.
- The **first** fetch is gated behind an explicit consent prompt that also sets the
  auto/manual preference and discloses, in plain words, that the request sends nothing
  about the user. This prompt appears in the **Profile section** during initial profile
  setup (after the form fields, before the save CTA) — not in run-done state — so the user
  can fetch fresh data before their first run rather than after it. Prompt copy still needs
  legal review (Q-006). The bundled baseline means the extension works fully offline until then.
- **Auto-fetch cadence**: weekly, **lazy-triggered** — fires when the user opens the
  options page and ≥ 7 days have elapsed since the last fetch. No background fetch, no
  wake-on-schedule; the user must be present. After a completed run where auto-update is
  disabled and the broker list is > 30 days old, a single quiet line in the Run done state
  surfaces the staleness with a link to Settings. No repeated banner, no modal.
- The setting's label is scoped specifically to "broker list updates" and kept DISTINCT
  from Firefox's own auto-update of the extension **code** (managed by the user in Firefox,
  not by expurge). The signature verification path is identical regardless of the toggle;
  only timing and who-initiates change. Caveat to remember: a user who disables Firefox's
  add-on code updates also opts out of security fixes, including a signing-key rotation,
  which is a reason not to conflate the two in the UI.

### 8a. AMO compliance constraints (policy verified Apr 2026)

The design is well-aligned with Mozilla's privacy-first policies (no surprises, opt-in
data, minimal permissions, no remote code). The concrete build-time constraints:
- **Consent UI must be unmissable and single-page**: use a focused tab or the options page,
  NEVER a popup window (popups are auto-rejected). Declining must never be harder than
  accepting (no multi-step decline, no deceptive patterns). Applies to every consent /
  opt-in surface (first-fetch consent, persistence opt-ins).
- **The opt-out SEND likely qualifies for "implicit consent for self-evident single-use"**
  (policy 6.2.2.2): a user-initiated transmission from a single deliberate click on a
  clearly-labeled control. Do NOT add a separate consent dialog around the send — the
  labeled button plus a self-evident UI is the consent. Keep listing/UI self-evident about
  what is sent and to whom.
- **The overlay must NEVER inject the user's profile/identifying data into the page DOM**
  (policy 6.3: no leaking user-specific info to web content). The overlay shows generic
  guidance ("look for your age, address, relatives"), NOT the user's actual name/values
  rendered into the broker page where the page's own scripts could read them.
- Request only necessary permissions (policy 4); no `<all_urls>`. No remote code execution
  (the remote dataset is data, not code). Nothing from private-browsing sessions persists.
- Data-practices declared in the manifest via Mozilla's data-classification taxonomy,
  including the "no data collection" declaration (policy 6.2.1, requires Firefox 140+).

---

## 9. Signing and keys

The remote dataset carries the most dangerous field in the system (opt-out addresses), so
it must be **signed, not merely checksummed.** A checksum proves the bytes arrived intact;
it proves nothing about authorship, and a server compromise can swap both the file and its
hash. A signature is asymmetric: verifying does not let you produce.

**Mechanism (Ed25519):**
- Keypair generated once. **Private key never leaves a protected store**; it signs each
  `brokers.json` (hash the bytes, sign the hash -> detached `brokers.json.sig`).
- **Public keys are source code**, committed in plaintext in a `TRUSTED_PUBKEYS` constant,
  baked into every signed/reviewed build. They are not a per-release parameter and not
  secret. Their protection comes from living inside the reviewed package.
- On fetch, the extension downloads `brokers.json` + `.sig`, and BEFORE trusting any field
  verifies the signature against the bundled public key via Web Crypto
  (`crypto.subtle.verify`). Verify fails -> reject the whole download, fall back to
  last-known-good, surface a quiet notice. Then run the new-domain consent flow on the
  verified dataset.
- Result: the server holds data but no trust. Compromise costs availability at worst,
  never integrity.

**Two keys, primary + backup**, both trusted by the extension (verify accepts either):
- Primary signs in normal operation; lives as a CI secret.
- Backup lives in a **separate blast radius**: a hardware security key (preferred) or an
  isolated separate-account secrets manager. NOT the CI's own secret store (GitHub
  Secrets), NOT the same vault/account/pipeline as the primary, because the likeliest
  breach path is the build pipeline where the primary lives.
- **Compromise response is two-phase.** Switching TO the backup is seamless and needs no
  release (installs already trust it), so signing resumes immediately. REVOKING the dead
  key requires a release, because the trust list lives in the reviewed package and must
  not be server-mutable (or an attacker gets the same lever). Firefox auto-update makes
  propagation hours-to-days. After switching, ship a release that drops the dead key and
  seeds a fresh cold backup.
- Recovery procedure for retrieving/using the backup is written down at setup, not left as
  a someday-doc.

Optional v2 hardening (deferred): a signed key-generation / version-floor field carried
inside the signed dataset, letting a legitimate update tell honest clients to stop
accepting older generations, narrowing the revocation window without a release.

---

## 10. Storage, files, coverage

**Storage**: nothing is persisted by default (see 4a). By default the profile and rich
hits/drafts history are in-memory and session-scoped; nothing is ever transmitted. Three
independent opt-ins (all default off) govern persistence to `browser.storage.local`:
profile storage (also enables cross-session run resume), run metadata (minimal: per-broker
last-checked date + result, no PII), and rich hits/drafts history (rides the profile opt-in).
Export/import is a v1 feature for the users who persist; "delete all my data" is trivial and
single-confirmation (and nearly a no-op for the ephemeral default user).

**Hits**: session-scoped by default; persisted only under the profile-storage opt-in (4a).
Keyed by runs so re-checks stack over time. Each result has an outcome from a
closed set: `hit | clear | unknown | skipped` (with reason, e.g. `missing:zip`,
`unverified`, `not_enabled`). Carries `matched_as` (which name variant produced the hit).
The draft step reads only `hit` rows.

**Drafts (send mechanism)**: generated in JS, one per confirmed hit. The extension's job
ends at "here is the request, ready for you to send"; the actual send always happens in the
user's own mail surface, which is what keeps v1 in send-it-yourself territory and out of
authorized-agent obligations. The extension never touches an attachment in any path.

**Opt-out status tracking** ("Mark as sent / submitted"): below the send surfaces, a
lightweight tracking button records an `opted_out_at` timestamp on the hit record.
- Email channels: "Mark as sent" → "Sent — [date]" + reversible "Unmark." Applies to all
  email channels regardless of kind.
- form_required channels: an **instruction card** is generated instead of a draft email.
  The card shows the opt-out URL, copy-paste field values, and step-by-step instructions.
  "Mark form as submitted" → same timestamp semantics.
- `general_contact` channels: **amber callout at the top of the draft panel** before the
  draft body: "This site doesn't have a dedicated opt-out address. This goes to their
  general contact — results may vary and follow-up may be needed." Send surfaces still fully
  available; this is a disclosure, not a blocker.
- The timestamp is a display-only memory aid, not a legal record. Stored under the
  rich-history opt-in; ephemeral-default users see it for the current session only.

Three send surfaces are ALWAYS available per request, with the default chosen by a
**per-user "preferred send method" setting** (default `mailto:`):
- `mailto:`: opens the user's compose window pre-filled (to / subject / body). Smoothest
  desktop handoff when a default mail client exists. Cannot carry attachments; bodies have
  practical length/encoding limits across clients.
- `.eml` download (RFC 5322, via downloads API): opens in a desktop mail client as a
  ready-to-send draft, attachments and arbitrarily long bodies supported. Robust, but inert
  for webmail-only users (a file they may not know what to do with).
- copy-paste: composed address + subject + body with copy buttons. Ugliest but UNIVERSAL,
  the only surface that works for the Gmail-in-a-browser user. Always one click away as the
  floor.

ID-required brokers: `mailto:` works IF the user attaches their own self-redacted ID in
their compose window before sending. To avoid the trap of redacting a sensitive document
and then hitting a dead `mailto:` (webmail user, no handler), the instructions are
**sequenced: open the request first and confirm the compose window opened, THEN redact and
attach.** `.eml` is kept available as the robust alternative for the longer ID-broker
bodies. Attach instructions appear in BOTH the draft body (a bracketed line near the top,
so they survive copy-paste into webmail) and the extension UI next to the send buttons
(with the specific `redact[]` fields).

**Coverage report**: counts BROKERS, not searches (aka fan-out is invisible at the headline
level). Shows checked X of Y; listed / clear / couldn't-tell; and a not-checked breakdown:
missing-info (with the single highest-value field to add, "add a ZIP to cover 7 more"),
unverified, broken, and "available but not enabled" (ungranted domains). "Checked" means
presented and a verdict was rendered.

**also_known_as fan-out**: an aka entry is an alternate name substituted into the SAME
broker's search template, producing an additional search for that broker. The unit of
iteration is broker x name-variant. A hit under either name is a hit for the broker, and
`matched_as` records which. The generated draft references both names so the removal covers
the aka-indexed listing. Coverage still counts brokers, not searches.

---

## 11. Phasing

**v1 (Firefox extension):**
- Hand-curated ~25 people-search sites, all verified.
- Open-and-confirm with on-page overlay (four verdicts: hit/clear/unknown/skip); shallow-
  first page classification (challenge / load-error / normal), human is the matcher (no
  per-site extraction in v1).
- Paced batched tab opening (default 5).
- Draft generation behind the draft gate: three send surfaces (mailto default / .eml /
  copy-paste) for email channels, plus instruction cards for form-required and
  general-contact channels.
- Per-channel verification model.
- Coverage report.
- Enumerated optional per-domain host permissions with runtime consent.
- Bundled dataset baseline + signed remote update layer (Ed25519, dual-key).
- Ephemeral-by-default profile; three independent persistence opt-ins (all default off);
  export/import and trivial delete-all for users who persist.

**v2:**
- **Firefox mobile (Android).** The engine (dataset, matcher, storage, signing, draft
  generation) is built portable in v1, so mobile is an additive layer, not a rebuild. What
  needs a mobile-specific design is the run/confirm UX: phones are one-tab-at-a-time, so the
  batched-parallel-tabs desktop flow likely becomes a sequential one-site-at-a-time flow,
  and the overlay must be thumb-reachable without covering the content used to decide.
  Deferred so the desktop confirm UX (the most iteration-heavy part) isn't designed for two
  interaction shapes at once. NOTE: the mobile-specific `.eml`-fallback guardrail is NOT
  built in v1 (phantom requirement until mobile exists).
- Chrome port.
- Registered-brokers list with its own blind-send flow.
- **Easier / more automated matching** (explicit interest, with one hard caveat). Two
  separable directions: (a) **local-LLM extraction** as the natural successor to shallow-
  first, handing the loaded page's text to a local model instead of authoring brittle
  per-site selectors, preserving privacy as long as the model stays local; and (b) an
  **MCP server an LLM agent could connect to**. CAVEAT on (b): the thing that makes the
  extension clean is that a HUMAN navigates and the script rides along. An agent that
  autonomously drives broker pages reopens the bot-detection wall, even from inside the
  extension. So the viable shape is "LLM assists the human still in the loop" (reads the
  page the human opened, proposes a verdict), not "agent runs unattended." Any automation
  here must preserve the human-navigates property.
- Per-broker extraction hints (the reserved enrichment block) for the highest-value sites.
- Decoupled-clock / background auto-fetch enhancements where applicable.
- Possibly the signed version-floor hardening.

**Later:**
- Follow-up / re-check scheduling.
- Broader dataset growth.

---

## 12. Open decisions (still to resolve)

1. **Dataset fetch consent copy**: cadence resolved (weekly, lazy-triggered); the exact
   consent-prompt copy still needs legal review before shipping (Q-006).
2. **CCPA template legal language** and ~25-site cross-reference against California DROP
   registry — pre-launch verify (Q-010).
3. **Local-LLM extraction in an extension** (v2): reaching a localhost model endpoint from a
   content/background script needs a localhost host permission and CORS config. Viability to
   confirm (Q-003).

**Verify against live docs (agent tasks, not from memory):**
- ~~Mozilla data-classification taxonomy format~~ — verified against MDN before M0;
  implemented as `browser_specific_settings.gecko.data_collection_permissions: { required: ["none"] }` (Q-008 resolved).
- ~~`browser.permissions.request()` user gesture~~ — requires gesture; resolved by design
  (Start button click IS the gesture; Q-009 resolved).
- Pre-launch: CCPA template legal language vs current statute; ~25 sites cross-referenced
  against the public California DROP registry (Q-010, still open).

Resolved in design phase: MV3 + Firefox-140+/data-taxonomy (Q-008); four-button overlay
with `unknown`; channel `trust` enum (three-value, not boolean); two templates (general +
CA CCPA) + DROP notice auto-by-state; run identity (UUID + `created_at`) and stale-tab-id
rule; drift deferred to v2 (time-expiry sole v1 trigger); AMO compliance constraints (§8a);
permissions.request() by design (Q-009); UX split (popup = control panel, options page =
primary UI, four nav sections); run section four states (welcome/pitch/ready/active/done);
run monitor (one row per broker, AKAs folded); results section (four verdict groups, clear
collapsed, nudge-to-Profile, mini-run from skipped items); opt-out status tracking
("Mark as sent/submitted"), form_required instruction card, general_contact amber callout;
all-at-once permissions at run start; first-fetch consent in Profile section; weekly
lazy auto-fetch cadence (Q-006 cadence half).