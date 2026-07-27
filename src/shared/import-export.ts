// Pure parse/validation for an imported session export (M8) — no browser/DOM. The options page
// owns the file read + SAVE_PROFILE round-trip; this validates the payload so a malformed file
// can't silently overwrite the user's profile. Mirrors the handleExport shape
// ({ expurge_export: true, version: 1, profile, run }). Pure → unit-tested + counted.
//
// Phase 1 restores the PROFILE only, so `run` is validated-away (ignored), not returned — a
// bare `run` field on the result would be dead surface area until Phase 2 restores runs.

import type { Profile } from './types';

export type ImportResult =
  | { ok: true; profile: Profile | null }
  | { ok: false; error: string };

const MALFORMED = 'That export’s profile data is malformed.';

function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

// also_known_as is [{ first: string, last: string, middle?: string }].
function isAkaArray(v: unknown): boolean {
  return Array.isArray(v) && v.every(x => {
    if (typeof x !== 'object' || x === null) return false;
    const a = x as Record<string, unknown>;
    return typeof a['first'] === 'string'
      && typeof a['last'] === 'string'
      && (a['middle'] === undefined || typeof a['middle'] === 'string');
  });
}

export function parseSessionImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON.' };
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'That file isn’t an expurge export.' };
  }
  const d = data as Record<string, unknown>;
  if (d['expurge_export'] !== true) {
    return { ok: false, error: 'That file isn’t an expurge export.' };
  }
  if (d['version'] !== 1) {
    return { ok: false, error: 'That export was made by a different version of expurge.' };
  }

  const rawProfile = d['profile'] ?? null;
  if (rawProfile === null) return { ok: true, profile: null };
  if (typeof rawProfile !== 'object') return { ok: false, error: MALFORMED };
  const p = rawProfile as Record<string, unknown>;

  // Required scalars must be non-blank strings.
  const required = ['first', 'last', 'city', 'state'] as const;
  if (required.some(f => typeof p[f] !== 'string' || (p[f] as string).trim() === '')) {
    return { ok: false, error: 'That export’s profile is missing required fields.' };
  }
  // Optional scalars must be strings if present.
  const optionalScalars = ['middle', 'zip', 'age'] as const;
  if (optionalScalars.some(f => p[f] !== undefined && typeof p[f] !== 'string')) {
    return { ok: false, error: MALFORMED };
  }
  // Optional string-array fields must be string[] if present. Critically: a bare string here would
  // pass every scalar check, then throw in populateProfileForm's `.join('\n')` — but only AFTER
  // SAVE_PROFILE has already overwritten the user's good profile. Reject up front instead.
  const stringArrays = ['relatives', 'emails', 'phones'] as const;
  if (stringArrays.some(f => p[f] !== undefined && !isStringArray(p[f]))) {
    return { ok: false, error: MALFORMED };
  }
  if (p['also_known_as'] !== undefined && !isAkaArray(p['also_known_as'])) {
    return { ok: false, error: MALFORMED };
  }

  return { ok: true, profile: rawProfile as Profile };
}
