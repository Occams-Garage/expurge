export type Verdict = 'hit' | 'clear' | 'unknown' | 'skipped';
export type SkipReason =
  | 'tab_closed'
  | 'challenge'
  | 'load_error'
  | 'run_stopped'
  | 'permission_denied'
  | `missing:${string}`;
// pending → not yet opened. open → tab open, holds a batch slot. deferred → tab open but
// set aside (non-terminal, frees its slot, revisited at run end). verdicted → terminal.
export type WorkItemStatus = 'pending' | 'open' | 'deferred' | 'verdicted';

export interface WorkItem {
  id: string;              // "{brokerId}:{nameVariant}"
  brokerId: string;
  nameVariant: string;
  variantFirst: string;    // first name resolved for this variant, frozen at run time
  variantLast: string;     // last name resolved for this variant (may be empty for single-token AKAs)
  renderedUrl: string;
  status: WorkItemStatus;
  tabId?: number;          // live-session scratch only — never written to durable storage
  verdict?: Verdict;
  skipReason?: SkipReason;
  listingUrl?: string;     // direct profile page URL captured at verdict time
  matchedAs?: string;      // nameVariant that produced a hit (populated on hit verdict)
  optedOutAt?: string;     // ISO timestamp set when user marks opt-out as sent
}

export interface RunState {
  runId: string;           // UUID
  createdAt: string;       // ISO timestamp
  completedAt?: string;    // stable ISO timestamp, written once when every item is terminal
  items: WorkItem[];
  windowId?: number;       // window the run is pinned to (§Decision 7). Session-only, but —
                           // unlike tabId — a windowId isn't a recycled-id hazard, so it's
                           // safe to persist in session storage (survives spindown).
}

// Run progress counts, computed by coordinator.progressOf and shared by every readout
// (popup, options, sidebar, ITEM_INFO). `done`/`total` exclude `missing:` skips; `deferred`
// counts toward `total` but not `done`.
export interface RunProgress { done: number; total: number; hits: number }

// One additional name to search, captured as separate atomic fields (mirrors the
// primary name, which requires both first and last). middle is stored but not yet
// used in search URLs — see normalizeAkas.
export interface AkaName {
  first: string;
  middle?: string;
  last: string;
}

export interface Profile {
  first: string;
  last: string;
  city: string;
  state: string;
  middle?: string;
  zip?: string;
  age?: string;
  also_known_as?: AkaName[];  // additional names to search
  relatives?: string[];
  emails?: string[];
  phones?: string[];
}

// The three persistence opt-ins (M8), all default OFF. Everything is ephemeral
// (storage.session) until the user opts in; each flag promotes a slice to storage.local.
// richHistory "rides" profileStorage — it can only be on when profileStorage is on
// (enforced in mergeStoragePrefs / applyStorageOptIn, the single home for that invariant).
export interface StoragePrefs {
  profileStorage: boolean;  // persist profile to storage.local; also enables cross-session run resume
  runMetadata: boolean;     // per-broker last-checked date + result, no PII (independent of profileStorage)
  richHistory: boolean;     // current-run hits/drafts history; rides profileStorage
}

// The durable, PII-free summary of the latest completed check for each broker. Deliberately
// excludes run/profile identifiers, variants, URLs, skip reasons, and opt-out timestamps.
export type BrokerRunResult = 'hit' | 'clear' | 'unknown' | 'skipped';

export interface BrokerRunMetadata {
  checkedAt: string;
  result: BrokerRunResult;
}

export type RunMetadata = Record<string, BrokerRunMetadata>;

// Contextual storage offers are keyed by the preference they introduce. Keep this union
// explicit instead of coupling it to every future StoragePrefs key: adding a preference must
// not silently add a new durable prompt field without its own product decision.
export type StoragePromptId = 'profileStorage' | 'runMetadata' | 'richHistory';
// The seen record is durable but non-sensitive: exactly these booleans, no context payload.
export type StoragePromptsSeen = Record<StoragePromptId, boolean>;

// ── messages popup/content → background ─────────────────────────────────────

export interface StartRunMsg    { type: 'START_RUN';    profile: Profile; windowId?: number }
export interface GetRunStateMsg { type: 'GET_RUN_STATE' }
export interface GetDraftMsg    { type: 'GET_DRAFT';    itemId: string }
export interface VerdictMsg     { type: 'VERDICT'; itemId: string; verdict: Verdict; skipReason?: SkipReason; listingUrl?: string; windowId?: number }
export interface ReverdictMsg   { type: 'REVERDICT'; itemId: string; verdict: Verdict; listingUrl?: string }
export interface SaveProfileMsg { type: 'SAVE_PROFILE'; profile: Profile }
export interface GetProfileMsg  { type: 'GET_PROFILE' }
export interface MarkSentMsg    { type: 'MARK_SENT';    itemId: string }
export interface DeleteAllMsg   { type: 'DELETE_ALL' }
export interface CloseTabMsg    { type: 'CLOSE_TAB'; windowId?: number }

// ── messages options → background: signed dataset updates (M7) ───────────────
// The host-permission grant for the data origin is requested in the OPTIONS click
// handler (it needs a user gesture); these messages drive the background-owned
// fetch/verify/store once that grant exists.
export interface CheckDatasetUpdateMsg  { type: 'CHECK_DATASET_UPDATE' }
export interface GetDatasetStatusMsg    { type: 'GET_DATASET_STATUS' }
export interface SetDatasetAutoFetchMsg { type: 'SET_DATASET_AUTOFETCH'; on: boolean }

// ── messages options → background: persistence opt-ins (M8) ──────────────────
// Opt-in flags gate whether run/profile persist to storage.local. The SET path has
// background-only migration side effects (move data between areas, purge on opt-out),
// so the options page routes through these rather than writing the pref key itself.
export interface GetStoragePrefsMsg { type: 'GET_STORAGE_PREFS' }
export interface SetStorageOptInMsg { type: 'SET_STORAGE_OPTIN'; key: keyof StoragePrefs; on: boolean }
export interface GetRunMetadataMsg   { type: 'GET_RUN_METADATA' }
export interface GetStoragePromptsSeenMsg { type: 'GET_STORAGE_PROMPTS_SEEN' }
export interface MarkStoragePromptSeenMsg {
  type: 'MARK_STORAGE_PROMPT_SEEN';
  prompt: StoragePromptId;
  // Session-lifetime deletion fence. DELETE_ALL advances it so an offer rendered just before a
  // cross-tab clear cannot race in afterward and recreate the seen key.
  epoch: number;
}
// Re-open a persisted run's in-flight tabs after a browser restart (user-gestured, since
// it opens broker tabs and needs a window to pin to). windowId is the resume-click's window.
export interface ResumeRunMsg       { type: 'RESUME_RUN'; windowId?: number }

// ── messages sidebar → background ───────────────────────────────────────────
// The sidebar lives in its own document (not a broker tab), so it can't rely on
// `sender.tab` to identify the run — it passes the pinned `windowId` explicitly.

export interface SidebarGetStateMsg   { type: 'SIDEBAR_GET_STATE';   windowId: number }
export interface DeferMsg             { type: 'DEFER';               itemId: string; windowId: number }
// One message for both a checklist row click and the revisit button (revisit = FOCUS_ITEM on
// the first deferred item). The sidebar can't focus a tab itself (tab ids are background-only),
// so it names the item and background activates its tab.
export interface FocusItemMsg         { type: 'FOCUS_ITEM';          itemId: string; windowId: number }
export interface NavigateBrokerTabMsg { type: 'NAVIGATE_BROKER_TAB'; windowId: number; itemId: string; url: string }

// ── messages content → background ───────────────────────────────────────────
// The headless content script only reports whether a bot-challenge is up; the
// human casts every verdict from the sidebar, so no per-tab identity is needed.

export interface ChallengeDetectedMsg { type: 'CHALLENGE_DETECTED' }
export interface ChallengeResolvedMsg { type: 'CHALLENGE_RESOLVED' }

// ── messages background → content/popup ─────────────────────────────────────

export interface ItemInfoMsg {
  type: 'ITEM_INFO';
  itemId: string;
  brokerId: string;
  exposes: string[];
  guidance?: string;   // broker's generic search.guidance note, when present (results-state)
  renderedUrl: string;
  progress: RunProgress;
}
export interface AckMsg  { type: 'ACK';  itemId: string }

export interface StopRunMsg { type: 'STOP_RUN' }

export type ToBackground =
  | StartRunMsg | GetRunStateMsg | GetDraftMsg | VerdictMsg | ReverdictMsg
  | StopRunMsg | SaveProfileMsg | GetProfileMsg | MarkSentMsg | DeleteAllMsg | CloseTabMsg
  | SidebarGetStateMsg | DeferMsg | FocusItemMsg | NavigateBrokerTabMsg | ChallengeDetectedMsg | ChallengeResolvedMsg
  | CheckDatasetUpdateMsg | GetDatasetStatusMsg | SetDatasetAutoFetchMsg
  | GetStoragePrefsMsg | SetStorageOptInMsg | GetRunMetadataMsg
  | GetStoragePromptsSeenMsg | MarkStoragePromptSeenMsg | ResumeRunMsg;

// ── sidebar view model ──────────────────────────────────────────────────────
// The sidebar's display is derived purely from run state + focus (src/sidebar/state.ts).

// Which half of a broker's flow the focused tab is on: the results listing (show guidance)
// or a details/profile page (show the verdict cluster).
export type PageType = 'results' | 'details';

// Everything the sidebar needs to render an active broker item — the ItemInfoMsg payload
// (sans message `type`) plus the derived page-type. `guidance` is present only when the
// broker defines search.guidance.
export interface ActiveItemInfo {
  itemId: string;
  brokerId: string;
  exposes: string[];
  guidance?: string;
  renderedUrl: string;
  pageType: PageType;
  progress: RunProgress;
}

// The sidebar's current display. The six resting views are produced by deriveView from run
// state + focus; `saving`/`recorded` are transient interaction states the UI layer sets
// imperatively around a verdict send (never derived), kept here for union completeness.
export type SidebarView =
  | { view: 'no-run' }
  | { view: 'guidance';  item: ActiveItemInfo }
  | { view: 'verdict';   item: ActiveItemInfo }
  | { view: 'challenge'; item: ActiveItemInfo }
  // The broker tab wandered off the broker's host (address bar, a link, a redirect). No
  // verdict/guidance controls — a listing can't be confirmed on, e.g., google.com.
  | { view: 'offsite';   item: ActiveItemInfo }
  | { view: 'revisit';   waiting: number; focusId: string | null; progress: RunProgress }
  | { view: 'done';      progress: RunProgress }
  // A stopped run is `isComplete` (everything's verdicted), but the run_stopped items were
  // abandoned, not checked — so `checked` excludes them (they're still counted in `total`).
  | { view: 'stopped';   checked: number; total: number; hits: number }
  | { view: 'saving';    item: ActiveItemInfo }
  | { view: 'recorded';  item: ActiveItemInfo };

// windowId scopes the push: runtime.sendMessage broadcasts to every open sidebar (one per
// window), so each sidebar ignores updates whose windowId isn't its own — an idle window's
// sidebar never adopts the run window's view.
export interface SidebarUpdateMsg { type: 'SIDEBAR_UPDATE'; windowId: number; view: SidebarView }
