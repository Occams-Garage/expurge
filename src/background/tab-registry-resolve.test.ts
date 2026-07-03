import { describe, it, expect } from 'vitest';
import {
  tabForItem,
  brokerTabInWindow,
  tabKey,
  challengeKey,
  parseTabKey,
  isPerTabKey,
  type TabSnapshot,
  type TabFacts,
} from './tab-registry-resolve';
import { makeItem as item, makeRun as run } from '../test-support/fixtures';

// makeItem default renderedUrl is https://b.com/x → on-host tab URLs use https://b.com/…,
// off-host (a mid-redirect CDN hop) uses https://challenges.cloudflare.com/….
const ON_HOST = 'https://b.com/details/1';
const OFF_HOST = 'https://challenges.cloudflare.com/turnstile';

const facts = (over: Partial<TabFacts> & { tabId: number }): TabFacts => ({
  windowId: 1,
  url: ON_HOST,
  active: false,
  ...over,
});

describe('key helpers', () => {
  it('tabKey / challengeKey build the two families', () => {
    expect(tabKey(7)).toBe('expurge_tab_7');
    expect(challengeKey(7)).toBe('expurge_challenge_7');
  });

  it('parseTabKey extracts the id from a tab key, rejects everything else', () => {
    expect(parseTabKey('expurge_tab_42')).toBe(42);
    expect(parseTabKey('expurge_challenge_42')).toBeNull(); // challenge key, not a tab key
    expect(parseTabKey('expurge_run')).toBeNull();
    expect(parseTabKey('expurge_tab_notanumber')).toBeNull();
  });

  it('isPerTabKey matches BOTH families but never the run/profile keys', () => {
    expect(isPerTabKey('expurge_tab_42')).toBe(true);
    expect(isPerTabKey('expurge_challenge_42')).toBe(true);
    expect(isPerTabKey('expurge_run')).toBe(false); // must survive the Stop sweep
    expect(isPerTabKey('expurge_profile')).toBe(false);
    expect(isPerTabKey('something_else')).toBe(false);
  });
});

describe('tabForItem', () => {
  it('returns the tabId whose entry matches the itemId', () => {
    const snap: TabSnapshot = { 5: { itemId: 'b:primary' } };
    expect(tabForItem(snap, 'b:primary')).toBe(5);
  });

  it('with multiple entries, returns the matching one and ignores the others', () => {
    const snap: TabSnapshot = {
      5: { itemId: 'b:primary' },
      6: { itemId: 'c:primary' },
      7: { itemId: 'd:primary' },
    };
    expect(tabForItem(snap, 'c:primary')).toBe(6);
  });

  it('returns null when no entry matches', () => {
    const snap: TabSnapshot = { 5: { itemId: 'b:primary' } };
    expect(tabForItem(snap, 'z:primary')).toBeNull();
  });

  it('returns null on an empty snapshot', () => {
    expect(tabForItem({}, 'b:primary')).toBeNull();
  });
});

describe('brokerTabInWindow', () => {
  it('active-preference: an active tracked tab wins even off-host, over an on-host sibling', () => {
    const snap: TabSnapshot = {
      5: { itemId: 'b:primary' },
      6: { itemId: 'c:primary' },
    };
    const tabs = [
      facts({ tabId: 5, url: ON_HOST, active: false }),
      facts({ tabId: 6, url: OFF_HOST, active: true }), // active but off-host → still wins
    ];
    const r = run([item({ id: 'b:primary' }), item({ id: 'c:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(6);
  });

  it('an active tab in a DIFFERENT window does not win — window scoping precedes active-preference', () => {
    const snap: TabSnapshot = {
      5: { itemId: 'b:primary' },
      6: { itemId: 'c:primary' },
    };
    const tabs = [
      facts({ tabId: 5, url: ON_HOST, active: true, windowId: 2 }), // active, but other window
      facts({ tabId: 6, url: ON_HOST, active: false, windowId: 1 }),
    ];
    const r = run([item({ id: 'b:primary' }), item({ id: 'c:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(6);
  });

  it('an active tab that is not tracked does not win — falls through to the scan', () => {
    const snap: TabSnapshot = { 5: { itemId: 'b:primary' } };
    const tabs = [
      facts({ tabId: 9, active: true }), // active but untracked (not in snapshot)
      facts({ tabId: 5, url: ON_HOST, active: false }),
    ];
    const r = run([item({ id: 'b:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(5);
  });

  it('no active tab → first on-host tracked tab, not the off-host one', () => {
    const snap: TabSnapshot = {
      5: { itemId: 'b:primary' },
      6: { itemId: 'c:primary' },
    };
    const tabs = [
      facts({ tabId: 5, url: OFF_HOST }),
      facts({ tabId: 6, url: ON_HOST }),
    ];
    const r = run([item({ id: 'b:primary' }), item({ id: 'c:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(6);
  });

  it('off-host-only tracked tab is returned as the fallback (not null)', () => {
    const snap: TabSnapshot = { 5: { itemId: 'b:primary' } };
    const tabs = [facts({ tabId: 5, url: OFF_HOST })];
    const r = run([item({ id: 'b:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(5);
  });

  it('with two off-host tabs and no on-host tab, the FIRST is the fallback (later ones do not overwrite)', () => {
    const snap: TabSnapshot = {
      5: { itemId: 'b:primary' },
      6: { itemId: 'c:primary' },
    };
    const tabs = [
      facts({ tabId: 5, url: OFF_HOST }),
      facts({ tabId: 6, url: OFF_HOST }),
    ];
    const r = run([item({ id: 'b:primary' }), item({ id: 'c:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(5);
  });

  it('on-host beats off-host regardless of list order', () => {
    const snap: TabSnapshot = {
      5: { itemId: 'b:primary' }, // off-host, listed first
      6: { itemId: 'c:primary' }, // on-host, listed second
    };
    const tabs = [
      facts({ tabId: 5, url: OFF_HOST }),
      facts({ tabId: 6, url: ON_HOST }),
    ];
    const r = run([item({ id: 'b:primary' }), item({ id: 'c:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(6);
  });

  it('window scoping: a tracked tab in another window is ignored', () => {
    const snap: TabSnapshot = {
      5: { itemId: 'b:primary' },
      6: { itemId: 'c:primary' },
    };
    const tabs = [
      facts({ tabId: 5, url: ON_HOST, windowId: 2 }), // other window
      facts({ tabId: 6, url: ON_HOST, windowId: 1 }),
    ];
    const r = run([item({ id: 'b:primary' }), item({ id: 'c:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(6);
  });

  it('returns null when the only tracked tab is in another window', () => {
    const snap: TabSnapshot = { 5: { itemId: 'b:primary' } };
    const tabs = [facts({ tabId: 5, url: ON_HOST, windowId: 2 })];
    const r = run([item({ id: 'b:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBeNull();
  });

  it('returns null when no live tab is tracked', () => {
    const snap: TabSnapshot = { 5: { itemId: 'b:primary' } };
    const tabs = [facts({ tabId: 9, active: true })]; // present but untracked
    const r = run([item({ id: 'b:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBeNull();
  });

  it('returns null on empty tabs', () => {
    const snap: TabSnapshot = { 5: { itemId: 'b:primary' } };
    const r = run([item({ id: 'b:primary' })]);
    expect(brokerTabInWindow(snap, [], r, 1)).toBeNull();
  });

  it('a tracked tab with no url yet (mid-load) is treated as the broker tab, not skipped', () => {
    const snap: TabSnapshot = { 5: { itemId: 'b:primary' } };
    const tabs = [facts({ tabId: 5, url: null })];
    const r = run([item({ id: 'b:primary' })]);
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(5);
  });

  it('a tracked tab whose item is not in the run is returned (no off-host check possible)', () => {
    const snap: TabSnapshot = { 5: { itemId: 'ghost:primary' } };
    const tabs = [facts({ tabId: 5, url: OFF_HOST })];
    const r = run([item({ id: 'b:primary' })]); // ghost not present
    expect(brokerTabInWindow(snap, tabs, r, 1)).toBe(5);
  });
});
