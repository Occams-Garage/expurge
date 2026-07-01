import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { evaluateGate, channelExpiryState } from './gate';
import { makeBroker, makeChannel } from '../test-support/fixtures';
import type { BrokerChannel } from './brokers';

// last_checked is compared to the live clock, so build dates relative to now.
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
// A verified channel checked recently by default.
const channel = (over: Partial<BrokerChannel> = {}) => makeChannel({ last_checked: daysAgo(30), ...over });
const broker = (optout: BrokerChannel[]) => makeBroker({ optout });

describe('evaluateGate', () => {
  it('any non-hit verdict → not_hit (no channel evaluated)', () => {
    for (const v of ['clear', 'unknown', 'skipped'] as const) {
      expect(evaluateGate(broker([channel()]), v)).toEqual({ pass: false, reason: 'not_hit' });
    }
  });

  it('hit + verified unexpired channel → pass with that exact channel', () => {
    const ch = channel();
    expect(evaluateGate(broker([ch]), 'hit')).toEqual({ pass: true, channel: ch });
  });

  it('unverified or broken trust → no_verified_channel', () => {
    expect(evaluateGate(broker([channel({ trust: 'unverified' })]), 'hit'))
      .toEqual({ pass: false, reason: 'no_verified_channel' });
    expect(evaluateGate(broker([channel({ trust: 'broken' })]), 'hit'))
      .toEqual({ pass: false, reason: 'no_verified_channel' });
  });

  it('verified but no last_checked → skipped', () => {
    expect(evaluateGate(broker([channel({ last_checked: undefined })]), 'hit'))
      .toEqual({ pass: false, reason: 'no_verified_channel' });
  });

  it('verified but expired (>12 months) → skipped', () => {
    expect(evaluateGate(broker([channel({ last_checked: daysAgo(400) })]), 'hit'))
      .toEqual({ pass: false, reason: 'no_verified_channel' });
  });

  it('returns the FIRST verified+unexpired channel in list order', () => {
    const first = channel({ target: 'first@x.com' });
    const second = channel({ target: 'second@x.com' });
    expect(evaluateGate(broker([channel({ trust: 'broken' }), first, second]), 'hit'))
      .toEqual({ pass: true, channel: first });
  });

  it('skips expired/unverified to reach a later valid channel', () => {
    const good = channel({ target: 'good@x.com' });
    const r = evaluateGate(
      broker([channel({ last_checked: daysAgo(400) }), channel({ trust: 'unverified' }), good]),
      'hit',
    );
    expect(r).toEqual({ pass: true, channel: good });
  });

  it('empty optout list → no_verified_channel', () => {
    expect(evaluateGate(broker([]), 'hit')).toEqual({ pass: false, reason: 'no_verified_channel' });
  });
});

describe('channelExpiryState (wide margins)', () => {
  it('fresh (<6 months) → not warn, not expired', () => {
    const s = channelExpiryState(channel({ last_checked: daysAgo(30) }));
    expect(s.warn).toBe(false);
    expect(s.expired).toBe(false);
    expect(s.months).toBeLessThan(6);
  });

  it('missing last_checked → months Infinity, warn + expired', () => {
    const s = channelExpiryState(channel({ last_checked: undefined }));
    expect(s.months).toBe(Infinity);
    expect(s.warn).toBe(true);
    expect(s.expired).toBe(true);
  });
});

// Exercise the exact `>= WARN_MONTHS` / `>= EXPIRE_MONTHS` edges deterministically — a
// `>` vs `>=` off-by-one at the boundary (a channel expiring at exactly 12mo still passing
// the draft gate) is invisible to the wide-margin cases above.
describe('channelExpiryState — exact boundaries (fake clock)', () => {
  const NOW = new Date('2026-07-01T00:00:00.000Z');
  const MONTH_MS = 30.44 * 86_400_000; // matches gate.ts monthsSince divisor exactly
  const atMonths = (m: number): string => new Date(NOW.getTime() - m * MONTH_MS).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exactly 12 months → expired (>= boundary is inclusive)', () => {
    expect(channelExpiryState(makeChannel({ last_checked: atMonths(12) })).expired).toBe(true);
  });

  it('just under 12 months → warn but not expired', () => {
    const s = channelExpiryState(makeChannel({ last_checked: atMonths(11.99) }));
    expect(s.expired).toBe(false);
    expect(s.warn).toBe(true);
  });

  it('exactly 6 months → warn (>= boundary is inclusive)', () => {
    expect(channelExpiryState(makeChannel({ last_checked: atMonths(6) })).warn).toBe(true);
  });

  it('just under 6 months → not warn', () => {
    expect(channelExpiryState(makeChannel({ last_checked: atMonths(5.99) })).warn).toBe(false);
  });
});
