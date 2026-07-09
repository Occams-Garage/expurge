// The I/O half of the signed-dataset feature (M7): fetch + Ed25519 verify + persist + serve the
// active broker list. The pure decision/verify/validation logic lives in src/shared/dataset.ts
// (unit-tested); this module is the thin imperative wrapper (imports the polyfill, does storage +
// fetch + permissions) and is coverage-excluded like tab-registry.ts.
//
// FAIL-SAFE (plan §6.5): every failure path — no permission, network error, bad signature,
// rollback, expiry, malformed — leaves the active dataset UNTOUCHED and degrades to last-good
// (ultimately the bundled baseline). A tampered/missing update becomes "no change", never "no
// data".

import browser from 'webextension-polyfill';
import type { Broker } from '../shared/brokers';
import {
  BUNDLED_DATASET,
  DATASET_URL,
  SIG_URL,
  DATASET_HOST_PATTERN,
  decideDatasetUpdate,
  isDatasetExpired,
  isValidDataset,
  isAutoFetchDue,
  loadTrustedKeys,
  anyValidSignature,
  type Dataset,
  type SigEnvelope,
  type CheckResult,
  type DatasetStatus,
} from '../shared/dataset';

// storage.local (durable): the dataset is signed data, not PII, so it lives outside the
// persistence opt-ins. DELETE_ALL (storage.local.clear) drops it → clean fall back to bundled.
const KEY_DATASET = 'expurge_dataset'; // last verified remote Dataset
const KEY_DATASET_ETAG = 'expurge_dataset_etag'; // for conditional If-None-Match
const KEY_DATASET_PREFS = 'expurge_dataset_prefs'; // { autoFetch, lastChecked }

interface DatasetPrefs {
  autoFetch: boolean;
  lastChecked?: string; // ISO of the last check that reached the network
}

// ── active dataset (what the run engine reads) ───────────────────────────────

// The stored remote dataset IF it's still structurally valid AND unexpired; else null. Re-checked
// on every read so a remote that has since passed its hard expiry silently stops being served.
async function getStoredDataset(): Promise<Dataset | null> {
  const r = await browser.storage.local.get(KEY_DATASET);
  const ds = r[KEY_DATASET];
  if (!isValidDataset(ds)) return null;
  if (isDatasetExpired(ds, Date.now())) return null;
  return ds;
}

export async function getActiveDataset(): Promise<Dataset> {
  return (await getStoredDataset()) ?? BUNDLED_DATASET;
}

export async function getActiveBrokers(): Promise<readonly Broker[]> {
  return (await getActiveDataset()).brokers;
}

export async function getActiveBroker(id: string): Promise<Broker | undefined> {
  return (await getActiveDataset()).brokers.find(b => b.id === id);
}

// The anti-rollback floor is the RAW stored version regardless of expiry — an expired remote still
// bars a downgrade to an older signed dataset, even though the engine falls back to bundled for
// USE. (Two different questions: "lowest version we'll accept" vs "what we serve".)
async function rollbackFloor(): Promise<number> {
  const r = await browser.storage.local.get(KEY_DATASET);
  const ds = r[KEY_DATASET];
  return isValidDataset(ds) ? ds.dataset_version : BUNDLED_DATASET.dataset_version;
}

// ── prefs / etag ─────────────────────────────────────────────────────────────

async function getPrefs(): Promise<DatasetPrefs> {
  const r = await browser.storage.local.get(KEY_DATASET_PREFS);
  return (r[KEY_DATASET_PREFS] as DatasetPrefs | undefined) ?? { autoFetch: false };
}

export async function setAutoFetch(on: boolean): Promise<void> {
  await browser.storage.local.set({ [KEY_DATASET_PREFS]: { ...(await getPrefs()), autoFetch: on } });
}

async function setLastChecked(iso: string): Promise<void> {
  await browser.storage.local.set({ [KEY_DATASET_PREFS]: { ...(await getPrefs()), lastChecked: iso } });
}

async function getEtag(): Promise<string | null> {
  const r = await browser.storage.local.get(KEY_DATASET_ETAG);
  return (r[KEY_DATASET_ETAG] as string | undefined) ?? null;
}

async function setEtag(etag: string): Promise<void> {
  await browser.storage.local.set({ [KEY_DATASET_ETAG]: etag });
}

// ── permissions ──────────────────────────────────────────────────────────────
// The GRANT is requested in the options click handler (needs a user gesture); this module only
// reads whether it's held. Background fetch works once the optional host permission is granted.

export function hasDatasetPermission(): Promise<boolean> {
  return browser.permissions.contains({ origins: [DATASET_HOST_PATTERN] });
}

// ── status (for the Settings readout) ────────────────────────────────────────

export async function getDatasetStatus(): Promise<DatasetStatus> {
  const stored = await getStoredDataset();
  const active = stored ?? BUNDLED_DATASET;
  const prefs = await getPrefs();
  const pubkeys = await loadTrustedKeys();
  const configured = Object.keys(pubkeys).length > 0;
  const hasPermission = await hasDatasetPermission();
  const now = Date.now();
  const expiresSoon = active.warn_after ? Date.parse(active.warn_after) < now : false;
  return {
    source: stored ? 'remote' : 'bundled',
    version: active.dataset_version,
    created: active.created,
    expires: active.expires,
    expired: isDatasetExpired(active, now),
    expiresSoon,
    autoFetch: prefs.autoFetch,
    lastChecked: prefs.lastChecked,
    hasPermission,
    configured,
    autoFetchDue: isAutoFetchDue(
      { autoFetch: prefs.autoFetch, hasPermission, configured, lastChecked: prefs.lastChecked },
      now,
    ),
  };
}

// ── the fetch/verify/swap pipeline (plan §6.3) ───────────────────────────────

export async function verifyAndLoadDataset(): Promise<CheckResult> {
  const pubkeys = await loadTrustedKeys();
  if (Object.keys(pubkeys).length === 0) return { changed: false, reason: 'no_keys' };
  if (!(await hasDatasetPermission())) return { changed: false, reason: 'no_permission' };

  // 1. conditional GET of the dataset. A 304 ends the check having transferred nothing.
  let res: Response;
  try {
    const etag = await getEtag();
    res = await fetch(DATASET_URL, {
      credentials: 'omit', // no cookies, no identifiers — everyone fetches the identical URL
      headers: etag ? { 'If-None-Match': etag } : {},
    });
  } catch {
    return { changed: false, reason: 'network_error' };
  }
  await setLastChecked(new Date().toISOString()); // we reached the network → reset the cadence timer

  if (res.status === 304) return { changed: false, reason: 'not_modified' };
  if (!res.ok) return { changed: false, reason: 'network_error' };

  const bytes = new Uint8Array(await res.arrayBuffer()); // verify THESE exact bytes
  const newEtag = res.headers.get('ETag');

  // 2. fetch the detached signature envelope.
  let env: SigEnvelope;
  try {
    const sigRes = await fetch(SIG_URL, { credentials: 'omit' });
    if (!sigRes.ok) return { changed: false, reason: 'network_error' };
    env = (await sigRes.json()) as SigEnvelope;
  } catch {
    return { changed: false, reason: 'network_error' };
  }

  // 3. verify BEFORE parsing (plan §5.1). Never act on — or even parse — unverified bytes.
  const signatureValid = await anyValidSignature(env, bytes, pubkeys);
  if (!signatureValid) return { changed: false, reason: 'bad_signature' };

  let fetched: unknown;
  try {
    fetched = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { changed: false, reason: 'malformed' };
  }

  // 4. decide: shape → anti-rollback → expiry (signature already proven above).
  const decision = decideDatasetUpdate({
    fetched,
    currentVersion: await rollbackFloor(),
    signatureValid: true,
    now: Date.now(),
  });

  if (decision.action === 'accept') {
    // 5. swap the active dataset only now; persist the new ETag alongside it.
    await browser.storage.local.set({
      [KEY_DATASET]: fetched as Dataset,
      ...(newEtag ? { [KEY_DATASET_ETAG]: newEtag } : {}),
    });
    return { changed: true, version: decision.version };
  }

  if (decision.action === 'ignore') {
    // Valid + signed but not newer: still record the ETag so the next poll can 304.
    if (newEtag) await setEtag(newEtag);
    return { changed: false, reason: 'not_newer', version: (fetched as Dataset).dataset_version };
  }

  // reject: bad_signature (already handled) / malformed / expired — keep last-good, do NOT swap.
  return { changed: false, reason: decision.reason };
}

// Lazy weekly auto-fetch (plan §6.1): called when the options page opens. Runs a real check only
// if opted in, permitted, configured, and the cadence window has elapsed — otherwise a no-op.
// Never requests permission (no user gesture here) and never runs on a background timer.
export async function autoFetchIfDue(): Promise<CheckResult | null> {
  const status = await getDatasetStatus();
  if (!status.autoFetchDue) return null;
  return verifyAndLoadDataset();
}
