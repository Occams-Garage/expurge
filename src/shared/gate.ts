import type { Verdict } from './types';
import type { Broker, BrokerChannel } from './brokers';

const WARN_MONTHS  = 6;
const EXPIRE_MONTHS = 12;

function monthsSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

export type GateResult =
  | { pass: true;  channel: BrokerChannel }
  | { pass: false; reason: 'not_hit' | 'no_verified_channel' };

// The draft gate: a broker produces a draft ONLY when (1) verdict is hit AND
// (2) the first verified, unexpired channel exists. No override.
export function evaluateGate(broker: Broker, verdict: Verdict): GateResult {
  if (verdict !== 'hit') return { pass: false, reason: 'not_hit' };

  for (const ch of broker.optout) {
    if (ch.trust !== 'verified') continue;
    if (!ch.last_checked) continue;
    if (monthsSince(ch.last_checked) >= EXPIRE_MONTHS) continue;
    return { pass: true, channel: ch };
  }

  return { pass: false, reason: 'no_verified_channel' };
}

export function channelExpiryState(ch: BrokerChannel): {
  months: number;
  warn: boolean;
  expired: boolean;
} {
  const months = ch.last_checked ? monthsSince(ch.last_checked) : Infinity;
  return { months, warn: months >= WARN_MONTHS, expired: months >= EXPIRE_MONTHS };
}
