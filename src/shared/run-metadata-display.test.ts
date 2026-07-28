import { describe, expect, it } from 'vitest';
import {
  brokerRunResultLabel,
  formatRunMetadataLine,
} from './run-metadata-display';
import type { BrokerRunResult } from './types';

describe('brokerRunResultLabel', () => {
  it.each([
    ['hit', 'Listed'],
    ['clear', 'Not listed'],
    ['unknown', 'Couldn’t tell'],
    ['skipped', 'Skipped'],
  ] satisfies Array<[BrokerRunResult, string]>)('%s → %s', (result, label) => {
    expect(brokerRunResultLabel(result)).toBe(label);
  });
});

describe('formatRunMetadataLine', () => {
  it('formats a calm result label and localized completion date', () => {
    expect(formatRunMetadataLine(
      { checkedAt: '2026-07-27T18:30:00.000Z', result: 'hit' },
      'en-US',
      'UTC',
    )).toBe('Your last scan: Listed · Jul 27, 2026');
  });

  it('uses the supplied locale', () => {
    expect(formatRunMetadataLine(
      { checkedAt: '2026-07-27T18:30:00.000Z', result: 'clear' },
      'en-GB',
      'UTC',
    )).toBe('Your last scan: Not listed · 27 Jul 2026');
  });

  it('defaults to the browser locale and time zone', () => {
    expect(formatRunMetadataLine({
      checkedAt: '2026-07-27T18:30:00.000Z',
      result: 'skipped',
    })).toMatch(/^Your last scan: Skipped · .+/);
  });

  it('returns null for an invalid timestamp', () => {
    expect(formatRunMetadataLine(
      { checkedAt: 'not-a-date', result: 'unknown' },
      'en-US',
      'UTC',
    )).toBeNull();
  });
});
