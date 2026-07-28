import { describe, expect, it } from 'vitest';
import { makeItem, makeRun } from '../test-support/fixtures';
import type {
  BrokerRunResult,
  RunMetadata,
  StoragePrefs,
  StoragePromptId,
  StoragePromptsSeen,
  WorkItem,
} from './types';
import {
  DEFAULT_STORAGE_PROMPTS_SEEN,
  coerceRunMetadata,
  deriveRunMetadata,
  isStoragePromptId,
  isStoragePromptEligible,
  markStoragePromptSeen,
  mergeRunMetadata,
  mergeRunMetadataForRun,
  mergeStoragePromptsSeen,
  runStorageDestination,
  selectRunForLoad,
  stampCompletedAt,
  stampCompletionTransition,
  type StoragePromptContext,
} from './persistence';

const COMPLETE_AT = '2026-07-27T18:30:00.000Z';

function completeItem(over: Partial<WorkItem> = {}): WorkItem {
  return makeItem({ status: 'verdicted', verdict: 'clear', ...over });
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)])
      .map(rest => [value, ...rest]),
  );
}

describe('stampCompletedAt', () => {
  it.each(['pending', 'open', 'deferred'] as const)(
    'leaves a run with a %s item unstamped',
    status => {
      const run = makeRun([makeItem({ status })]);
      expect(stampCompletedAt(run, COMPLETE_AT)).toBe(run);
      expect(run).not.toHaveProperty('completedAt');
    },
  );

  it('stamps a complete run, including an initially empty run', () => {
    const complete = makeRun([completeItem()]);
    expect(stampCompletedAt(complete, COMPLETE_AT)).toEqual({
      ...complete,
      completedAt: COMPLETE_AT,
    });
    expect(complete).not.toHaveProperty('completedAt');
    expect(stampCompletedAt(makeRun([]), COMPLETE_AT).completedAt).toBe(COMPLETE_AT);
  });

  it('preserves the first completion timestamp on later saves and re-verdicts', () => {
    const stamped = {
      ...makeRun([completeItem({ verdict: 'hit' })]),
      completedAt: COMPLETE_AT,
    };
    const reverdict = {
      ...stamped,
      items: [completeItem({ verdict: 'unknown' })],
    };

    expect(stampCompletedAt(stamped, '2026-07-28T00:00:00.000Z')).toBe(stamped);
    expect(stampCompletedAt(reverdict, '2026-07-28T00:00:00.000Z')).toBe(reverdict);
    expect(stampCompletedAt(reverdict, '2026-07-28T00:00:00.000Z').completedAt)
      .toBe(COMPLETE_AT);
  });
});

describe('stampCompletionTransition', () => {
  it('stamps only when an incomplete run becomes complete', () => {
    const before = makeRun([makeItem({ status: 'open' })]);
    const after = {
      ...before,
      items: [completeItem({ verdict: 'hit' })],
    };
    expect(stampCompletionTransition(before, after, COMPLETE_AT)).toEqual({
      ...after,
      completedAt: COMPLETE_AT,
    });
  });

  it('does not date a legacy complete run during a later re-verdict or mark-sent edit', () => {
    const legacy = makeRun([completeItem({ verdict: 'hit' })]);
    const reverdict = {
      ...legacy,
      items: [completeItem({ verdict: 'clear' })],
    };
    const markedSent = {
      ...legacy,
      items: [completeItem({ verdict: 'hit', optedOutAt: COMPLETE_AT })],
    };
    expect(stampCompletionTransition(legacy, reverdict, COMPLETE_AT)).toBe(reverdict);
    expect(stampCompletionTransition(legacy, markedSent, COMPLETE_AT)).toBe(markedSent);
    expect(reverdict).not.toHaveProperty('completedAt');
    expect(markedSent).not.toHaveProperty('completedAt');
  });
});

describe('runStorageDestination', () => {
  const incomplete = makeRun([makeItem({ status: 'pending' })]);
  const complete = makeRun([completeItem()]);
  const prefs = (
    profileStorage: boolean,
    richHistory: boolean,
    runMetadata = false,
  ): StoragePrefs => ({ profileStorage, runMetadata, richHistory });

  it.each([
    ['profile off, incomplete', prefs(false, false), incomplete, 'session'],
    ['profile off, complete (metadata independent)', prefs(false, false, true), complete, 'session'],
    ['profile on, history off, incomplete', prefs(true, false), incomplete, 'local'],
    ['profile on, history off, complete', prefs(true, false), complete, 'session'],
    ['profile and history on, incomplete', prefs(true, true), incomplete, 'local'],
    ['profile and history on, complete', prefs(true, true), complete, 'local'],
  ] satisfies Array<[string, StoragePrefs, typeof complete, 'local' | 'session']>)(
    'routes %s',
    (_label, storagePrefs, run, expected) => {
      expect(runStorageDestination(storagePrefs, run)).toBe(expected);
    },
  );

  it('uses item lifecycle rather than trusting completedAt alone', () => {
    const inconsistent = {
      ...incomplete,
      completedAt: COMPLETE_AT,
    };
    const prefs: StoragePrefs = {
      profileStorage: true,
      runMetadata: false,
      richHistory: false,
    };
    expect(runStorageDestination(prefs, inconsistent)).toBe('local');
  });

  it('fails closed to session when invalid preferences claim rich history without profile storage', () => {
    const inconsistentPrefs: StoragePrefs = {
      profileStorage: false,
      runMetadata: false,
      richHistory: true,
    };
    expect(runStorageDestination(inconsistentPrefs, complete)).toBe('session');
  });
});

describe('selectRunForLoad', () => {
  const incomplete = (runId: string, createdAt: string) => ({
    ...makeRun([makeItem({ status: 'pending' })]),
    runId,
    createdAt,
  });
  const complete = (runId: string, createdAt: string) => ({
    ...makeRun([completeItem()]),
    runId,
    createdAt,
    completedAt: COMPLETE_AT,
  });
  const prefs = (
    profileStorage: boolean,
    richHistory: boolean,
  ): StoragePrefs => ({ profileStorage, runMetadata: false, richHistory });

  it('profile storage off reads session only and never resurrects a local copy', () => {
    const session = incomplete('session', '2026-07-01T00:00:00Z');
    expect(selectRunForLoad(prefs(false, false), {
      local: complete('local-newer', '2026-07-28T00:00:00Z'),
      session,
    })).toBe(session);
    expect(selectRunForLoad(prefs(false, false), {
      local: incomplete('local-only', '2026-07-28T00:00:00Z'),
      session: null,
    })).toBeNull();
  });

  it('profile and rich history on read local only', () => {
    const local = complete('local', '2026-07-01T00:00:00Z');
    expect(selectRunForLoad(prefs(true, true), {
      local,
      session: complete('session-newer', '2026-07-28T00:00:00Z'),
    })).toBe(local);
    expect(selectRunForLoad(prefs(true, true), {
      local: null,
      session: complete('session-only', '2026-07-28T00:00:00Z'),
    })).toBeNull();
  });

  it('profile on and rich history off accepts a local incomplete checkpoint', () => {
    const local = incomplete('local', '2026-07-28T00:00:00Z');
    expect(selectRunForLoad(prefs(true, false), { local, session: null })).toBe(local);
  });

  it('profile on and rich history off accepts a completed session run', () => {
    const session = complete('session', '2026-07-28T00:00:00Z');
    expect(selectRunForLoad(prefs(true, false), { local: null, session })).toBe(session);
  });

  it('never resurrects a completed local run while rich history is off', () => {
    expect(selectRunForLoad(prefs(true, false), {
      local: complete('forbidden', '2026-07-28T00:00:00Z'),
      session: null,
    })).toBeNull();
  });

  it('never accepts an incomplete session run while profile storage is on', () => {
    expect(selectRunForLoad(prefs(true, false), {
      local: null,
      session: incomplete('wrong-area', '2026-07-28T00:00:00Z'),
    })).toBeNull();
  });

  it('prefers the completed destination copy left by an interrupted same-run move', () => {
    const local = incomplete('same', '2026-07-01T00:00:00Z');
    const session = complete('same', '2026-07-01T00:00:00Z');
    expect(selectRunForLoad(prefs(true, false), { local, session })).toBe(session);
  });

  it('uses createdAt to resolve valid copies from different runs after an interrupted replacement', () => {
    const oldSession = complete('old', '2026-07-01T00:00:00Z');
    const newLocal = incomplete('new', '2026-07-28T00:00:00Z');
    expect(selectRunForLoad(prefs(true, false), {
      local: newLocal,
      session: oldSession,
    })).toBe(newLocal);

    const newerSession = complete('newest', '2026-07-29T00:00:00Z');
    expect(selectRunForLoad(prefs(true, false), {
      local: newLocal,
      session: newerSession,
    })).toBe(newerSession);
  });

  it('selects a newer initially-complete run over the previous incomplete checkpoint', () => {
    const oldLocal = incomplete('old-incomplete', '2026-07-27T00:00:00Z');
    const newSession = complete('new-initially-complete', '2026-07-28T00:00:00Z');
    expect(selectRunForLoad(prefs(true, false), {
      local: oldLocal,
      session: newSession,
    })).toBe(newSession);
  });

  it('fails closed to the session copy on equal or malformed createdAt values', () => {
    const local = incomplete('local', 'malformed');
    const session = complete('session', 'also-malformed');
    expect(selectRunForLoad(prefs(true, false), { local, session })).toBe(session);
  });
});

describe('deriveRunMetadata', () => {
  function stampedRun(items: WorkItem[]) {
    return { ...makeRun(items), completedAt: COMPLETE_AT };
  }

  it('requires a stable completion timestamp', () => {
    expect(deriveRunMetadata(makeRun([completeItem()]))).toEqual({});
    expect(deriveRunMetadata({
      ...makeRun([completeItem()]),
      completedAt: 'not-an-iso-timestamp',
    })).toEqual({});
  });

  it('emits only checkedAt and the closed-set result for each attempted broker', () => {
    const run = stampedRun([
      completeItem({
        brokerId: 'people-finder',
        verdict: 'hit',
        renderedUrl: 'https://secret.example/search?name=Jane',
        listingUrl: 'https://secret.example/jane',
        matchedAs: 'primary',
        optedOutAt: '2026-07-28T00:00:00.000Z',
      }),
    ]);

    expect(deriveRunMetadata(run)).toEqual({
      'people-finder': { checkedAt: COMPLETE_AT, result: 'hit' },
    });
  });

  it.each([
    [['skipped'], 'skipped'],
    [['skipped', 'clear'], 'clear'],
    [['clear', 'unknown'], 'unknown'],
    [['unknown', 'hit'], 'hit'],
  ] as Array<[BrokerRunResult[], BrokerRunResult]>)(
    'rolls up AKA results %j using hit > unknown > clear > skipped',
    (verdicts, expected) => {
      const items = verdicts.map((verdict, index) => completeItem({
        id: `broker:${index === 0 ? 'primary' : `aka_${index - 1}`}`,
        brokerId: 'broker',
        nameVariant: index === 0 ? 'primary' : `aka_${index - 1}`,
        verdict,
        ...(verdict === 'skipped' ? { skipReason: 'challenge' as const } : {}),
      }));
      expect(deriveRunMetadata(stampedRun(items))).toEqual({
        broker: { checkedAt: COMPLETE_AT, result: expected },
      });
    },
  );

  it('applies precedence independently of primary/AKA item order', () => {
    const verdicts: BrokerRunResult[] = ['hit', 'unknown', 'clear', 'skipped'];
    for (const order of permutations(verdicts)) {
      const items = order.map((verdict, index) => completeItem({
        id: `broker:${index}`,
        brokerId: 'broker',
        verdict,
        ...(verdict === 'skipped' ? { skipReason: 'load_error' as const } : {}),
      }));
      expect(deriveRunMetadata(stampedRun(items))).toEqual({
        broker: { checkedAt: COMPLETE_AT, result: 'hit' },
      });
    }
  });

  it('aggregates brokers independently', () => {
    const items = [
      completeItem({ id: 'a:primary', brokerId: 'a', verdict: 'clear' }),
      completeItem({ id: 'a:aka_0', brokerId: 'a', verdict: 'hit' }),
      completeItem({ id: 'b:primary', brokerId: 'b', verdict: 'unknown' }),
    ];
    expect(deriveRunMetadata(stampedRun(items))).toEqual({
      a: { checkedAt: COMPLETE_AT, result: 'hit' },
      b: { checkedAt: COMPLETE_AT, result: 'unknown' },
    });
  });

  it.each([
    'missing:city',
    'missing:emails',
    'permission_denied',
    'run_stopped',
  ] as const)('excludes non-attempted skip reason %s', skipReason => {
    const item = completeItem({ verdict: 'skipped', skipReason });
    expect(deriveRunMetadata(stampedRun([item]))).toEqual({});
  });

  it('excludes non-attempts without hiding another attempted variant for that broker', () => {
    const items = [
      completeItem({
        id: 'b:primary',
        verdict: 'skipped',
        skipReason: 'permission_denied',
      }),
      completeItem({
        id: 'b:aka_0',
        nameVariant: 'aka_0',
        verdict: 'clear',
      }),
    ];
    expect(deriveRunMetadata(stampedRun(items))).toEqual({
      b: { checkedAt: COMPLETE_AT, result: 'clear' },
    });
  });

  it('does not let a stale skip reason exclude a non-skipped re-verdict', () => {
    const item = completeItem({
      verdict: 'hit',
      skipReason: 'permission_denied',
    });
    expect(deriveRunMetadata(stampedRun([item]))).toEqual({
      b: { checkedAt: COMPLETE_AT, result: 'hit' },
    });
  });

  it.each(['tab_closed', 'challenge', 'load_error'] as const)(
    'includes attempted skipped outcome %s',
    skipReason => {
      const item = completeItem({ verdict: 'skipped', skipReason });
      expect(deriveRunMetadata(stampedRun([item]))).toEqual({
        b: { checkedAt: COMPLETE_AT, result: 'skipped' },
      });
    },
  );

  it('does not derive partial metadata unless the entire run is terminal', () => {
    const items = [
      completeItem({ id: 'a:primary', brokerId: 'a', verdict: 'clear' }),
      makeItem({ id: 'b:primary', brokerId: 'b', status: 'open', verdict: 'hit' }),
    ];
    expect(deriveRunMetadata(stampedRun(items))).toEqual({});
  });
});

describe('run metadata coercion and merge', () => {
  const oldMetadata: RunMetadata = {
    old: { checkedAt: '2026-07-01T00:00:00Z', result: 'clear' },
    refreshed: { checkedAt: '2026-07-02T00:00:00Z', result: 'unknown' },
  };

  it('preserves brokers absent from the newest run and replaces brokers present in it', () => {
    expect(mergeRunMetadata(oldMetadata, {
      refreshed: { checkedAt: COMPLETE_AT, result: 'hit' },
      new: { checkedAt: COMPLETE_AT, result: 'skipped' },
    })).toEqual({
      old: oldMetadata.old,
      refreshed: { checkedAt: COMPLETE_AT, result: 'hit' },
      new: { checkedAt: COMPLETE_AT, result: 'skipped' },
    });
  });

  it('backfills a completed run while preserving brokers absent from it', () => {
    const run = {
      ...makeRun([
        completeItem({ id: 'refreshed:primary', brokerId: 'refreshed', verdict: 'hit' }),
        completeItem({ id: 'new:primary', brokerId: 'new', verdict: 'clear' }),
      ]),
      completedAt: COMPLETE_AT,
    };
    expect(mergeRunMetadataForRun(oldMetadata, run)).toEqual({
      old: oldMetadata.old,
      refreshed: { checkedAt: COMPLETE_AT, result: 'hit' },
      new: { checkedAt: COMPLETE_AT, result: 'clear' },
    });
  });

  it('updates a re-verdict result without changing the stable checkedAt', () => {
    const run = {
      ...makeRun([completeItem({ brokerId: 'refreshed', verdict: 'clear' })]),
      completedAt: COMPLETE_AT,
    };
    const afterReverdict = {
      ...run,
      items: [completeItem({ brokerId: 'refreshed', verdict: 'unknown' })],
    };

    const first = mergeRunMetadataForRun({}, run);
    expect(mergeRunMetadataForRun(first, afterReverdict)).toEqual({
      refreshed: { checkedAt: COMPLETE_AT, result: 'unknown' },
    });
  });

  it('leaves stored metadata unchanged for incomplete or unstamped runs', () => {
    const incomplete = makeRun([makeItem({ status: 'open' })]);
    const unstamped = makeRun([completeItem({ verdict: 'hit' })]);
    expect(mergeRunMetadataForRun(oldMetadata, incomplete)).toEqual(oldMetadata);
    expect(mergeRunMetadataForRun(oldMetadata, unstamped)).toEqual(oldMetadata);
  });

  it.each([undefined, null, true, 42, 'metadata', [], new Date()] as unknown[])(
    'coerces malformed top-level value %j to empty metadata',
    raw => {
      expect(coerceRunMetadata(raw)).toEqual({});
    },
  );

  it('drops malformed entries independently and strips unknown nested fields', () => {
    expect(coerceRunMetadata({
      good: {
        checkedAt: COMPLETE_AT,
        result: 'clear',
        listingUrl: 'https://must-not-survive.example',
      },
      badDate: { checkedAt: 'yesterday', result: 'hit' },
      dateOnly: { checkedAt: '2026-07-27', result: 'hit' },
      normalizedDate: { checkedAt: '2026-02-30T00:00:00.000Z', result: 'hit' },
      impossibleMonth: { checkedAt: '2026-13-01T00:00:00.000Z', result: 'hit' },
      nonUtcDate: { checkedAt: '2026-07-27T18:30:00-04:00', result: 'hit' },
      badResult: { checkedAt: COMPLETE_AT, result: 'listed' },
      missingDate: { result: 'clear' },
      nullEntry: null,
      arrayEntry: [COMPLETE_AT, 'hit'],
    })).toEqual({
      good: { checkedAt: COMPLETE_AT, result: 'clear' },
    });
  });

  it('returns sanitized copies rather than aliases into unknown durable data', () => {
    const raw = {
      good: { checkedAt: COMPLETE_AT, result: 'clear', privateField: 'drop me' },
    };
    const coerced = coerceRunMetadata(raw);
    expect(coerced.good).not.toBe(raw.good);
    coerced.good.result = 'hit';
    expect(raw.good.result).toBe('clear');
  });

  it('ignores inherited top-level entries and inherited nested fields', () => {
    const inheritedEntry = Object.create({
      checkedAt: COMPLETE_AT,
      result: 'hit',
    }) as Record<string, unknown>;
    const inheritedRoot = Object.create({
      inheritedBroker: { checkedAt: COMPLETE_AT, result: 'hit' },
    }) as Record<string, unknown>;

    expect(coerceRunMetadata(inheritedRoot)).toEqual({});
    expect(coerceRunMetadata({ inheritedEntry })).toEqual({});
  });

  it('handles prototype-shaped broker ids as ordinary own data without pollution', () => {
    const raw = Object.fromEntries([
      ['__proto__', { checkedAt: COMPLETE_AT, result: 'hit' }],
      ['constructor', { checkedAt: COMPLETE_AT, result: 'clear' }],
    ]);
    const metadata = mergeRunMetadata({}, raw);

    expect(Object.hasOwn(metadata, '__proto__')).toBe(true);
    expect(Object.hasOwn(metadata, 'constructor')).toBe(true);
    expect(metadata['__proto__']).toEqual({ checkedAt: COMPLETE_AT, result: 'hit' });
    expect(metadata.constructor).toEqual({ checkedAt: COMPLETE_AT, result: 'clear' });
    expect(Object.getPrototypeOf(metadata)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('checkedAt');
  });

  it('coerces both sides of a merge so malformed durable or incoming data cannot leak through', () => {
    expect(mergeRunMetadata(
      {
        kept: { checkedAt: COMPLETE_AT, result: 'clear' },
        corrupt: { checkedAt: COMPLETE_AT, result: 'maybe' },
      },
      {
        added: { checkedAt: COMPLETE_AT, result: 'hit' },
        malformed: { checkedAt: false, result: 'clear' },
      },
    )).toEqual({
      kept: { checkedAt: COMPLETE_AT, result: 'clear' },
      added: { checkedAt: COMPLETE_AT, result: 'hit' },
    });
  });

  it('does not mutate stored metadata, incoming metadata, or a run while reducing', () => {
    const stored = structuredClone(oldMetadata);
    const newest: RunMetadata = {
      new: { checkedAt: COMPLETE_AT, result: 'hit' },
    };
    const storedBefore = structuredClone(stored);
    const newestBefore = structuredClone(newest);
    const run = {
      ...makeRun([completeItem({ verdict: 'hit' })]),
      completedAt: COMPLETE_AT,
    };
    const runBefore = structuredClone(run);

    mergeRunMetadata(stored, newest);
    deriveRunMetadata(run);

    expect(stored).toEqual(storedBefore);
    expect(newest).toEqual(newestBefore);
    expect(run).toEqual(runBefore);
  });
});

describe('storage prompt state', () => {
  it('defaults absent and malformed state to exactly three false booleans', () => {
    expect(mergeStoragePromptsSeen(undefined)).toEqual(DEFAULT_STORAGE_PROMPTS_SEEN);
    expect(mergeStoragePromptsSeen('junk')).toEqual(DEFAULT_STORAGE_PROMPTS_SEEN);
    expect(mergeStoragePromptsSeen([])).toEqual(DEFAULT_STORAGE_PROMPTS_SEEN);
  });

  it('accepts only literal true and drops unknown keys', () => {
    expect(mergeStoragePromptsSeen({
      profileStorage: true,
      runMetadata: 'true',
      richHistory: false,
      profile: { first: 'must not survive' },
    })).toEqual({
      profileStorage: true,
      runMetadata: false,
      richHistory: false,
    });
  });

  it('ignores inherited prompt values', () => {
    const inherited = Object.create({
      profileStorage: true,
      runMetadata: true,
      richHistory: true,
    }) as Record<string, unknown>;
    expect(mergeStoragePromptsSeen(inherited)).toEqual(DEFAULT_STORAGE_PROMPTS_SEEN);
  });

  it('marks one prompt while preserving valid prior seen values', () => {
    const raw = { profileStorage: true };
    expect(markStoragePromptSeen(raw, 'richHistory')).toEqual({
      profileStorage: true,
      runMetadata: false,
      richHistory: true,
    });
    expect(raw).toEqual({ profileStorage: true });
  });

  it('ignores an unknown prompt id instead of adding a fourth durable field', () => {
    expect(markStoragePromptSeen({ profileStorage: true }, '__proto__')).toEqual({
      profileStorage: true,
      runMetadata: false,
      richHistory: false,
    });
    expect(isStoragePromptId('__proto__')).toBe(false);
    expect(isStoragePromptId('runMetadata')).toBe(true);
  });

  const prefsOff: StoragePrefs = {
    profileStorage: false,
    runMetadata: false,
    richHistory: false,
  };
  const context: StoragePromptContext = {
    profileExists: true,
    run: {
      ...makeRun([completeItem({ verdict: 'hit' })]),
      completedAt: COMPLETE_AT,
    },
  };

  it.each([
    ['profileStorage', { ...context, profileExists: false }],
    ['runMetadata', {
      ...context,
      run: makeRun([completeItem()]),
    }],
    ['richHistory', {
      ...context,
      run: { ...makeRun([completeItem({ verdict: 'clear' })]), completedAt: COMPLETE_AT },
    }],
  ] satisfies Array<[StoragePromptId, typeof context]>)(
    '%s is eligible only when its relevant context exists',
    (prompt, absentContext) => {
      expect(isStoragePromptEligible(prompt, prefsOff, DEFAULT_STORAGE_PROMPTS_SEEN, context))
        .toBe(true);
      expect(isStoragePromptEligible(
        prompt,
        prefsOff,
        DEFAULT_STORAGE_PROMPTS_SEEN,
        absentContext,
      )).toBe(false);
    },
  );

  it('offers run metadata only for a completed, stamped run with an attempted broker', () => {
    const allExcluded = {
      ...makeRun([
        completeItem({ verdict: 'skipped', skipReason: 'missing:city' }),
        completeItem({
          id: 'b:aka_0',
          verdict: 'skipped',
          skipReason: 'run_stopped',
        }),
      ]),
      completedAt: COMPLETE_AT,
    };
    const incomplete = {
      ...makeRun([
        completeItem({ id: 'a:primary', brokerId: 'a', verdict: 'hit' }),
        makeItem({ id: 'b:primary', brokerId: 'b', status: 'open' }),
      ]),
      completedAt: COMPLETE_AT,
    };

    expect(isStoragePromptEligible(
      'runMetadata',
      prefsOff,
      DEFAULT_STORAGE_PROMPTS_SEEN,
      { profileExists: true, run: allExcluded },
    )).toBe(false);
    expect(isStoragePromptEligible(
      'runMetadata',
      prefsOff,
      DEFAULT_STORAGE_PROMPTS_SEEN,
      { profileExists: true, run: incomplete },
    )).toBe(false);
  });

  it('allows the rich-history offer as soon as the current run has a hit', () => {
    const activeWithHit = makeRun([
      completeItem({ id: 'a:primary', brokerId: 'a', verdict: 'hit' }),
      makeItem({ id: 'b:primary', brokerId: 'b', status: 'open' }),
    ]);
    expect(isStoragePromptEligible(
      'richHistory',
      prefsOff,
      DEFAULT_STORAGE_PROMPTS_SEEN,
      { profileExists: true, run: activeWithHit },
    )).toBe(true);
  });

  it.each(['profileStorage', 'runMetadata', 'richHistory'] as StoragePromptId[])(
    '%s is ineligible after being seen or enabled',
    prompt => {
      const seen: StoragePromptsSeen = {
        ...DEFAULT_STORAGE_PROMPTS_SEEN,
        [prompt]: true,
      };
      const enabled: StoragePrefs = { ...prefsOff, [prompt]: true };
      expect(isStoragePromptEligible(prompt, prefsOff, seen, context)).toBe(false);
      expect(isStoragePromptEligible(
        prompt,
        enabled,
        DEFAULT_STORAGE_PROMPTS_SEEN,
        context,
      )).toBe(false);
    },
  );
});
