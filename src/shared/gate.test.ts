import { describe, it, expect } from 'vitest';
import { evaluateGate, channelExpiryState } from './gate';
import type { Broker, BrokerChannel } from './brokers';

// last_checked is compared to the live clock, so build dates relative to now.
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const channel = (over: Partial<BrokerChannel> = {}): BrokerChannel => ({
  method: 'email',
  target: 'privacy@example.com',
  kind: 'dedicated_optout',
  trust: 'verified',
  last_checked: daysAgo(30),
  ...over,
});

const broker = (optout: BrokerChannel[]): Broker => ({
  id: 'b',
  name: 'B',
  tier: 1,
  status: 'active',
  search: { url: 'https://x.com/s', requires: ['first'], exposes: [] },
  optout,
});

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

describe('channelExpiryState', () => {
  it('fresh (<6 months) → not warn, not expired', () => {
    const s = channelExpiryState(channel({ last_checked: daysAgo(30) }));
    expect(s.warn).toBe(false);
    expect(s.expired).toBe(false);
    expect(s.months).toBeLessThan(6);
  });

  it('6–12 months → warn, not expired', () => {
    const s = channelExpiryState(channel({ last_checked: daysAgo(220) }));
    expect(s.warn).toBe(true);
    expect(s.expired).toBe(false);
  });

  it('>12 months → warn and expired', () => {
    const s = channelExpiryState(channel({ last_checked: daysAgo(400) }));
    expect(s.warn).toBe(true);
    expect(s.expired).toBe(true);
  });

  it('missing last_checked → months Infinity, warn + expired', () => {
    const s = channelExpiryState(channel({ last_checked: undefined }));
    expect(s.months).toBe(Infinity);
    expect(s.warn).toBe(true);
    expect(s.expired).toBe(true);
  });
});
