export type Verdict = 'hit' | 'clear' | 'unknown' | 'skipped';
export type SkipReason = 'tab_closed' | 'challenge' | 'load_error';
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
}

// ── messages popup/content → background ─────────────────────────────────────

export interface StartRunMsg    { type: 'START_RUN';    profile: Profile }
export interface GetRunStateMsg { type: 'GET_RUN_STATE' }
export interface GetDraftMsg    { type: 'GET_DRAFT';    brokerId: string }
export interface GetItemMsg     { type: 'GET_ITEM' }
export interface VerdictMsg     { type: 'VERDICT'; itemId: string; verdict: Verdict; skipReason?: SkipReason }

export type ToBackground =
  | StartRunMsg | GetRunStateMsg | GetDraftMsg | GetItemMsg | VerdictMsg;

// ── messages background → content/popup ─────────────────────────────────────

export interface ItemInfoMsg {
  type: 'ITEM_INFO';
  itemId: string;
  brokerId: string;
  exposes: string[];
}
export interface AckMsg { type: 'ACK'; itemId: string }
