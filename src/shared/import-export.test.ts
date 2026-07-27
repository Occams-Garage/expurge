import { describe, it, expect } from 'vitest';
import { parseSessionImport } from './import-export';

const validProfile = { first: 'Jane', last: 'Doe', city: 'Reno', state: 'NV' };
const wrap = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ expurge_export: true, version: 1, profile: validProfile, run: null, ...over });

describe('parseSessionImport', () => {
  it('accepts a well-formed export and returns the profile (run is ignored in Phase 1)', () => {
    expect(parseSessionImport(wrap({ run: { runId: 'x', createdAt: 't', items: [] } })))
      .toEqual({ ok: true, profile: validProfile });
  });

  it('accepts a full profile with valid optional fields', () => {
    const profile = {
      ...validProfile, middle: 'Q', zip: '89501', age: '40',
      relatives: ['Bob Doe'], emails: ['jane@example.com'], phones: ['555-1234'],
      also_known_as: [{ first: 'Janie', last: 'Doe', middle: 'Q' }, { first: 'J', last: 'D' }],
    };
    expect(parseSessionImport(wrap({ profile }))).toEqual({ ok: true, profile });
  });

  it('accepts a null profile (the caller decides there is nothing to import)', () => {
    expect(parseSessionImport(wrap({ profile: null }))).toEqual({ ok: true, profile: null });
  });

  it('rejects invalid JSON', () => {
    expect(parseSessionImport('{ not json').ok).toBe(false);
  });

  it('rejects a non-object top level', () => {
    expect(parseSessionImport('42').ok).toBe(false);
    expect(parseSessionImport('null').ok).toBe(false);
  });

  it('rejects a file without the expurge_export flag', () => {
    expect(parseSessionImport(JSON.stringify({ version: 1, profile: validProfile })).ok).toBe(false);
  });

  it('rejects a different schema version', () => {
    expect(parseSessionImport(wrap({ version: 2 })).ok).toBe(false);
  });

  it('rejects a malformed profile (missing required fields)', () => {
    expect(parseSessionImport(wrap({ profile: { first: 'Jane' } })).ok).toBe(false);
  });

  it('rejects a profile with a blank required field', () => {
    expect(parseSessionImport(wrap({ profile: { ...validProfile, city: '  ' } })).ok).toBe(false);
  });

  it('rejects a non-object profile', () => {
    expect(parseSessionImport(wrap({ profile: 'nope' })).ok).toBe(false);
  });

  it('rejects a non-string optional scalar (would store junk)', () => {
    expect(parseSessionImport(wrap({ profile: { ...validProfile, age: 40 } })).ok).toBe(false);
  });

  it('rejects a string where a string-array field is expected (would throw in .join after overwrite)', () => {
    expect(parseSessionImport(wrap({ profile: { ...validProfile, relatives: 'Bob Doe' } })).ok).toBe(false);
    expect(parseSessionImport(wrap({ profile: { ...validProfile, emails: 'a@b.com' } })).ok).toBe(false);
  });

  it('rejects a string-array containing a non-string element', () => {
    expect(parseSessionImport(wrap({ profile: { ...validProfile, phones: ['555-1234', 42] } })).ok).toBe(false);
  });

  it('rejects a malformed also_known_as (not an aka-object array)', () => {
    expect(parseSessionImport(wrap({ profile: { ...validProfile, also_known_as: 'Janie Doe' } })).ok).toBe(false);
    expect(parseSessionImport(wrap({ profile: { ...validProfile, also_known_as: [{ first: 'J' }] } })).ok).toBe(false);
    expect(parseSessionImport(wrap({ profile: { ...validProfile, also_known_as: ['Janie'] } })).ok).toBe(false);
    expect(parseSessionImport(wrap({ profile: { ...validProfile, also_known_as: [null] } })).ok).toBe(false);
  });
});
