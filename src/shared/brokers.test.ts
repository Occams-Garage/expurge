import { describe, it, expect } from 'vitest';
import { BROKERS, getBroker } from './brokers';

describe('getBroker', () => {
  it('returns the record whose stable id matches', () => {
    const first = BROKERS[0];
    expect(getBroker(first.id)).toBe(first); // by stable id, not the mutable display name
  });

  it('returns undefined for an unknown id', () => {
    expect(getBroker('nope')).toBeUndefined();
  });
});

describe('BROKERS invariants', () => {
  it('ids are unique', () => {
    const ids = BROKERS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every broker has non-empty search.requires and an optout array', () => {
    for (const b of BROKERS) {
      expect(b.search.requires.length).toBeGreaterThan(0);
      expect(Array.isArray(b.optout)).toBe(true);
    }
  });

  // Trust hygiene the runtime draft gate keys on: a channel the project marked `verified`
  // must carry its provenance. (Full contributed-record trust-gating — CLAUDE.md's "CI
  // enforces this mechanically" — is a separate, still-unbuilt M9 check, not this.)
  it('every trust:verified channel carries last_checked, source, and verified_by', () => {
    for (const b of BROKERS) {
      for (const ch of b.optout) {
        if (ch.trust !== 'verified') continue;
        expect(ch.last_checked, `${b.id}: verified channel needs last_checked`).toBeTruthy();
        expect(ch.source, `${b.id}: verified channel needs source`).toBeTruthy();
        expect(ch.verified_by, `${b.id}: verified channel needs verified_by`).toBeTruthy();
      }
    }
  });
});
