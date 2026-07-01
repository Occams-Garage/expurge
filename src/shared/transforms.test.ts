import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizeAkas, renderUrl } from './transforms';
import type { Profile } from './types';

describe('normalizeAkas — legacy string bridge', () => {
  it('non-array inputs → []', () => {
    for (const v of [undefined, null, 'x', 42, {}, true]) {
      expect(normalizeAkas(v)).toEqual([]);
    }
  });

  it('2-token string → first/last, no middle', () => {
    expect(normalizeAkas(['Jane Smith'])).toEqual([{ first: 'Jane', last: 'Smith' }]);
  });

  it('3-token string → middle is the middle token (#6, not folded into last)', () => {
    expect(normalizeAkas(['Jane Marie Smith'])).toEqual([
      { first: 'Jane', last: 'Smith', middle: 'Marie' },
    ]);
  });

  it('4-token string → middle joins the interior tokens', () => {
    expect(normalizeAkas(['Jane Anne Marie Smith'])).toEqual([
      { first: 'Jane', last: 'Smith', middle: 'Anne Marie' },
    ]);
  });

  it('single-token and blank strings are dropped', () => {
    expect(normalizeAkas(['Madonna', '', '   '])).toEqual([]);
  });

  it('collapses interior and edge whitespace', () => {
    expect(normalizeAkas(['  Jane   Smith  '])).toEqual([{ first: 'Jane', last: 'Smith' }]);
  });
});

describe('normalizeAkas — object entries', () => {
  it('valid entries kept; empty middle omitted', () => {
    expect(normalizeAkas([{ first: 'A', last: 'B' }])).toEqual([{ first: 'A', last: 'B' }]);
    expect(normalizeAkas([{ first: 'A', last: 'B', middle: 'C' }])).toEqual([
      { first: 'A', last: 'B', middle: 'C' },
    ]);
  });

  it('entries missing first or last are dropped', () => {
    expect(
      normalizeAkas([{ first: 'A' }, { last: 'B' }, { first: '', last: 'B' }, { first: 'A', last: '  ' }]),
    ).toEqual([]);
  });

  it('non-string fields are coerced/dropped without throwing (#4 hardening)', () => {
    expect(() => normalizeAkas([{ first: 42, last: 'B' }])).not.toThrow();
    expect(normalizeAkas([{ first: 42, last: 'B' }])).toEqual([]);
    expect(normalizeAkas([{ first: 'A', last: 'B', middle: 99 }])).toEqual([{ first: 'A', last: 'B' }]);
  });

  it('mixed string/object array preserves order', () => {
    expect(normalizeAkas(['Jane Smith', { first: 'Bob', last: 'Jones' }])).toEqual([
      { first: 'Jane', last: 'Smith' },
      { first: 'Bob', last: 'Jones' },
    ]);
  });
});

describe('normalizeAkas — properties', () => {
  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (x) => {
        normalizeAkas(x);
        return true;
      }),
    );
  });

  it('every result has trimmed non-empty first + last, and non-empty middle when present', () => {
    const entry = fc.oneof(
      fc.string(),
      fc.record(
        { first: fc.string(), middle: fc.string(), last: fc.string() },
        { requiredKeys: [] },
      ),
    );
    // Return a boolean so fast-check can shrink to a minimal counterexample (an expect()
    // that throws inside the property defeats shrinking). The example tests above exercise
    // the valid path with concrete assertions; this proves NO arbitrary input violates it.
    fc.assert(
      fc.property(fc.array(entry), (arr) =>
        normalizeAkas(arr).every(
          (a) =>
            a.first.length > 0 &&
            a.first === a.first.trim() &&
            a.last.length > 0 &&
            a.last === a.last.trim() &&
            (a.middle === undefined || a.middle.length > 0),
        ),
      ),
    );
  });
});

describe('renderUrl', () => {
  const p: Profile = { first: 'Jane', last: 'Doe', city: 'San Jose', state: 'CA' };

  it('substitutes {name|q} and {citystate|q} with URL encoding', () => {
    expect(renderUrl('https://x.com/s?n={name|q}&cs={citystate|q}', p)).toBe(
      'https://x.com/s?n=Jane%20Doe&cs=San%20Jose%2C%20CA',
    );
  });

  it('bare tokens without a transform', () => {
    expect(renderUrl('{first}-{last}', p)).toBe('Jane-Doe');
  });

  it('unknown token → empty string', () => {
    expect(renderUrl('a{nope}b', p)).toBe('ab');
  });

  it('unknown transform → identity', () => {
    expect(renderUrl('{first|bogus}', p)).toBe('Jane');
  });

  it('slug transform lowercases and hyphenates', () => {
    expect(renderUrl('{name|slug}', p)).toBe('jane-doe');
  });

  it('upper transform', () => {
    expect(renderUrl('{state|upper}', p)).toBe('CA');
  });
});
