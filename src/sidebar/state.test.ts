import { describe, it, expect } from 'vitest';
import { deriveView, type SidebarFocus } from './state';
import type { SidebarView } from '../shared/types';
import { makeBroker as broker, makeItem as item, makeRun as run } from '../test-support/fixtures';

// Assert the view tag and return the narrowed variant so payload fields are type-checked.
function expectView<T extends SidebarView['view']>(v: SidebarView, tag: T): Extract<SidebarView, { view: T }> {
  expect(v.view).toBe(tag);
  return v as Extract<SidebarView, { view: T }>;
}

const focus = (over: Partial<SidebarFocus> = {}): SidebarFocus => ({
  item: item(),
  tabUrl: 'https://b.com/x',   // pathname '/x' — matches makeItem's renderedUrl → results page
  challenge: false,
  ...over,
});

// makeItem's renderedUrl is https://b.com/x (pathname '/x'); a tab on another pathname is a
// details page.
const DETAILS_URL = 'https://b.com/find/person/123';

const brokers = [broker()];

describe('deriveView — no-run', () => {
  it('null run → no-run, regardless of focus', () => {
    expect(deriveView(null, null, brokers)).toEqual({ view: 'no-run' });
    expect(deriveView(null, focus(), brokers)).toEqual({ view: 'no-run' });
  });
});

describe('deriveView — done', () => {
  it('every item verdicted → done with progress', () => {
    const r = run([item({ status: 'verdicted', verdict: 'hit' })]);
    const v = expectView(deriveView(r, null, brokers), 'done');
    expect(v.progress).toEqual({ done: 1, total: 1, hits: 1 });
  });

  it('done outranks a still-focused item (precedence 2 over 3–5)', () => {
    const r = run([item({ status: 'verdicted', verdict: 'clear' })]);
    // Tab still focused + even flagged as a challenge — done still wins.
    expect(deriveView(r, focus({ challenge: true }), brokers).view).toBe('done');
  });
});

describe('deriveView — stopped', () => {
  it('isComplete with a run_stopped item → stopped; checked excludes the abandoned ones', () => {
    const r = run([
      item({ id: 'a', status: 'verdicted', verdict: 'hit' }),
      item({ id: 'b', status: 'verdicted', verdict: 'clear' }),
      item({ id: 'c', status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' }),
    ]);
    const v = expectView(deriveView(r, null, brokers), 'stopped');
    expect(v).toMatchObject({ checked: 2, total: 3, hits: 1 });
  });

  it('a fully-verdicted run with no run_stopped item stays done', () => {
    expect(deriveView(run([item({ status: 'verdicted', verdict: 'clear' })]), null, brokers).view).toBe('done');
  });

  it('stopped wins over a still-focused item (isComplete precedence)', () => {
    const r = run([item({ status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' })]);
    expect(deriveView(r, focus({ challenge: true }), brokers).view).toBe('stopped');
  });

  it('total excludes missing: skips, checked excludes run_stopped', () => {
    const r = run([
      item({ id: 'm', status: 'verdicted', verdict: 'skipped', skipReason: 'missing:city' }),
      item({ id: 'a', status: 'verdicted', verdict: 'clear' }),
      item({ id: 's', status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' }),
    ]);
    const v = expectView(deriveView(r, null, brokers), 'stopped');
    expect(v).toMatchObject({ checked: 1, total: 2, hits: 0 });
  });
});

describe('deriveView — challenge / guidance / verdict (focused item)', () => {
  const incomplete = run([item({ status: 'open' })]);

  it('challenge flag → challenge view, outranking page-type', () => {
    // On the results page but a challenge is up → challenge, not guidance.
    const v = expectView(deriveView(incomplete, focus({ challenge: true }), brokers), 'challenge');
    expect(v.item.itemId).toBe('b:primary');
  });

  it('results page (matching pathname) → guidance', () => {
    const v = expectView(deriveView(incomplete, focus({ tabUrl: 'https://b.com/x?name=Jane' }), brokers), 'guidance');
    expect(v.item.pageType).toBe('results');
  });

  it('details page (different pathname) → verdict', () => {
    const v = expectView(deriveView(incomplete, focus({ tabUrl: DETAILS_URL }), brokers), 'verdict');
    expect(v.item.pageType).toBe('details');
  });

  it("null tab URL → offsite (can't confirm the tab is on the broker)", () => {
    expect(deriveView(incomplete, focus({ tabUrl: null }), brokers).view).toBe('offsite');
  });

  it('carries the broker exposes + guidance into the active-item payload', () => {
    const bk = broker({ search: { url: 'https://b.com/x', requires: [], exposes: ['full name', 'age'], guidance: 'Scroll past the sponsored results.' } });
    const v = expectView(deriveView(incomplete, focus({ tabUrl: DETAILS_URL }), [bk]), 'verdict');
    expect(v.item.exposes).toEqual(['full name', 'age']);
    expect(v.item.guidance).toBe('Scroll past the sponsored results.');
    expect(v.item.renderedUrl).toBe('https://b.com/x');
  });

  it('omits guidance when the broker defines none', () => {
    const v = expectView(deriveView(incomplete, focus({ tabUrl: DETAILS_URL }), brokers), 'verdict');
    expect(v.item.guidance).toBeUndefined();
  });

  it('unknown broker (not in the dataset) → empty exposes, still derives', () => {
    const v = expectView(deriveView(incomplete, focus({ tabUrl: DETAILS_URL }), []), 'verdict');
    expect(v.item.exposes).toEqual([]);
    expect(v.item.guidance).toBeUndefined();
  });
});

describe('deriveView — revisit', () => {
  it('a lone deferred item, nothing focused → revisit (not no-run)', () => {
    const v = expectView(deriveView(run([item({ status: 'deferred' })]), null, brokers), 'revisit');
    expect(v.waiting).toBe(1);
    expect(v.focusId).toBe('b:primary');
    expect(v.progress).toEqual({ done: 0, total: 1, hits: 0 });
  });

  // Finding #2: selectBatch claims deferred brokers, so a pending AKA behind a deferred
  // sibling has no open tab to act on. focus=null must route to revisit, never no-run.
  it('pending blocked behind a deferred sibling broker, focus=null → revisit', () => {
    const r = run([
      item({ id: 'b:primary', status: 'deferred' }),
      item({ id: 'b:aka_0', nameVariant: 'aka_0', status: 'pending' }),
    ]);
    const v = deriveView(r, null, brokers);
    expect(v.view).not.toBe('no-run');
    const rv = expectView(v, 'revisit');
    expect(rv.waiting).toBe(2);
    expect(rv.focusId).toBe('b:primary'); // first deferred, not the blocked pending sibling
  });

  it('focusId falls back to the first pending when no deferred remain', () => {
    const v = expectView(deriveView(run([item({ status: 'pending' })]), null, brokers), 'revisit');
    expect(v.focusId).toBe('b:primary');
  });

  it('focus present but on a non-broker tab (item=null), run incomplete → revisit', () => {
    const r = run([item({ status: 'open' })]);
    const v = deriveView(r, { item: null, tabUrl: 'https://mail.example/inbox', challenge: false }, brokers);
    expect(v.view).toBe('revisit');
  });

  it('challenge flag without a mapped item does not force challenge → revisit', () => {
    const r = run([item({ status: 'open' })]);
    expect(deriveView(r, { item: null, tabUrl: null, challenge: true }, brokers).view).toBe('revisit');
  });

  it('excludes missing: skips from the waiting count', () => {
    const r = run([
      item({ id: 'b:primary', status: 'deferred' }),
      item({ id: 'b:aka_0', nameVariant: 'aka_0', status: 'verdicted', verdict: 'skipped', skipReason: 'missing:city' }),
    ]);
    const v = expectView(deriveView(r, null, brokers), 'revisit');
    expect(v.waiting).toBe(1);
    expect(v.progress.total).toBe(1);
  });
});

describe('deriveView — results↔details boundary', () => {
  const incomplete = run([item({ status: 'open' })]);

  it('flips guidance↔verdict on the tab URL alone', () => {
    expect(deriveView(incomplete, focus({ tabUrl: 'https://b.com/x?q=1' }), brokers).view).toBe('guidance');
    expect(deriveView(incomplete, focus({ tabUrl: 'https://b.com/x/2' }), brokers).view).toBe('verdict');
  });
});

describe('deriveView — offsite (tab left the broker host)', () => {
  const incomplete = run([item({ status: 'open' })]); // makeItem renderedUrl = https://b.com/x

  it('an off-host tab → offsite, not verdict (no confirming a listing off the broker)', () => {
    const v = expectView(deriveView(incomplete, focus({ tabUrl: 'https://www.google.com/' }), brokers), 'offsite');
    expect(v.item.itemId).toBe('b:primary');
  });

  it('a lookalike host with the results pathname is still offsite (checks host, not just path)', () => {
    // renderedUrl pathname is /x; an off-host page at /x must not read as the results page.
    expect(deriveView(incomplete, focus({ tabUrl: 'https://evil.example/x' }), brokers).view).toBe('offsite');
  });

  it('challenge still wins even when off-host (Cloudflare interstitial)', () => {
    expect(deriveView(incomplete, focus({ tabUrl: 'https://challenges.cloudflare.com/x', challenge: true }), brokers).view).toBe('challenge');
  });

  it('on-host pages are unaffected: results → guidance, details → verdict', () => {
    expect(deriveView(incomplete, focus({ tabUrl: 'https://b.com/x?q=1' }), brokers).view).toBe('guidance');
    expect(deriveView(incomplete, focus({ tabUrl: 'https://b.com/find/1' }), brokers).view).toBe('verdict');
  });
});

describe('deriveView — only ever returns resting views', () => {
  const resting = new Set(['no-run', 'guidance', 'verdict', 'challenge', 'offsite', 'revisit', 'done', 'stopped']);
  const cases: Array<[RunOrNull, SidebarFocus | null]> = [
    [null, null],
    [run([item({ status: 'verdicted', verdict: 'hit' })]), focus()],
    [run([item({ status: 'open' })]), focus({ challenge: true })],
    [run([item({ status: 'open' })]), focus()],
    [run([item({ status: 'open' })]), focus({ tabUrl: DETAILS_URL })],
    [run([item({ status: 'open' })]), focus({ tabUrl: 'https://www.google.com/' })],
    [run([item({ status: 'deferred' })]), null],
    [run([item({ status: 'verdicted', verdict: 'skipped', skipReason: 'run_stopped' })]), null],
  ];
  it('never emits the transient saving/recorded states', () => {
    for (const [r, f] of cases) {
      expect(resting.has(deriveView(r, f, brokers).view)).toBe(true);
    }
  });
});

type RunOrNull = ReturnType<typeof run> | null;
