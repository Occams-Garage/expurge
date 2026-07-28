import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STORAGE_PREFS,
  mergeStoragePrefs,
  applyStorageOptIn,
  isStoragePrefKey,
} from './storage-prefs';

describe('mergeStoragePrefs', () => {
  it('absent / nullish → all-OFF ephemeral default', () => {
    expect(mergeStoragePrefs(undefined)).toEqual(DEFAULT_STORAGE_PREFS);
    expect(mergeStoragePrefs(null)).toEqual(DEFAULT_STORAGE_PREFS);
    expect(mergeStoragePrefs({})).toEqual(DEFAULT_STORAGE_PREFS);
    expect(DEFAULT_STORAGE_PREFS).toEqual({ profileStorage: false, runMetadata: false, richHistory: false });
  });

  it('coerces non-boolean junk to defaults', () => {
    expect(mergeStoragePrefs({ profileStorage: 'yes', runMetadata: 1, richHistory: null })).toEqual(DEFAULT_STORAGE_PREFS);
  });

  it('does not throw on a non-object', () => {
    expect(mergeStoragePrefs('nope')).toEqual(DEFAULT_STORAGE_PREFS);
    expect(mergeStoragePrefs(42)).toEqual(DEFAULT_STORAGE_PREFS);
  });

  it('passes through valid booleans', () => {
    expect(mergeStoragePrefs({ profileStorage: true, runMetadata: true, richHistory: false }))
      .toEqual({ profileStorage: true, runMetadata: true, richHistory: false });
  });

  it('enforces the ride-along: richHistory forced off when profileStorage off', () => {
    expect(mergeStoragePrefs({ profileStorage: false, richHistory: true }))
      .toEqual({ profileStorage: false, runMetadata: false, richHistory: false });
  });

  it('allows richHistory when profileStorage is on', () => {
    expect(mergeStoragePrefs({ profileStorage: true, richHistory: true }))
      .toEqual({ profileStorage: true, runMetadata: false, richHistory: true });
  });
});

describe('applyStorageOptIn', () => {
  const base = DEFAULT_STORAGE_PREFS;

  it('sets profileStorage on', () => {
    expect(applyStorageOptIn(base, 'profileStorage', true)).toMatchObject({ profileStorage: true });
  });

  it('sets runMetadata independently of profileStorage', () => {
    expect(applyStorageOptIn(base, 'runMetadata', true))
      .toEqual({ profileStorage: false, runMetadata: true, richHistory: false });
  });

  it('turning profileStorage off forces richHistory off (ride-along)', () => {
    const on = { profileStorage: true, runMetadata: false, richHistory: true };
    expect(applyStorageOptIn(on, 'profileStorage', false))
      .toEqual({ profileStorage: false, runMetadata: false, richHistory: false });
  });

  it('turning richHistory on while profileStorage off is refused (stays off)', () => {
    expect(applyStorageOptIn(base, 'richHistory', true)).toMatchObject({ richHistory: false });
  });

  it('turning richHistory on while profileStorage on sticks', () => {
    const on = { profileStorage: true, runMetadata: false, richHistory: false };
    expect(applyStorageOptIn(on, 'richHistory', true)).toMatchObject({ richHistory: true });
  });

  it('does not mutate its input', () => {
    const prev = { ...base };
    applyStorageOptIn(prev, 'profileStorage', true);
    expect(prev).toEqual(base);
  });
});

describe('isStoragePrefKey', () => {
  it.each(['profileStorage', 'runMetadata', 'richHistory'])('accepts %s', key => {
    expect(isStoragePrefKey(key)).toBe(true);
  });

  it.each(['__proto__', 'profile', '', null, true])('rejects malformed key %j', key => {
    expect(isStoragePrefKey(key)).toBe(false);
  });
});
