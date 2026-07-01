import { describe, it, expect } from 'vitest';
import {
  buildItems,
  withVerdict,
  applySkip,
  applyStop,
  applyMarkSent,
  selectBatch,
  BATCH_SIZE,
} from './coordinator';
import { BROKERS } from '../shared/brokers';
import { makeProfile as profile, makeBroker as broker, makeItem as item, makeRun as run } from '../test-support/fixtures';

describe('buildItems', () => {
  it('primary variant → one pending item per active broker with a rendered URL', () => {
    const items = buildItems(profile(), [broker()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'b:primary',
      brokerId: 'b',
      nameVariant: 'primary',
      variantFirst: 'Jane',
      variantLast: 'Doe',
      status: 'pending',
    });
    expect(items[0].renderedUrl).toContain('Jane%20Doe');
  });

  it('AKAs expand into aka_i variants with frozen first/last', () => {
    const items = buildItems(
      profile({ also_known_as: [{ first: 'J', last: 'Q' }, { first: 'K', last: 'R' }] }),
      [broker()],
    );
    expect(items.map((i) => i.nameVariant)).toEqual(['primary', 'aka_0', 'aka_1']);
    expect(items[1]).toMatchObject({ variantFirst: 'J', variantLast: 'Q' });
  });

  it('missing required field → pre-verdicted skip with missing:<field> and no URL', () => {
    const items = buildItems(profile({ city: '' }), [broker()]);
    expect(items[0]).toMatchObject({
      status: 'verdicted',
      verdict: 'skipped',
      skipReason: 'missing:city',
      renderedUrl: '',
    });
  });

  it('treats an empty required array field as missing, a filled one as present', () => {
    const b = broker({ search: { url: 'https://b.com/s', requires: ['emails'], exposes: [] } });
    expect(buildItems(profile({ emails: [] }), [b])[0].skipReason).toBe('missing:emails');
    expect(buildItems(profile({ emails: ['a@b.com'] }), [b])[0].status).toBe('pending');
  });

  it('non-active brokers are skipped entirely', () => {
    const items = buildItems(profile(), [
      broker({ status: 'disabled' }),
      broker({ id: 'b2', status: 'broken' }),
    ]);
    expect(items).toHaveLength(0);
  });

  it('defaults to the shipped BROKERS when none injected', () => {
    // Assert the default-param wiring, not the shipped dataset's cardinality/ids — this
    // stays green when brokers are added.
    expect(buildItems(profile())).toEqual(buildItems(profile(), BROKERS));
  });
});

describe('withVerdict', () => {
  it('hit sets verdict + matchedAs from the item nameVariant', () => {
    const r = withVerdict(run([item({ nameVariant: 'aka_0' })]), 'b:primary', 'hit');
    expect(r.items[0]).toMatchObject({ status: 'verdicted', verdict: 'hit', matchedAs: 'aka_0' });
  });

  it('a non-hit re-verdict drops any prior matchedAs', () => {
    const r = withVerdict(
      run([item({ verdict: 'hit', matchedAs: 'primary', status: 'verdicted' })]),
      'b:primary',
      'clear',
    );
    expect(r.items[0].verdict).toBe('clear');
    expect(r.items[0].matchedAs).toBeUndefined();
  });

  it('sets listingUrl only when provided and leaves other items untouched', () => {
    const two = run([item({ id: 'b:primary' }), item({ id: 'b:aka_0', nameVariant: 'aka_0' })]);
    const r = withVerdict(two, 'b:primary', 'hit', 'https://p/1');
    expect(r.items[0].listingUrl).toBe('https://p/1');
    expect(r.items[1]).toEqual(two.items[1]);
  });

  it('preserves an existing listingUrl when none supplied', () => {
    const r = withVerdict(run([item({ listingUrl: 'https://keep' })]), 'b:primary', 'unknown');
    expect(r.items[0].listingUrl).toBe('https://keep');
  });
});

describe('applySkip', () => {
  it('marks a pending item skipped with the reason', () => {
    const r = applySkip(run([item()]), 'b:primary', 'challenge');
    expect(r.items[0]).toMatchObject({ status: 'verdicted', verdict: 'skipped', skipReason: 'challenge' });
  });

  it('never overwrites an already-verdicted item (no-wedge)', () => {
    const verdicted = item({ status: 'verdicted', verdict: 'hit' });
    const r = applySkip(run([verdicted]), 'b:primary', 'tab_closed');
    expect(r.items[0]).toEqual(verdicted);
  });
});

describe('applyStop', () => {
  it('skips pending and open items but leaves verdicted ones alone', () => {
    const r = applyStop(
      run([
        item({ id: 'a', status: 'pending' }),
        item({ id: 'b', status: 'open' }),
        item({ id: 'c', status: 'verdicted', verdict: 'hit' }),
      ]),
    );
    expect(r.items[0]).toMatchObject({ status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' });
    expect(r.items[1]).toMatchObject({ status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' });
    expect(r.items[2]).toMatchObject({ verdict: 'hit' });
  });
});

describe('applyMarkSent', () => {
  it('stamps a hit item once', () => {
    const r = applyMarkSent(run([item({ status: 'verdicted', verdict: 'hit' })]), 'b:primary', '2026-06-30T00:00:00Z');
    expect(r.items[0].optedOutAt).toBe('2026-06-30T00:00:00Z');
  });

  it('does not re-stamp an already-sent item', () => {
    const r = applyMarkSent(
      run([item({ verdict: 'hit', optedOutAt: '2026-01-01T00:00:00Z' })]),
      'b:primary',
      '2026-06-30T00:00:00Z',
    );
    expect(r.items[0].optedOutAt).toBe('2026-01-01T00:00:00Z');
  });

  it('ignores non-hit items', () => {
    const r = applyMarkSent(run([item({ verdict: 'clear' })]), 'b:primary', '2026-06-30T00:00:00Z');
    expect(r.items[0].optedOutAt).toBeUndefined();
  });
});

describe('selectBatch', () => {
  it('selects up to batchSize pending items and flips them to open', () => {
    const items = Array.from({ length: 4 }, (_, i) => item({ id: `x${i}`, brokerId: `b${i}`, status: 'pending' }));
    const { toOpen, run: updated } = selectBatch(run(items), 2);
    expect(toOpen).toHaveLength(2);
    expect(updated.items.filter((i) => i.status === 'open')).toHaveLength(2);
    expect(updated.items.slice(2).every((i) => i.status === 'pending')).toBe(true);
  });

  it('opens at most one item per broker per batch (no hammering)', () => {
    const items = [
      item({ id: 'b1:a', brokerId: 'b1', status: 'pending' }),
      item({ id: 'b1:b', brokerId: 'b1', status: 'pending' }),
      item({ id: 'b2:a', brokerId: 'b2', status: 'pending' }),
    ];
    expect(selectBatch(run(items), 5).toOpen.map((i) => i.brokerId)).toEqual(['b1', 'b2']);
  });

  it('counts already-open items against both slots and claimed brokers', () => {
    const items = [
      item({ id: 'b1:a', brokerId: 'b1', status: 'open' }),
      item({ id: 'b1:b', brokerId: 'b1', status: 'pending' }),
      item({ id: 'b2:a', brokerId: 'b2', status: 'pending' }),
    ];
    // 1 slot left (2 − 1 open); b1 already claimed → only b2 opens
    expect(selectBatch(run(items), 2).toOpen.map((i) => i.id)).toEqual(['b2:a']);
  });

  it('returns nothing when all slots are full', () => {
    const items = Array.from({ length: 5 }, (_, i) => item({ id: `o${i}`, brokerId: `b${i}`, status: 'open' }));
    expect(selectBatch(run(items), 5).toOpen).toHaveLength(0);
  });

  it('returns nothing (and an unchanged run) when no pending items remain', () => {
    const { toOpen, run: updated } = selectBatch(run([item({ status: 'verdicted', verdict: 'hit' })]), 5);
    expect(toOpen).toHaveLength(0);
    expect(updated.items[0].status).toBe('verdicted');
  });

  it('BATCH_SIZE default is 5', () => {
    expect(BATCH_SIZE).toBe(5);
  });
});
