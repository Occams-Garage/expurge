// The I/O half of the persistence opt-ins (M8): read/write the opt-in flags and purge the
// durable slices they gate. The pure coercion/normalization logic lives in
// src/shared/storage-prefs.ts (unit-tested); this module is the thin imperative wrapper
// (imports the polyfill, touches storage.local) and is coverage-excluded like dataset-store.ts.

import browser from 'webextension-polyfill';
import type {
  RunMetadata,
  StoragePrefs,
  StoragePromptId,
  StoragePromptsSeen,
} from '../shared/types';
import {
  coerceRunMetadata,
  markStoragePromptSeen,
  mergeRunMetadata,
  mergeStoragePromptsSeen,
} from '../shared/persistence';
import { mergeStoragePrefs, DEFAULT_STORAGE_PREFS } from '../shared/storage-prefs';

// storage.local (durable). Kept separate from the options page's `expurge_prefs` (send-method),
// which is whole-object-overwritten by saveSendMethod — co-locating the flags would clobber them.
// A missing key coerces to all-OFF (ephemeral), so DELETE_ALL's local.clear() resets for free.
const KEY_STORAGE_PREFS = 'expurge_storage_prefs';
const KEY_RUN_METADATA = 'expurge_run_metadata'; // per-broker last-checked + result, no PII (Phase 2 writes it)
const KEY_STORAGE_PROMPTS_SEEN = 'expurge_storage_prompts_seen'; // exactly 3 non-sensitive booleans
const KEY_STORAGE_PROMPT_EPOCH = 'expurge_storage_prompt_epoch'; // session-only Delete-all fence
const KEY_HISTORY = 'expurge_history';           // rejected archive placeholder; cleanup only

export async function readStoragePrefs(): Promise<StoragePrefs> {
  try {
    return await readStoragePrefsStrict();
  } catch {
    // Fail-safe: loadRun/saveRun call this on every run read/write, so a storage.local error must
    // not throw (that would reject a verdict write → no ACK → the sidebar retries forever, wedging
    // the run). Degrade to the ephemeral default — run/profile stay in storage.session, the safe
    // fallback — rather than propagate.
    return DEFAULT_STORAGE_PREFS;
  }
}

// Destructive migrations/repair must distinguish "the user opted out" from "storage.local
// could not be read". Those callers use the strict form so a transient read failure aborts
// without purging durable data. Verdict/run reads use readStoragePrefs() above for no-wedge.
export async function readStoragePrefsStrict(): Promise<StoragePrefs> {
  const r = await browser.storage.local.get(KEY_STORAGE_PREFS);
  return mergeStoragePrefs(r[KEY_STORAGE_PREFS]);
}

export async function writeStoragePrefs(prefs: StoragePrefs): Promise<void> {
  await browser.storage.local.set({ [KEY_STORAGE_PREFS]: prefs });
}

// UI reads are fail-closed: malformed values and storage errors both appear as no metadata.
// The caller separately checks the opt-in, so a stale key is never exposed while opted out.
export async function readRunMetadata(): Promise<RunMetadata> {
  try {
    const stored = await browser.storage.local.get(KEY_RUN_METADATA);
    return coerceRunMetadata(stored[KEY_RUN_METADATA]);
  } catch {
    return {};
  }
}

// Sanitize at the I/O boundary even when the caller holds a RunMetadata type. This guarantees
// the durable key can contain only broker id → { checkedAt, result } records.
export async function writeRunMetadata(metadata: RunMetadata): Promise<void> {
  await browser.storage.local.set({
    [KEY_RUN_METADATA]: coerceRunMetadata(metadata),
  });
}

// Merge a completed run's broker summaries without discarding brokers absent from that run.
// This strict read-modify-write may throw; background callers isolate it as ancillary I/O.
export async function mergeStoredRunMetadata(newest: RunMetadata): Promise<RunMetadata> {
  const stored = await browser.storage.local.get(KEY_RUN_METADATA);
  const merged = mergeRunMetadata(stored[KEY_RUN_METADATA], newest);
  await writeRunMetadata(merged);
  return merged;
}

export async function readStoragePromptsSeen(): Promise<StoragePromptsSeen | null> {
  try {
    return await readStoragePromptsSeenStrict();
  } catch {
    // Callers must distinguish a real absent key (strict read → all false) from a read failure.
    // Treating failure as unseen would nag the user again.
    return null;
  }
}

async function readStoragePromptsSeenStrict(): Promise<StoragePromptsSeen> {
  const stored = await browser.storage.local.get(KEY_STORAGE_PROMPTS_SEEN);
  return mergeStoragePromptsSeen(stored[KEY_STORAGE_PROMPTS_SEEN]);
}

async function writeStoragePromptsSeen(seen: StoragePromptsSeen): Promise<void> {
  await browser.storage.local.set({
    [KEY_STORAGE_PROMPTS_SEEN]: mergeStoragePromptsSeen(seen),
  });
}

// Strict read-modify-write: a read error must not replace true flags with all-false. The
// background validates prompt before calling, and the pure reducer guarantees exactly 3 fields.
export async function markStoredStoragePromptSeen(
  prompt: StoragePromptId,
): Promise<StoragePromptsSeen> {
  const current = await readStoragePromptsSeenStrict();
  const next = markStoragePromptSeen(current, prompt);
  await writeStoragePromptsSeen(next);
  return next;
}

// Session-scoped fence survives background event-page spindown but disappears with the browser.
// It is not part of the durable seen schema and carries no user/context value.
export async function readStoragePromptEpoch(): Promise<number | null> {
  try {
    const stored = await browser.storage.session.get(KEY_STORAGE_PROMPT_EPOCH);
    const epoch = stored[KEY_STORAGE_PROMPT_EPOCH];
    return typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch >= 0
      ? epoch
      : 0;
  } catch {
    return null;
  }
}

export async function writeStoragePromptEpoch(epoch: number): Promise<void> {
  await browser.storage.session.set({ [KEY_STORAGE_PROMPT_EPOCH]: epoch });
}

// Drop the durable slices when their opt-in is turned off. Removing an absent key is a no-op,
// so these are safe to call in Phase 1 even though Phase 2 owns the writes that populate them.
export async function purgeRunMetadata(): Promise<void> {
  await browser.storage.local.remove(KEY_RUN_METADATA);
}

// Phase 2 keeps rich data in the lifecycle-routed expurge_run record, not a history archive.
// Retain this cleanup for Phase 1/development builds that may have created the placeholder.
export async function purgeHistory(): Promise<void> {
  await browser.storage.local.remove(KEY_HISTORY);
}
