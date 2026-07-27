// Pure parse/validation for an imported session export (M8) — no browser/DOM. The options page
// owns the file read + SAVE_PROFILE round-trip; this validates the envelope so a wrong file can't
// silently overwrite the user's profile. Mirrors the handleExport shape
// ({ expurge_export: true, version: 1, profile, run }). Pure → unit-tested + counted.

import type { Profile, RunState } from './types';

export type ImportResult =
  | { ok: true; profile: Profile | null; run: RunState | null }
  | { ok: false; error: string };

// Validate strictly at the envelope (expurge_export flag + version) and at the profile's required
// fields; the run is treated as opaque (the importer only restores the profile in Phase 1).
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
  let profile: Profile | null = null;
  if (rawProfile !== null) {
    if (typeof rawProfile !== 'object') {
      return { ok: false, error: 'That export’s profile data is malformed.' };
    }
    const p = rawProfile as Record<string, unknown>;
    const required = ['first', 'last', 'city', 'state'] as const;
    if (required.some(f => typeof p[f] !== 'string' || (p[f] as string).trim() === '')) {
      return { ok: false, error: 'That export’s profile is missing required fields.' };
    }
    profile = rawProfile as Profile;
  }

  const run = (d['run'] ?? null) as RunState | null;
  return { ok: true, profile, run };
}
