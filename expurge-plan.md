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
- TypeScript + WebExtensions API.
- **Background script**: holds run state and profile, iterates the dataset, opens broker
  tabs in paced batches, collects verdicts, runs draft generation, manages dataset
  fetch/verify.
- **Content scripts**: injected only on broker domains. Read the result page DOM, run the
  deterministic matcher, paint the on-page overlay, send the verdict back to background.
- **Popup / options page**: profile form, run dashboard, coverage report, export/import.

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
- `exposes[]`: data types the site publicly shows. Drives the confirm prompt and tells the
  analyzer which fields to try to extract. Descriptive, never gates.

**optout block — an ORDERED LIST of channels** (list position = preference; no explicit
order field). Each channel:
- `method`: `email | web_form | mail`.
- `target`: the email address or form URL.
- `kind`: `dedicated_optout | general_contact | form_required`. This is the safety field.
  It separates a real removal address from a footer "contact us" address from a
  form-only site, so email-as-fallback never silently mails PII to a `sales@` inbox.
- `template`: named body template (email channels).
- `verified`, `last_checked`, `source`: verification is **per-channel**, not per-broker.

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

---

## 5. Verification model

Protects the user from the project's own dataset. Per-channel.

- Lifecycle: records/channels start `unverified` (LLM-drafted at dev time, or PR'd).
  Become `verified` only when a human opens the real opt-out page and confirms method,
  target, and ID requirements, then stamps `last_checked` + `source` (the receipt). A
  changed site flips to `broken` and drops out of active use.
- **Check step is lenient**: a wrong search URL just wastes a click. Skip unverified by
  default; a setting allows including them.
- **Draft step is strict**: only a verified channel can produce a draft. No override. A
  wrong opt-out address mails PII to the wrong place.
- Stale tracking: a verified channel untouched ~6 months gets flagged for re-verification.

Note the two distinct status axes, kept separate deliberately: `status` (operational:
attempt or not) vs channel `verified` (trust: act or not).

---

## 6. The draft gate

A `.eml` (or instruction) is produced for a broker ONLY when, as one composed check:
1. The broker is a confirmed hit.
2. The selected optout channel is `verified`.

**Channel selection**: walk the optout list in order, take the first channel that is both
usable in v1 (email) and verified. A verified `form_required` channel yields an
instruction card (open this URL, paste these values), not an email. A verified
`general_contact` email is usable but flagged best-effort. If nothing is verified, no
draft; the broker shows in coverage as such.

**ID handling shapes the draft body, never gates it.** The tool NEVER stores, redacts,
attaches, or reads an ID document. `required: false` -> draft doesn't mention ID.
`required: true` -> draft instructs the user to attach their own self-redacted copy
(black out `redact[]`, include only `accepted[]`) from their own client. No local
redaction helper is built.

---

## 7. Run model and UX (on-page overlay)

The v1 spine is **open-and-confirm with an on-page overlay**, all input in the browser, no
terminal, no separate app. A "run" expands the profile across enabled brokers (and aka
variants), opens search URLs as tabs in paced batches, lets the content script classify
and overlay each page, collects verdicts, and ends with the coverage report.

**Run state lives in `browser.storage.local`, not in memory.** The MV3 background is an
event page that can spin down mid-run, so run state is a persisted, first-class object
keyed per run. The unit of work is the **(broker x name-variant)** item, each with status
(pending / open / verdicted / errored), rendered URL, tab id when open, and verdict. The
background script is a **stateless coordinator**: on any event it rehydrates from storage,
acts, writes back. This makes runs crash-resilient and **resumable** for free, which
matters because a 25-site run with aka fan-out is a multi-session activity.

**Pacing: paced-automatic with a one-batch ceiling.** Batches (default 5, tunable) open
automatically, but the next batch never opens until the current one is fully **cleared**.
So at most one batch of tabs is ever open; the system never races ahead of the user or
piles up tabs while they're away. A persistent run control (popup + indicator) shows
progress with **pause** (stop opening new, keep open tabs, stays resumable) and **stop**
(end run, offer to close the run's open tabs).

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
relatives. Listed?"), then hit / clear / skip. No auto "no results" detection; the human
says clear. This collapses the old friendly/hostile tier distinction entirely: every
broker is just "a tab the human can see."

**Reserved enrichment (optional, later)**: the schema reserves a per-broker
extraction-hint block. When present AND verified, the content script may pre-extract fields
and show a confidence score on that specific site. Same graceful-degradation pattern as the
LLM: hints present -> richer overlay; absent -> human reads. Added later to the few
highest-value sites only; never blocks a broker.

**End-of-run surfacing of skips.** Skips are grouped BY REASON, each with a tailored
one-click remedy, framed as "what's left to finish", never as failure:
- `tab_closed` ("you closed these 6 before deciding") -> one-click "reopen these" starts a
  mini-run over just that set.
- `challenge` ("showed a verify-you're-human page") -> reopen; the user can solve it now.
- `load_error` ("didn't load") -> reopen to retry; repeated failures hint at a `broken`
  record (a maintainer signal in aggregate).
  The completed run stays queryable/persisted, so "reopen just the skipped ones" is simply a
  new run seeded from the prior run's skipped subset. Headline coverage stays in
  broker-units; only brokers with no verdict under ANY variant appear here.

---

## 8. Permissions and dataset distribution

**No `<all_urls>`.** A privacy tool requesting "read your data on all websites" is
self-defeating and lands on exactly the anxious user. Instead:
- **Optional, per-domain host permissions.** Declared as `optional_permissions`, requested
  at runtime via `browser.permissions.request()`. A new broker domain triggers Firefox's
  native per-domain consent prompt. Decline -> that broker is "available but not enabled"
  in the coverage report, never checked. Store listing can honestly say the extension only
  reads the broker sites the user approved.

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
  about the user. The bundled baseline means the extension works fully offline until then.
- The setting's label is scoped specifically to "broker list updates" and kept DISTINCT
  from Firefox's own auto-update of the extension **code** (managed by the user in Firefox,
  not by expurge). The signature verification path is identical regardless of the toggle;
  only timing and who-initiates change. Caveat to remember: a user who disables Firefox's
  add-on code updates also opts out of security fixes, including a signing-key rotation,
  which is a reason not to conflate the two in the UI.

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

**Storage**: `browser.storage.local`. The profile and hits live here, never transmitted.
Because storage is bound to the browser profile, **export/import is a v1 feature** so users
can back up and move their data.

**Hits**: keyed by runs so re-checks stack over time. Each result has an outcome from a
closed set: `hit | clear | unknown | skipped` (with reason, e.g. `missing:zip`,
`unverified`, `not_enabled`). Carries `matched_as` (which name variant produced the hit).
The draft step reads only `hit` rows.

**Drafts (send mechanism)**: generated in JS, one per confirmed hit. The extension's job
ends at "here is the request, ready for you to send"; the actual send always happens in the
user's own mail surface, which is what keeps v1 in send-it-yourself territory and out of
authorized-agent obligations. The extension never touches an attachment in any path.

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
- Open-and-confirm with on-page overlay; content-script DOM read + deterministic matcher.
- Paced batched tab opening (default 5).
- `.eml` draft generation + form/general-contact instruction cards, behind the draft gate.
- Per-channel verification model.
- Coverage report.
- Enumerated optional per-domain host permissions with runtime consent.
- Bundled dataset baseline + signed remote update layer (Ed25519, dual-key).
- Export/import for backup.

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

1. **Draft output mechanism in the extension**: how a generated `.eml` reaches the user's
   mail client from inside Firefox (downloads API vs `mailto:` vs other), and what
   send-it-yourself feels like in practice. Next branch.
2. **Dataset fetch specifics** (trigger is decided: user-chosen, default manual,
   consent-gated first fetch): the schedule cadence for automatic mode and the exact
   consent-prompt copy still need pinning.
3. **Local-LLM extraction in an extension** (folded into the v2 automation note): reaching a
   localhost model endpoint from a content/background script needs a localhost host
   permission and CORS config. Deferred to v2; viability to confirm.
4. **Number of body templates**: lean 2-3 (generic CCPA, California-specific).
5. **MV2 vs MV3 on Firefox / current AMO review policy for content-reading extensions**:
   verify against current AMO docs before fixing the manifest shape (knowledge here may be
   stale).

Resolved since last consolidation: run model (section 7, fully designed) and the
auto/manual update trigger (section 8).