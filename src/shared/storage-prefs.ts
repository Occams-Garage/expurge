// Pure logic for the three persistence opt-ins (M8) — no browser/DOM, no side effects.
// storage-prefs-store.ts owns the storage.local IO and calls these to coerce/normalize.
// Keeping the rules here (not in the IO wrapper) means the ride-along invariant is tested.

import type { StoragePrefs } from './types';

// All OFF: the ephemeral default. A missing/absent pref key coerces to exactly this, which
// is what makes DELETE_ALL's storage.local.clear() reset the user to ephemeral for free.
export const DEFAULT_STORAGE_PREFS: StoragePrefs = {
  profileStorage: false,
  runMetadata: false,
  richHistory: false,
};

// richHistory can only be on when profileStorage is on ("#3 rides #1"). Enforced in one
// place so no reader/writer can drift into a persisted-history-without-profile-storage state.
function normalize(prefs: StoragePrefs): StoragePrefs {
  return prefs.richHistory && !prefs.profileStorage
    ? { ...prefs, richHistory: false }
    : prefs;
}

// Coerce an unknown stored value (or undefined) into a validated StoragePrefs over the
// all-OFF default, then apply the ride-along invariant. Never throws.
export function mergeStoragePrefs(raw: unknown): StoragePrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt);
  return normalize({
    profileStorage: bool(r.profileStorage, DEFAULT_STORAGE_PREFS.profileStorage),
    runMetadata:    bool(r.runMetadata,    DEFAULT_STORAGE_PREFS.runMetadata),
    richHistory:    bool(r.richHistory,    DEFAULT_STORAGE_PREFS.richHistory),
  });
}

// Flip one opt-in and re-normalize. Turning profileStorage OFF forces richHistory OFF here,
// so the caller (and the options UI reading back the result) always sees a consistent set.
export function applyStorageOptIn(prev: StoragePrefs, key: keyof StoragePrefs, on: boolean): StoragePrefs {
  return normalize({ ...prev, [key]: on });
}
