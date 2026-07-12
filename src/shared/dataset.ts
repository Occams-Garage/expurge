// Signed remote broker-dataset model (M7). PURE + platform-crypto only — no webextension
// polyfill, no storage, no fetch (that I/O half lives in src/background/dataset-store.ts, which
// is coverage-excluded). Everything here is unit-tested, incl. the real Ed25519 verify path
// (Firefox 140+ WebCrypto === Node's globalThis.crypto in the test env).
//
// TRUST TRAVELS IN THE SIGNATURE, NOT THE HOST (plan/dataset-delivery.md §2): the extension
// verifies the *exact fetched bytes* of brokers.json against a pinned Ed25519 key BEFORE parsing
// them. A network attacker or compromised CDN can change bytes but cannot forge a signature.

import { BROKERS, type Broker } from './brokers';

// ── host commitment (plan §3.4) ──────────────────────────────────────────────
// Committed to a custom domain under expurge.dev from day one so a future move never forces a
// permission-churn release. expurge.dev matches the extension id (expurge@expurge.dev) and is
// HSTS-preloaded (HTTPS-only). Single source of truth: the manifest optional_host_permission and
// the two fetch URLs all derive from this origin — change ONLY here (and the manifest) to repoint.
export const DATASET_ORIGIN = 'https://data.expurge.dev';
export const DATASET_URL = `${DATASET_ORIGIN}/brokers.json`;
export const SIG_URL = `${DATASET_ORIGIN}/brokers.sig.json`;
// The host pattern requested via browser.permissions.request() at opt-in time. MUST match the
// manifest optional_host_permissions entry verbatim.
export const DATASET_HOST_PATTERN = 'https://data.expurge.dev/*';

// ── pinned public keys (plan §5.3) ───────────────────────────────────────────
// Raw 32-byte Ed25519 public keys, base64url, keyed by the `keyid` that appears in
// brokers.sig.json. Posture B (plan §5.2): a dataset is trusted if ANY pinned key validly signs
// it; the primary key publishes routinely from CI, the backup exists for emergency re-sign + key
// rotation.
//
// PLACEHOLDER — these are not real keys. Replace with the published public keys as the M7 infra
// runbook step (generate keypair → pin the public halves here → private key becomes a CI secret).
// Until real keys are pinned, importEd25519Key() rejects them, no remote dataset validates, and
// the bundled baseline is always used. That inert-by-default state is intentional and safe.
export const TRUSTED_PUBKEYS_RAW: Readonly<Record<string, string>> = {
  'primary-2026': 'REPLACE_WITH_PRIMARY_ED25519_PUBLIC_KEY_BASE64URL',
  'backup-2026': 'REPLACE_WITH_BACKUP_ED25519_PUBLIC_KEY_BASE64URL',
};

// ── envelope schema (plan §4) ────────────────────────────────────────────────
// Version + lifetime metadata live INSIDE brokers.json so the signature covers them (they can't
// be spoofed independently of the data).
export interface DatasetMeta {
  schema_version: number;
  dataset_version: number; // monotonic integer; drives anti-rollback
  created: string; // ISO
  expires: string; // ISO — hard expiry
  warn_after?: string; // ISO — soft warning
}

export interface Dataset extends DatasetMeta {
  brokers: Broker[];
}

// Detached signature envelope (plan §4.2). The sigs are base64url over the RAW bytes of
// brokers.json — detached specifically so "what is signed" is the literal downloaded bytes,
// sidestepping JSON canonicalization.
export interface SigEntry {
  keyid: string;
  sig: string; // base64url(signature over raw brokers.json bytes)
}
export interface SigEnvelope {
  alg: 'ed25519';
  target: string; // 'brokers.json'
  sigs: SigEntry[];
}

// ── bundled baseline (plan §2, §6.5) ─────────────────────────────────────────
// The always-present offline fallback: the compile-time BROKERS list wrapped in an envelope.
// dataset_version 0 so ANY signed remote (version ≥ 1) supersedes it via anti-rollback. It ships
// inside the AMO-signed XPI, so it is never subject to the remote expiry check.
export const BUNDLED_DATASET: Dataset = {
  schema_version: 1,
  dataset_version: 0,
  created: '2026-06-28T00:00:00Z',
  expires: '2099-01-01T00:00:00Z',
  brokers: BROKERS as Broker[],
};

// ── update decision (plan §6.3) ──────────────────────────────────────────────
// Pure: given a fetched dataset, the current version, whether its signature validated, and the
// clock, decide what to do. Split from I/O so the accept/reject/ignore matrix is exhaustively
// testable without a network or storage.
//
// `reject` = a bad update we must NOT swap in (keep last-good). `ignore` = a benign non-update
// (already current / older) — no error, just nothing to do. Order mirrors the plan: signature
// first (never trust unverified bytes), then shape, then rollback, then expiry.
export type DatasetDecision =
  | { action: 'accept'; version: number }
  | { action: 'ignore'; reason: 'not_newer' }
  | { action: 'reject'; reason: 'bad_signature' | 'malformed' | 'expired' };

export function decideDatasetUpdate(opts: {
  fetched: unknown;
  currentVersion: number;
  signatureValid: boolean;
  now: number;
}): DatasetDecision {
  const { fetched, currentVersion, signatureValid, now } = opts;

  // 1. signature: never reason about bytes we haven't verified.
  if (!signatureValid) return { action: 'reject', reason: 'bad_signature' };

  // 2. shape: a validly-signed-but-malformed payload must not reach the engine.
  if (!isValidDataset(fetched)) return { action: 'reject', reason: 'malformed' };

  // 3. anti-rollback: never accept an older-or-equal signed version (guards against a stale edge
  //    pinning you to an old dataset that reinstates channels you've since marked broken).
  if (fetched.dataset_version <= currentVersion) return { action: 'ignore', reason: 'not_newer' };

  // 4. expiry sanity: reject an already-expired dataset outright.
  if (Date.parse(fetched.expires) < now) return { action: 'reject', reason: 'expired' };

  return { action: 'accept', version: fetched.dataset_version };
}

// Has this (remote) dataset passed its hard expiry as of `now`? Applied at both commit time and
// read time so a stored remote that later expires falls back to the bundled baseline.
export function isDatasetExpired(ds: DatasetMeta, now: number): boolean {
  const t = Date.parse(ds.expires);
  return Number.isNaN(t) || t < now;
}

// Structural validation (plan §5.1: parse only after verify; then guard the shape). NOT the full
// CI schema validator (that's M9, server-side) — just enough that a malformed remote can't crash
// the run engine or the draft gate. Checks the load-bearing fields the engine dereferences.
export function isValidDataset(x: unknown): x is Dataset {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as Record<string, unknown>;
  if (typeof d['schema_version'] !== 'number') return false;
  if (!Number.isInteger(d['dataset_version'])) return false;
  if (typeof d['created'] !== 'string' || typeof d['expires'] !== 'string') return false;
  if (Number.isNaN(Date.parse(d['expires'] as string))) return false;
  if (!Array.isArray(d['brokers'])) return false;
  return d['brokers'].every(isValidBroker);
}

function isValidBroker(b: unknown): boolean {
  if (typeof b !== 'object' || b === null) return false;
  const r = b as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || typeof r['name'] !== 'string') return false;
  if (r['status'] !== 'active' && r['status'] !== 'broken' && r['status'] !== 'disabled') return false;
  const search = r['search'];
  if (typeof search !== 'object' || search === null) return false;
  const s = search as Record<string, unknown>;
  if (typeof s['url'] !== 'string') return false;
  if (!Array.isArray(s['requires']) || !Array.isArray(s['exposes'])) return false;
  if (!Array.isArray(r['optout'])) return false;
  return true;
}

// ── Ed25519 verification (plan §5.1, §6.3; WebCrypto per §10.3) ───────────────

// base64url → bytes. Tolerates missing padding (base64url usually omits it). Returns a
// Uint8Array explicitly backed by an ArrayBuffer (not the wider ArrayBufferLike) so it satisfies
// WebCrypto's BufferSource without a cast.
export function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Import a pinned raw public key for verification. Async so a malformed key (bad base64 → atob
// throws, or a non-32-byte value → importKey rejects) is ALWAYS surfaced as a rejected promise,
// not a sync throw — the placeholder keys above fail here, which is how the feature stays inert
// until real keys land.
export async function importEd25519Key(rawBase64url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64urlToBytes(rawBase64url), { name: 'Ed25519' }, false, [
    'verify',
  ]);
}

// Import every pinned key that parses, tagged by keyid; silently skip any that don't (placeholder
// or rotated-out). An empty result means "no usable signing key configured" — the caller treats
// that as "updates not available" rather than "bad signature".
export async function loadTrustedKeys(
  raw: Readonly<Record<string, string>> = TRUSTED_PUBKEYS_RAW,
): Promise<Record<string, CryptoKey>> {
  const keys: Record<string, CryptoKey> = {};
  for (const [keyid, val] of Object.entries(raw)) {
    try {
      keys[keyid] = await importEd25519Key(val);
    } catch {
      // malformed/placeholder key — skip; not a usable signer.
    }
  }
  return keys;
}

// Posture B: the dataset is trusted if ANY pinned key validly signs the exact fetched bytes. Each
// sig names its keyid; an unknown keyid is skipped. Returns false if no sig validates.
export async function anyValidSignature(
  env: SigEnvelope,
  bytes: Uint8Array<ArrayBuffer>,
  pubkeys: Record<string, CryptoKey>,
): Promise<boolean> {
  if (env.alg !== 'ed25519' || !Array.isArray(env.sigs)) return false;
  for (const { keyid, sig } of env.sigs) {
    const key = pubkeys[keyid];
    if (!key) continue;
    try {
      const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, base64urlToBytes(sig), bytes);
      if (ok) return true;
    } catch {
      // malformed signature bytes — treat as non-validating, try the next.
    }
  }
  return false;
}

// ── check-result / status (shared by background ↔ options) ───────────────────
// Outcome of a fetch/verify pass. `changed:true` swapped in a newer dataset; every other case
// left the active dataset untouched (fail-safe: a tampered/missing update degrades to "no
// change", never "no data").
export type CheckResult =
  | { changed: true; version: number }
  | {
      changed: false;
      reason:
        | 'not_modified' // 304 — nothing transferred
        | 'not_newer' // valid but ≤ current version
        | 'no_permission' // host permission not granted
        | 'no_keys' // no real signing key pinned yet (placeholder state)
        | 'bad_signature'
        | 'expired'
        | 'malformed'
        | 'network_error';
      version?: number;
    };

export interface DatasetStatus {
  source: 'bundled' | 'remote';
  version: number;
  created: string;
  expires: string;
  expired: boolean;
  expiresSoon: boolean; // past warn_after but not yet expired
  autoFetch: boolean;
  lastChecked?: string; // ISO of the last check that reached the network
  hasPermission: boolean;
  configured: boolean; // a real signing key is pinned (feature actually usable)
  autoFetchDue: boolean; // opted in + permitted + configured + ≥ AUTO_FETCH_DAYS since last check
}

// Lazy auto-fetch cadence (plan §6, Q-006 resolved): weekly, triggered when the options page
// opens — never a background timer.
export const AUTO_FETCH_DAYS = 7;

// Is an automatic check due now? Pure so the cadence rule is testable and single-sourced.
export function isAutoFetchDue(
  opts: { autoFetch: boolean; hasPermission: boolean; configured: boolean; lastChecked?: string },
  now: number,
): boolean {
  if (!opts.autoFetch || !opts.hasPermission || !opts.configured) return false;
  if (!opts.lastChecked) return true;
  const last = Date.parse(opts.lastChecked);
  if (Number.isNaN(last)) return true;
  return now - last >= AUTO_FETCH_DAYS * 24 * 60 * 60 * 1000;
}
