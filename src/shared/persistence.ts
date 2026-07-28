// Pure domain rules for M8 persistence. Browser storage I/O and lifecycle serialization live
// in the background; this module only decides what may be stored and reduces safe summaries.

import type {
  BrokerRunMetadata,
  BrokerRunResult,
  RunMetadata,
  RunState,
  StoragePrefs,
  StoragePromptId,
  StoragePromptsSeen,
  WorkItem,
} from './types';
import { isComplete } from '../background/coordinator';

export type RunStorageDestination = 'local' | 'session';

export const DEFAULT_STORAGE_PROMPTS_SEEN: StoragePromptsSeen = {
  profileStorage: false,
  runMetadata: false,
  richHistory: false,
};

// Stamp the first complete snapshot only. Returning the original object for a no-op makes it
// straightforward for callers and tests to distinguish a transition from an ordinary save.
export function stampCompletedAt(run: RunState, nowIso: string): RunState {
  if (!isComplete(run) || run.completedAt !== undefined) return run;
  return { ...run, completedAt: nowIso };
}

// Profile storage owns incomplete cross-session checkpoints. A completed run is durable only
// when rich history is also enabled; otherwise it remains session-scoped.
export function runStorageDestination(
  prefs: StoragePrefs,
  run: RunState,
): RunStorageDestination {
  if (!prefs.profileStorage) return 'session';
  if (prefs.richHistory || !isComplete(run)) return 'local';
  return 'session';
}

const RESULT_RANK: Record<BrokerRunResult, number> = {
  skipped: 0,
  clear: 1,
  unknown: 2,
  hit: 3,
};

function isExcludedAttempt(item: WorkItem): boolean {
  return item.verdict === 'skipped' && (
    item.skipReason === 'permission_denied'
    || item.skipReason === 'run_stopped'
    || (typeof item.skipReason === 'string' && item.skipReason.startsWith('missing:'))
  );
}

// Reduce primary + AKA work items into one result per attempted broker. The stable completion
// timestamp is shared by every broker in this run; an unstamped run cannot produce metadata.
export function deriveRunMetadata(run: RunState): RunMetadata {
  const completedAt = run.completedAt;
  if (!isIsoTimestamp(completedAt) || !isComplete(run)) return {};

  const results = new Map<string, BrokerRunResult>();
  for (const item of run.items) {
    if (item.status !== 'verdicted' || !item.verdict || isExcludedAttempt(item)) continue;

    const result: BrokerRunResult = item.verdict;
    const previous = results.get(item.brokerId);
    if (previous === undefined || RESULT_RANK[result] > RESULT_RANK[previous]) {
      results.set(item.brokerId, result);
    }
  }

  return Object.fromEntries(
    [...results].map(([brokerId, result]) => [
      brokerId,
      { checkedAt: completedAt, result },
    ]),
  );
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isBrokerRunResult(raw: unknown): raw is BrokerRunResult {
  return raw === 'hit' || raw === 'clear' || raw === 'unknown' || raw === 'skipped';
}

// Date.parse also accepts date-only strings, locale-shaped strings, and impossible dates that
// it silently normalizes. Durable metadata is produced by Date#toISOString, so accept only that
// UTC shape (with optional zero milliseconds for older hand-authored/dev values) and require an
// exact calendar round-trip.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isIsoTimestamp(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !ISO_TIMESTAMP.test(raw)) return false;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return false;
  const withMilliseconds = raw.includes('.') ? raw : `${raw.slice(0, -1)}.000Z`;
  return parsed.toISOString() === withMilliseconds;
}

function coerceBrokerRunMetadata(raw: unknown): BrokerRunMetadata | null {
  if (!isRecord(raw)) return null;
  if (
    !hasOwn(raw, 'checkedAt')
    || !hasOwn(raw, 'result')
    || !isIsoTimestamp(raw.checkedAt)
    || !isBrokerRunResult(raw.result)
  ) {
    return null;
  }
  return { checkedAt: raw.checkedAt, result: raw.result };
}

// Validate unknown durable data without throwing. Invalid broker entries are dropped
// independently so one corrupt value cannot hide otherwise usable metadata.
export function coerceRunMetadata(raw: unknown): RunMetadata {
  if (!isRecord(raw)) return {};
  const entries: Array<[string, BrokerRunMetadata]> = [];
  for (const [brokerId, value] of Object.entries(raw)) {
    const metadata = coerceBrokerRunMetadata(value);
    if (metadata) entries.push([brokerId, metadata]);
  }
  return Object.fromEntries(entries);
}

// A completed run updates only the brokers it attempted. Brokers absent from the new run keep
// their previous "last scan" value.
export function mergeRunMetadata(stored: unknown, newest: unknown): RunMetadata {
  return Object.fromEntries([
    ...Object.entries(coerceRunMetadata(stored)),
    ...Object.entries(coerceRunMetadata(newest)),
  ]);
}

// Missing and malformed values default independently to false. This deliberately ignores all
// unknown keys so the normalized value contains only the three non-sensitive booleans.
export function mergeStoragePromptsSeen(raw: unknown): StoragePromptsSeen {
  const record = isRecord(raw) ? raw : {};
  return {
    profileStorage: hasOwn(record, 'profileStorage') && record.profileStorage === true,
    runMetadata: hasOwn(record, 'runMetadata') && record.runMetadata === true,
    richHistory: hasOwn(record, 'richHistory') && record.richHistory === true,
  };
}

export function markStoragePromptSeen(
  raw: unknown,
  prompt: unknown,
): StoragePromptsSeen {
  const seen = mergeStoragePromptsSeen(raw);
  return isStoragePromptId(prompt) ? { ...seen, [prompt]: true } : seen;
}

export function isStoragePromptId(raw: unknown): raw is StoragePromptId {
  return raw === 'profileStorage' || raw === 'runMetadata' || raw === 'richHistory';
}

export interface StoragePromptContext {
  profileExists: boolean;
  run: RunState | null;
}

// Context offers inform but never mutate preferences. Callers mark an eligible prompt seen
// only after it has actually rendered.
export function isStoragePromptEligible(
  prompt: StoragePromptId,
  prefs: StoragePrefs,
  seen: StoragePromptsSeen,
  context: StoragePromptContext,
): boolean {
  if (seen[prompt] || prefs[prompt]) return false;
  switch (prompt) {
    case 'profileStorage':
      return context.profileExists;
    case 'runMetadata':
      return context.run !== null
        && Object.keys(deriveRunMetadata(context.run)).length > 0;
    case 'richHistory':
      return context.run?.items.some(item => item.verdict === 'hit') ?? false;
  }
}
