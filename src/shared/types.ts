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
  items: WorkItem[];
}

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

// ── messages popup/content → background ─────────────────────────────────────

export interface StartRunMsg    { type: 'START_RUN';    profile: Profile }
export interface GetRunStateMsg { type: 'GET_RUN_STATE' }
export interface GetDraftMsg    { type: 'GET_DRAFT';    itemId: string }
export interface GetItemMsg     { type: 'GET_ITEM' }
export interface VerdictMsg     { type: 'VERDICT'; itemId: string; verdict: Verdict; skipReason?: SkipReason; listingUrl?: string; windowId?: number }
export interface ReverdictMsg   { type: 'REVERDICT'; itemId: string; verdict: Verdict; listingUrl?: string }
export interface SaveProfileMsg { type: 'SAVE_PROFILE'; profile: Profile }
export interface GetProfileMsg  { type: 'GET_PROFILE' }
export interface MarkSentMsg    { type: 'MARK_SENT';    itemId: string }
export interface DeleteAllMsg   { type: 'DELETE_ALL' }
export interface CloseTabMsg    { type: 'CLOSE_TAB'; windowId?: number }

// ── messages sidebar → background ───────────────────────────────────────────
// The sidebar lives in its own document (not a broker tab), so it can't rely on
// `sender.tab` to identify the run — it passes the pinned `windowId` explicitly.

export interface SidebarGetStateMsg   { type: 'SIDEBAR_GET_STATE';   windowId: number }
export interface DeferMsg             { type: 'DEFER';               itemId: string; windowId: number }
export interface NavigateBrokerTabMsg { type: 'NAVIGATE_BROKER_TAB'; windowId: number; url: string }

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
  progress: { done: number; total: number; hits: number };
}
export interface AckMsg  { type: 'ACK';  itemId: string }
export interface PongMsg { type: 'PONG'; hasOverlay: boolean }

export interface PingMsg    { type: 'PING' }
export interface ReinjMsg  { type: 'REINJECT_OVERLAY'; tabId?: number }
export interface StopRunMsg { type: 'STOP_RUN' }

export type ToBackground =
  | StartRunMsg | GetRunStateMsg | GetDraftMsg | GetItemMsg | VerdictMsg | ReverdictMsg
  | PingMsg | ReinjMsg | StopRunMsg | SaveProfileMsg | GetProfileMsg | MarkSentMsg | DeleteAllMsg | CloseTabMsg
  | SidebarGetStateMsg | DeferMsg | NavigateBrokerTabMsg | ChallengeDetectedMsg | ChallengeResolvedMsg;
