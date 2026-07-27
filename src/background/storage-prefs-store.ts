// The I/O half of the persistence opt-ins (M8): read/write the opt-in flags and purge the
// durable slices they gate. The pure coercion/normalization logic lives in
// src/shared/storage-prefs.ts (unit-tested); this module is the thin imperative wrapper
// (imports the polyfill, touches storage.local) and is coverage-excluded like dataset-store.ts.

import browser from 'webextension-polyfill';
import type { StoragePrefs } from '../shared/types';
import { mergeStoragePrefs, DEFAULT_STORAGE_PREFS } from '../shared/storage-prefs';

// storage.local (durable). Kept separate from the options page's `expurge_prefs` (send-method),
// which is whole-object-overwritten by saveSendMethod — co-locating the flags would clobber them.
// A missing key coerces to all-OFF (ephemeral), so DELETE_ALL's local.clear() resets for free.
const KEY_STORAGE_PREFS = 'expurge_storage_prefs';
const KEY_RUN_METADATA = 'expurge_run_metadata'; // per-broker last-checked + result, no PII (Phase 2 writes it)
const KEY_HISTORY = 'expurge_history';           // rich hits/drafts history (Phase 2 writes it)

export async function readStoragePrefs(): Promise<StoragePrefs> {
  try {
    const r = await browser.storage.local.get(KEY_STORAGE_PREFS);
    return mergeStoragePrefs(r[KEY_STORAGE_PREFS]);
  } catch {
    // Fail-safe: loadRun/saveRun call this on every run read/write, so a storage.local error must
    // not throw (that would reject a verdict write → no ACK → the sidebar retries forever, wedging
    // the run). Degrade to the ephemeral default — run/profile stay in storage.session, the safe
    // fallback — rather than propagate.
    return DEFAULT_STORAGE_PREFS;
  }
}

export async function writeStoragePrefs(prefs: StoragePrefs): Promise<void> {
  await browser.storage.local.set({ [KEY_STORAGE_PREFS]: prefs });
}

// Drop the durable slices when their opt-in is turned off. Removing an absent key is a no-op,
// so these are safe to call in Phase 1 even though Phase 2 owns the writes that populate them.
export async function purgeRunMetadata(): Promise<void> {
  await browser.storage.local.remove(KEY_RUN_METADATA);
}

export async function purgeHistory(): Promise<void> {
  await browser.storage.local.remove(KEY_HISTORY);
}
