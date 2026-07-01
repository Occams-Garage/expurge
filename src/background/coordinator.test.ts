import { describe, it, expect } from 'vitest';
import {
  buildItems,
  withVerdict,
  applySkip,
  applyDefer,
  applyStop,
  applyMarkSent,
  isComplete,
  progressOf,
  selectBatch,
  BATCH_SIZE,
  MAX_OPEN_TABS,
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

describe('applyDefer', () => {
  it('moves an open item to deferred without giving it a verdict', () => {
    const r = applyDefer(run([item({ status: 'open' })]), 'b:primary');
    expect(r.items[0].status).toBe('deferred');
    expect(r.items[0].verdict).toBeUndefined();
  });

  it('only defers from open — a pending item is left untouched', () => {
    const pending = item({ status: 'pending' });
    const r = applyDefer(run([pending]), 'b:primary');
    expect(r.items[0]).toEqual(pending);
  });

  it('never overrides an already-verdicted item (no-wedge)', () => {
    const verdicted = item({ status: 'verdicted', verdict: 'hit' });
    const r = applyDefer(run([verdicted]), 'b:primary');
    expect(r.items[0]).toEqual(verdicted);
  });

  it('re-deferring an already-deferred item is a no-op', () => {
    const deferred = item({ status: 'deferred' });
    const r = applyDefer(run([deferred]), 'b:primary');
    expect(r.items[0]).toEqual(deferred);
  });

  it('leaves other items untouched', () => {
    const two = run([item({ id: 'b:primary', status: 'open' }), item({ id: 'b:aka_0', status: 'open' })]);
    const r = applyDefer(two, 'b:primary');
    expect(r.items[1]).toEqual(two.items[1]);
  });
});

describe('applyStop', () => {
  it('skips pending, open, and deferred items but leaves verdicted ones alone', () => {
    const r = applyStop(
      run([
        item({ id: 'a', status: 'pending' }),
        item({ id: 'b', status: 'open' }),
        item({ id: 'd', status: 'deferred' }),
        item({ id: 'c', status: 'verdicted', verdict: 'hit' }),
      ]),
    );
    expect(r.items[0]).toMatchObject({ status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' });
    expect(r.items[1]).toMatchObject({ status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' });
    expect(r.items[2]).toMatchObject({ status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' });
    expect(r.items[3]).toMatchObject({ verdict: 'hit' });
  });
});

describe('isComplete', () => {
  it('is false while any pending, open, or deferred item remains', () => {
    expect(isComplete(run([item({ status: 'pending' })]))).toBe(false);
    expect(isComplete(run([item({ status: 'open' })]))).toBe(false);
    expect(isComplete(run([item({ status: 'deferred' })]))).toBe(false);
  });

  it('is true only when every item is verdicted', () => {
    expect(
      isComplete(run([
        item({ id: 'a', status: 'verdicted', verdict: 'clear' }),
        item({ id: 'b', status: 'verdicted', verdict: 'skipped', skipReason: 'missing:city' }),
      ])),
    ).toBe(true);
  });

  it('a lone deferred item keeps the run incomplete (deferred is non-terminal)', () => {
    expect(
      isComplete(run([
        item({ id: 'a', status: 'verdicted', verdict: 'hit' }),
        item({ id: 'b', status: 'deferred' }),
      ])),
    ).toBe(false);
  });
});

describe('progressOf', () => {
  it('excludes missing: skips from done and total, but counts them as neither', () => {
    const p = progressOf(run([
      item({ id: 'a', status: 'verdicted', verdict: 'clear' }),
      item({ id: 'b', status: 'pending' }),
      item({ id: 'm', status: 'verdicted', verdict: 'skipped', skipReason: 'missing:city' }),
    ]));
    expect(p).toEqual({ done: 1, total: 2, hits: 0 });
  });

  it('counts deferred toward total but not done', () => {
    const p = progressOf(run([
      item({ id: 'a', status: 'verdicted', verdict: 'hit' }),
      item({ id: 'd', status: 'deferred' }),
    ]));
    expect(p).toEqual({ done: 1, total: 2, hits: 1 });
  });

  it('counts hits across all items', () => {
    const p = progressOf(run([
      item({ id: 'a', status: 'verdicted', verdict: 'hit' }),
      item({ id: 'b', status: 'verdicted', verdict: 'hit' }),
      item({ id: 'c', status: 'verdicted', verdict: 'clear' }),
    ]));
    expect(p.hits).toBe(2);
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

  it('deferred items free their slot: a deferred broker leaves the full batch window open', () => {
    const items = [
      item({ id: 'b1:a', brokerId: 'b1', status: 'deferred' }),
      item({ id: 'b2:a', brokerId: 'b2', status: 'pending' }),
      item({ id: 'b3:a', brokerId: 'b3', status: 'pending' }),
    ];
    // deferred b1 holds a tab but no slot → a batch of 2 still opens both pending brokers
    expect(selectBatch(run(items), 2).toOpen.map(i => i.id)).toEqual(['b2:a', 'b3:a']);
  });

  it('claims a deferred item\'s broker: no second variant opens against it', () => {
    const items = [
      item({ id: 'b1:a', brokerId: 'b1', status: 'deferred' }),
      item({ id: 'b1:b', brokerId: 'b1', status: 'pending' }),
      item({ id: 'b2:a', brokerId: 'b2', status: 'pending' }),
    ];
    expect(selectBatch(run(items), 5).toOpen.map(i => i.id)).toEqual(['b2:a']);
  });

  it('pauses the batch window when open + deferred reaches the ceiling', () => {
    const items = [
      item({ id: 'b1:a', brokerId: 'b1', status: 'deferred' }),
      item({ id: 'b2:a', brokerId: 'b2', status: 'deferred' }),
      item({ id: 'b3:a', brokerId: 'b3', status: 'deferred' }),
      item({ id: 'b4:a', brokerId: 'b4', status: 'pending' }),
    ];
    // 3 deferred == ceiling of 3 → open nothing despite an idle batch window
    expect(selectBatch(run(items), 5, 3).toOpen).toHaveLength(0);
  });

  it('opens only up to the headroom left below the ceiling, counting open + deferred', () => {
    const items = [
      item({ id: 'b1:a', brokerId: 'b1', status: 'open' }),
      item({ id: 'b2:a', brokerId: 'b2', status: 'open' }),
      item({ id: 'b3:a', brokerId: 'b3', status: 'deferred' }),
      item({ id: 'b4:a', brokerId: 'b4', status: 'deferred' }),
      item({ id: 'b5:a', brokerId: 'b5', status: 'pending' }),
      item({ id: 'b6:a', brokerId: 'b6', status: 'pending' }),
    ];
    // heldTabs = 2 open + 2 deferred = 4; ceiling 5 → 1 slot of headroom, batch window has 3.
    expect(selectBatch(run(items), 5, 5).toOpen.map(i => i.id)).toEqual(['b5:a']);
  });

  it('applies the default MAX_OPEN_TABS ceiling of 15 when none is passed', () => {
    const deferred = Array.from({ length: 15 }, (_, i) =>
      item({ id: `d${i}`, brokerId: `bd${i}`, status: 'deferred' }));
    const items = [...deferred, item({ id: 'p', brokerId: 'bp', status: 'pending' })];
    expect(selectBatch(run(items), 5).toOpen).toHaveLength(0);
  });

  it('BATCH_SIZE default is 5, MAX_OPEN_TABS default is 15', () => {
    expect(BATCH_SIZE).toBe(5);
    expect(MAX_OPEN_TABS).toBe(15);
  });
});
