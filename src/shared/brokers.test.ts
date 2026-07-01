import { describe, it, expect } from 'vitest';
import { BROKERS, getBroker } from './brokers';

describe('getBroker', () => {
  it('returns a broker by id', () => {
    expect(getBroker('truepeoplesearch')?.name).toBe('TruePeopleSearch');
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
});
