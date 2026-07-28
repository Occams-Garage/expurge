# M8 persistence opt-ins, Phase 2 implementation plan

Date: 2026-07-27  
Plan item: `wherefore/plan/P-011-m8-persistence-opt-ins.md`  
Branch: `feat/p-011-m8-persistence-opt-ins-phase2`

## Outcome

Finish the two unwired persistence choices and introduce each choice in context:

1. Run metadata can persist a PII-free, per-broker "last checked + result" record
   independently of profile storage.
2. Rich results from the current run persist only when both profile storage and rich
   history are on.
3. Profile, run-metadata, and rich-history choices are offered once in the relevant
   Profile, Run-done, and Results contexts, with the actual consent controls kept in
   Settings.

The default remains ephemeral. No profile, search URL, name variant, listing URL, draft,
or opt-out timestamp may enter `storage.local` unless the opt-in governing it is on.

## Decisions this plan locks

### 1. Keep one current run, not a history archive

The 2026-07-27 decision limits rich history to the current run. Phase 2 will therefore
continue using the existing `expurge_run` record and will not introduce an array of past
runs or a second `expurge_history` model.

- Starting a new run replaces the previous current run.
- An incomplete run may live in `storage.local` when profile storage is on because it is
  the cross-session resume checkpoint.
- A completed run remains in `storage.local` only when rich history is also on.
- A completed run with rich history off moves to `storage.session`, so Results remains
  available for the current browser session and disappears on browser close.
- `expurge_history`, currently only a Phase 1 placeholder key, is removed from the planned
  schema. Cleanup may continue removing that key defensively for development builds.

This separates "resume unfinished work" from "remember completed results" without adding
the cross-run archive that was deferred to v2.

### 2. Run-storage routing is lifecycle-aware

| Profile storage | Rich history | Run state | Full run destination |
|---|---|---|---|
| off | forced off | incomplete or complete | `storage.session` |
| on | off | incomplete | `storage.local` for resume |
| on | off | complete | `storage.session` |
| on | on | incomplete or complete | `storage.local` |

`saveRun()` writes to the selected destination and removes the other copy. `loadRun()`
uses the same rules and must never resurrect a completed local run while rich history is
off. Profile reads retain the Phase 1 read-active-only, no-fallback rule.

Toggle migrations are serialized with all other run writes:

- Profile storage on: move the profile to local; move an incomplete run to local; leave a
  completed run in session unless rich history is on.
- Profile storage off: force rich history off; move profile and current run to session;
  purge all durable rich data.
- Rich history on: allowed only while profile storage is on; move the completed current
  run from session to local. An incomplete run is already local for resume.
- Rich history off: move a completed current run to session; retain an incomplete local
  checkpoint until it completes; remove any legacy history key.

The migration order remains populate destination, update the preference, then purge the
old copy. A crash must leave the old preference pointing to an intact copy.

### 3. Stamp completion once

Add `completedAt?: string` to `RunState`. A pure `stampCompletedAt(run, nowIso)` helper:

- adds the timestamp on the first transition to a complete run;
- leaves incomplete runs unstamped;
- preserves an existing timestamp through re-verdicts and mark-as-sent changes.

Every terminal path uses it: final verdict, tab-close/other skip, Stop, and an initially
complete run. This stable timestamp drives run metadata and prevents a later re-verdict
from pretending the broker was checked again.

### 4. Run metadata has a deliberately small schema

Store one object under `expurge_run_metadata`:

```ts
type BrokerRunResult = 'hit' | 'clear' | 'unknown' | 'skipped';

interface BrokerRunMetadata {
  checkedAt: string;
  result: BrokerRunResult;
}

type RunMetadata = Record<string, BrokerRunMetadata>; // broker id -> latest result
```

It contains no run id, profile field, name variant, URL, listing URL, skip reason, or
opt-out timestamp.

When a run completes, update each broker represented by at least one attempted item.
Exclude `missing:*`, `permission_denied`, and `run_stopped` items because those are not a
completed check. Other skipped outcomes represent an attempted check and roll up to
`skipped`.

Multiple name variants roll up with this precedence:

`hit > unknown > clear > skipped`

This matches the existing broker-level dashboard semantics: any hit makes the broker a
hit; uncertainty outranks a clear; a real clear outranks a failed attempt. Use the run's
stable `completedAt` for `checkedAt`.

Metadata updates occur only when the run-metadata opt-in is on. Enabling the opt-in from
the Run-done context backfills the current completed run. Turning it off removes the
entire metadata key immediately. A failed metadata write must not reject a verdict ACK or
wedge run advancement; it is best-effort ancillary persistence.

### 5. Surface metadata where it is useful

Add a typed `GET_RUN_METADATA` background message. The Settings Broker coverage rows show
the user's saved value when present, clearly distinguished from dataset verification:

> Your last scan: Listed · Jul 27, 2026

Labels are calm and closed-set: Listed, Not listed, Couldn't tell, or Skipped. No metadata
is shown when the opt-in is off or no saved value exists.

### 6. First-exposure banners inform; they do not toggle

The three contextual banners navigate to Settings -> Storage. They never change a
preference directly, never pre-check a box, and always provide an equally easy dismiss
action.

| Context | Eligibility |
|---|---|
| Profile | a profile exists and profile storage is off |
| Run done | at least one broker produced metadata and run metadata is off |
| Results | the current run has at least one hit and rich history is off |

Record a small, non-sensitive `expurge_storage_prompts_seen` object in `storage.local` so
each offer is shown once, not once per browser restart. It stores only three booleans and
is cleared by Delete all. No profile or run-derived value enters this record.

Mark a prompt seen when it is actually rendered. The CTA focuses the corresponding
Settings checkbox; the user still makes the choice there.

## File-level implementation

### Pure domain logic

- `src/shared/types.ts`
  - Add `RunState.completedAt`.
  - Add `BrokerRunResult`, `BrokerRunMetadata`, `RunMetadata`, and storage-prompt types.
  - Add typed GET/mark-seen background messages.
- `src/shared/persistence.ts` (new)
  - `stampCompletedAt()`.
  - `runStorageDestination()`.
  - `deriveRunMetadata()`, including attempted-item filtering and AKA rollup.
  - Stored-value coercion for run metadata and prompt-seen state.
- `src/shared/persistence.test.ts` (new)
  - Exhaustively cover the routing table, completion stamping, result precedence,
    exclusions, merge behavior, and malformed stored values.

Keep this module browser-free so it participates in the normal coverage gate.

### Background I/O and lifecycle

- `src/background/storage-prefs-store.ts`
  - Add read/write helpers for run metadata and prompt-seen state.
  - Keep failures isolated from verdict persistence.
  - Remove the unused new-history-key design; retain defensive cleanup if needed.
- `src/background/index.ts`
  - Replace the Phase 1 profile-driven run routing with lifecycle-aware routing.
  - Extract explicit-area run movement helpers used by `saveRun()` and toggle migration.
  - Stamp completion on every terminal path.
  - Persist metadata after completion when opted in.
  - Backfill metadata when its toggle turns on after a completed run.
  - Migrate completed rich data when rich-history or profile-storage changes.
  - Handle metadata and prompt-seen messages.
  - Preserve serial-write ordering and the no-wedge ACK contract.

### Options UI

- `src/options/index.html`
  - Add separate run-metadata and rich-history checkboxes to Settings -> Storage.
  - Add banner containers to Profile, Run-done, and Results.
  - Update the Storage introduction so the three privacy boundaries are not conflated.
- `src/options/index.ts`
  - Reflect all three normalized toggles.
  - Disable rich history until profile storage is on; explain the dependency.
  - Load and render saved broker metadata.
  - Render each eligible banner once and navigate its CTA to the relevant setting.
  - Reset toggles, metadata display, and prompt state after Delete all.
- `src/options/style.css`
  - Style banners and disabled/dependency text with existing semantic tokens only.
  - Maintain 44px targets and visible focus.

Do not add direct toggle controls to the contextual banners. Consent stays in the
dedicated Settings surface.

## Implementation slices

### Slice 1: pure contract

1. Add types and `completedAt`.
2. Add the routing, completion, and metadata reducers.
3. Add tests before I/O wiring.

Exit: the full storage matrix and broker rollup are executable specifications.

### Slice 2: lifecycle-aware current-run persistence

1. Rework `loadRun()` / `saveRun()` around the routing table.
2. Stamp all completion paths.
3. Add rich-history toggle migration and purge behavior.
4. Verify resume remains unchanged for incomplete runs.

Exit: rich history off never leaves a completed run durable, while incomplete opt-in runs
still resume.

### Slice 3: run metadata

1. Add metadata store helpers and messages.
2. Persist/merge metadata on completion without coupling it to the verdict ACK.
3. Backfill the current completed run when the toggle is enabled.
4. Render saved values in Broker coverage.

Exit: metadata works with profile storage off and contains no PII.

### Slice 4: settings and contextual offers

1. Add the two remaining checkboxes and dependency behavior.
2. Add the three one-time contextual banners.
3. Add prompt-seen persistence and keyboard/focus behavior.

Exit: all three choices are understandable, independent where promised, and non-nagging.

### Slice 5: verification and documentation

1. Run typecheck, tests, build, and coverage.
2. Perform the Firefox matrix below.
3. Update P-011, progress, and a wherefore decision/build log.

## Automated verification

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run coverage`

Required pure tests:

- all four run-storage destinations;
- completed local data ignored/purged when rich history is off;
- rich history forced off with profile storage off;
- completion timestamp written once;
- aggregate precedence across primary + AKA variants;
- missing, permission-denied, and run-stopped exclusions;
- skipped attempted checks included;
- metadata merge preserves brokers absent from the newest run;
- malformed storage values coerce safely;
- prompt eligibility and seen-state coercion.

The browser-bound store and entrypoints remain coverage-excluded. Their behavior is covered
by the manual matrix until Q-014 produces a Firefox e2e harness.

## Manual Firefox matrix

1. Fresh install: all three toggles off; profile and run exist only in session storage.
2. Profile storage on, active run: restart Firefox; Resume restores only unfinished items.
3. Profile storage on, rich history off: finish a run; local contains the profile but no
   completed run; Results remains until browser close.
4. Rich history on: finish a run; restart; the current completed Results and sent markers
   remain.
5. Start another run: the prior completed run is replaced, not archived.
6. Turn rich history off after completion: Results remains this session and the local run
   disappears.
7. Turn profile storage off: rich history turns off, profile/current run move to session,
   and no durable rich data remains.
8. Run metadata on with profile storage off: finish a run; restart; only broker id, date,
   and closed-set result remain in local storage.
9. Turn run metadata on from Run done: the just-finished run backfills immediately.
10. Turn either persistence toggle off: its durable slice is removed immediately.
11. Each contextual offer appears once, dismisses cleanly, and its CTA focuses Settings.
12. Import still validates and overwrites only the profile. Delete all resets every toggle,
    metadata row, prompt-seen flag, profile, run, and cached dataset.

## Non-goals

- No array of runs, prior-run accordion, or historical comparison.
- No run import/merge in Phase 2.
- No profile encryption or passphrase.
- No telemetry or upload of run metadata.
- No v2 drift reporting based on challenge/load failures.
- No M9 active-dataset display-path migration.

## Main risks to review during implementation

1. A final verdict moves a completed run from local to session before the UI reads it.
   `saveRun()` must write the destination before removing the source.
2. A toggle flip racing a verdict can create or delete the wrong copy. All migration stays
   inside `serialWrite`.
3. A stale completed local run must not reappear after rich history is off.
4. Metadata I/O must never reject a verdict ACK.
5. Enabling rich history must never silently enable profile storage; the dependency is
   explicit and user-controlled.
