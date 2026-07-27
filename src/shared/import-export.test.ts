import { describe, it, expect } from 'vitest';
import { parseSessionImport } from './import-export';

const validProfile = { first: 'Jane', last: 'Doe', city: 'Reno', state: 'NV' };
const wrap = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ expurge_export: true, version: 1, profile: validProfile, run: null, ...over });

describe('parseSessionImport', () => {
  it('accepts a well-formed export and returns profile + run', () => {
    const run = { runId: 'x', createdAt: 't', items: [] };
    expect(parseSessionImport(wrap({ run }))).toEqual({ ok: true, profile: validProfile, run });
  });

  it('accepts a null profile (the caller decides there is nothing to import)', () => {
    expect(parseSessionImport(wrap({ profile: null }))).toEqual({ ok: true, profile: null, run: null });
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
});
