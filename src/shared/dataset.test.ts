import { describe, it, expect } from 'vitest';
import {
  decideDatasetUpdate,
  isDatasetExpired,
  isValidDataset,
  isAutoFetchDue,
  AUTO_FETCH_DAYS,
  base64urlToBytes,
  importEd25519Key,
  loadTrustedKeys,
  anyValidSignature,
  BUNDLED_DATASET,
  type Dataset,
  type SigEnvelope,
} from './dataset';

// A structurally-valid dataset, newer than the bundled baseline (v0) by default.
function makeDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    schema_version: 1,
    dataset_version: 5,
    created: '2026-06-30T00:00:00Z',
    expires: '2027-06-30T00:00:00Z',
    brokers: [
      {
        id: 'truepeoplesearch',
        name: 'TruePeopleSearch',
        tier: 1,
        status: 'active',
        search: { url: 'https://x/{name|q}', requires: ['first'], exposes: ['age'] },
        optout: [],
      },
    ],
    ...over,
  };
}

const NOW = Date.parse('2026-07-09T00:00:00Z');

// bytes → base64url (test-side signer output mirrors what CI would publish).
function bytesToBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('base64urlToBytes', () => {
  it('round-trips through bytesToBase64url, padded or not', () => {
    for (const len of [0, 1, 2, 3, 32, 64]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 0xff);
      expect([...base64urlToBytes(bytesToBase64url(bytes))]).toEqual([...bytes]);
    }
  });
});

describe('isValidDataset', () => {
  it('accepts a well-formed dataset', () => {
    expect(isValidDataset(makeDataset())).toBe(true);
    expect(isValidDataset(BUNDLED_DATASET)).toBe(true);
  });

  it('rejects non-objects and missing/mistyped envelope fields', () => {
    expect(isValidDataset(null)).toBe(false);
    expect(isValidDataset('nope')).toBe(false);
    expect(isValidDataset({ ...makeDataset(), schema_version: '1' })).toBe(false);
    expect(isValidDataset({ ...makeDataset(), dataset_version: 1.5 })).toBe(false);
    expect(isValidDataset({ ...makeDataset(), expires: 'not-a-date' })).toBe(false);
    expect(isValidDataset({ ...makeDataset(), brokers: 'x' })).toBe(false);
  });

  it('rejects a dataset whose brokers are malformed', () => {
    expect(isValidDataset({ ...makeDataset(), brokers: [{ id: 'x' }] })).toBe(false);
    const badStatus = makeDataset();
    (badStatus.brokers[0] as { status: string }).status = 'live';
    expect(isValidDataset(badStatus)).toBe(false);
    const noSearch = makeDataset();
    delete (noSearch.brokers[0] as { search?: unknown }).search;
    expect(isValidDataset(noSearch)).toBe(false);
  });
});

describe('isDatasetExpired', () => {
  it('is true past expiry and on an unparseable date, false before', () => {
    expect(isDatasetExpired(makeDataset({ expires: '2027-06-30T00:00:00Z' }), NOW)).toBe(false);
    expect(isDatasetExpired(makeDataset({ expires: '2026-01-01T00:00:00Z' }), NOW)).toBe(true);
    expect(isDatasetExpired(makeDataset({ expires: 'garbage' }), NOW)).toBe(true);
  });
});

describe('decideDatasetUpdate', () => {
  const base = { currentVersion: 0, signatureValid: true, now: NOW };

  it('accepts a valid, newer, signed, unexpired dataset', () => {
    expect(decideDatasetUpdate({ ...base, fetched: makeDataset({ dataset_version: 5 }) })).toEqual({
      action: 'accept',
      version: 5,
    });
  });

  it('rejects on invalid signature before anything else', () => {
    // signature is checked FIRST — even a malformed/expired payload reports bad_signature.
    expect(
      decideDatasetUpdate({ ...base, signatureValid: false, fetched: { garbage: true } }),
    ).toEqual({ action: 'reject', reason: 'bad_signature' });
  });

  it('rejects a signed-but-malformed payload', () => {
    expect(decideDatasetUpdate({ ...base, fetched: { schema_version: 1 } })).toEqual({
      action: 'reject',
      reason: 'malformed',
    });
  });

  it('ignores an older or equal version (anti-rollback)', () => {
    expect(
      decideDatasetUpdate({ ...base, currentVersion: 5, fetched: makeDataset({ dataset_version: 5 }) }),
    ).toEqual({ action: 'ignore', reason: 'not_newer' });
    expect(
      decideDatasetUpdate({ ...base, currentVersion: 9, fetched: makeDataset({ dataset_version: 5 }) }),
    ).toEqual({ action: 'ignore', reason: 'not_newer' });
  });

  it('rejects a newer but already-expired dataset', () => {
    expect(
      decideDatasetUpdate({ ...base, fetched: makeDataset({ dataset_version: 5, expires: '2026-01-01T00:00:00Z' }) }),
    ).toEqual({ action: 'reject', reason: 'expired' });
  });
});

describe('isAutoFetchDue', () => {
  const enabled = { autoFetch: true, hasPermission: true, configured: true };

  it('is false unless opted in AND permitted AND configured', () => {
    expect(isAutoFetchDue({ ...enabled, autoFetch: false }, NOW)).toBe(false);
    expect(isAutoFetchDue({ ...enabled, hasPermission: false }, NOW)).toBe(false);
    expect(isAutoFetchDue({ ...enabled, configured: false }, NOW)).toBe(false);
  });

  it('is due when never checked or an unparseable last-checked', () => {
    expect(isAutoFetchDue(enabled, NOW)).toBe(true);
    expect(isAutoFetchDue({ ...enabled, lastChecked: 'garbage' }, NOW)).toBe(true);
  });

  it('is due only once the cadence window has fully elapsed', () => {
    const day = 24 * 60 * 60 * 1000;
    const sixDaysAgo = new Date(NOW - 6 * day).toISOString();
    const sevenDaysAgo = new Date(NOW - AUTO_FETCH_DAYS * day).toISOString();
    expect(isAutoFetchDue({ ...enabled, lastChecked: sixDaysAgo }, NOW)).toBe(false);
    expect(isAutoFetchDue({ ...enabled, lastChecked: sevenDaysAgo }, NOW)).toBe(true);
  });
});

describe('Ed25519 signature verification (real WebCrypto roundtrip)', () => {
  it('validates a signature made by a pinned key, rejects tampered bytes and wrong keys', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const pubB64 = bytesToBase64url(rawPub);

    const bytes = new TextEncoder().encode(JSON.stringify(makeDataset()));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, bytes));
    const env: SigEnvelope = {
      alg: 'ed25519',
      target: 'brokers.json',
      sigs: [{ keyid: 'primary-2026', sig: bytesToBase64url(sig) }],
    };

    const pinned = await loadTrustedKeys({ 'primary-2026': pubB64 });
    expect(Object.keys(pinned)).toEqual(['primary-2026']);

    // valid signature over the exact bytes → true
    expect(await anyValidSignature(env, bytes, pinned)).toBe(true);

    // a single flipped byte invalidates it
    const tampered = new Uint8Array(bytes);
    tampered[0] ^= 0x01;
    expect(await anyValidSignature(env, tampered, pinned)).toBe(false);

    // wrong keyid (sig names a key we didn't pin) → no match → false
    const otherKeyid: SigEnvelope = { ...env, sigs: [{ keyid: 'unknown', sig: env.sigs[0]!.sig }] };
    expect(await anyValidSignature(otherKeyid, bytes, pinned)).toBe(false);

    // wrong algorithm envelope → false
    expect(await anyValidSignature({ ...env, alg: 'rsa' as 'ed25519' }, bytes, pinned)).toBe(false);
  });

  it('accepts when ANY pinned key signs (Posture B), even if another key does not', async () => {
    const primary = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const backup = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pinned = await loadTrustedKeys({
      'primary-2026': bytesToBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', primary.publicKey))),
      'backup-2026': bytesToBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', backup.publicKey))),
    });

    const bytes = new TextEncoder().encode('payload');
    // signed by BACKUP only
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, backup.privateKey, bytes));
    const env: SigEnvelope = { alg: 'ed25519', target: 'brokers.json', sigs: [{ keyid: 'backup-2026', sig: bytesToBase64url(sig) }] };
    expect(await anyValidSignature(env, bytes, pinned)).toBe(true);
  });

  it('loadTrustedKeys skips malformed/placeholder keys', async () => {
    const keys = await loadTrustedKeys({ bad: 'REPLACE_ME_not_base64url_$$', empty: '' });
    expect(Object.keys(keys)).toEqual([]);
  });

  it('importEd25519Key rejects a non-key string', async () => {
    await expect(importEd25519Key('!!!not a key!!!')).rejects.toBeDefined();
  });
});
