export type Verdict = 'hit' | 'clear' | 'unknown' | 'skipped';
export type SkipReason =
  | 'tab_closed'
  | 'challenge'
  | 'load_error'
  | 'run_stopped'
  | 'permission_denied'
  | `missing:${string}`;
export type WorkItemStatus = 'pending' | 'open' | 'verdicted';

export interface WorkItem {
  id: string;              // "{brokerId}:{nameVariant}"
  brokerId: string;
  nameVariant: string;
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

export interface Profile {
  first: string;
  last: string;
  city: string;
  state: string;
  middle?: string;
  zip?: string;
  age?: string;
  also_known_as?: string[];  // additional names to search, each as "First Last"
  relatives?: string[];
  emails?: string[];
  phones?: string[];
}

// ── messages popup/content → background ─────────────────────────────────────

export interface StartRunMsg    { type: 'START_RUN';    profile: Profile }
export interface GetRunStateMsg { type: 'GET_RUN_STATE' }
export interface GetDraftMsg    { type: 'GET_DRAFT';    itemId: string }
export interface GetItemMsg     { type: 'GET_ITEM' }
export interface VerdictMsg     { type: 'VERDICT'; itemId: string; verdict: Verdict; skipReason?: SkipReason; listingUrl?: string }
export interface SaveProfileMsg { type: 'SAVE_PROFILE'; profile: Profile }
export interface GetProfileMsg  { type: 'GET_PROFILE' }
export interface MarkSentMsg    { type: 'MARK_SENT';    itemId: string }
export interface DeleteAllMsg   { type: 'DELETE_ALL' }
export interface CloseTabMsg    { type: 'CLOSE_TAB' }

// ── messages background → content/popup ─────────────────────────────────────

export interface ItemInfoMsg {
  type: 'ITEM_INFO';
  itemId: string;
  brokerId: string;
  exposes: string[];
  renderedUrl: string;
  progress: { done: number; total: number; hits: number };
}
export interface AckMsg  { type: 'ACK';  itemId: string }
export interface PongMsg { type: 'PONG'; hasOverlay: boolean }

export interface PingMsg    { type: 'PING' }
export interface ReinjMsg  { type: 'REINJECT_OVERLAY'; tabId?: number }
export interface StopRunMsg { type: 'STOP_RUN' }

export type ToBackground =
  | StartRunMsg | GetRunStateMsg | GetDraftMsg | GetItemMsg | VerdictMsg
  | PingMsg | ReinjMsg | StopRunMsg | SaveProfileMsg | GetProfileMsg | MarkSentMsg | DeleteAllMsg | CloseTabMsg;
