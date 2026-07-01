import type { AkaName, Profile } from './types';

// Fixed lookup table — NOT a templating language.
type TransformFn = (v: string) => string;

const TRANSFORMS: Record<string, TransformFn> = {
  slug:  (v) => v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
  q:     (v) => encodeURIComponent(v),
  upper: (v) => v.toUpperCase(),
};

function deriveFields(p: Profile): Record<string, string> {
  return {
    first:      p.first,
    last:       p.last,
    city:       p.city,
    state:      p.state,
    name:       `${p.first} ${p.last}`,
    name_full:  `${p.first} ${p.last}`,   // extended with middle when Profile gains that field
    citystate:  `${p.city}, ${p.state}`,
  };
}

// Coerce a stored also_known_as value into clean AkaName[]. Accepts unknown so it
// can absorb legacy profiles (each entry a "First Last" string) alongside the
// current object shape — there is no storage versioning, so this is the single
// place that bridges old and new data. A searchable name needs both a first and a
// last, so entries missing either (including single-token legacy strings) are dropped.
export function normalizeAkas(raw: unknown): AkaName[] {
  if (!Array.isArray(raw)) return [];
  const out: AkaName[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      // Legacy free-text name → structured fields: first token is first, last token is
      // last, anything between is middle — so a migrated "Jane Marie Smith" matches a
      // freshly-entered {first:Jane, middle:Marie, last:Smith} instead of folding the
      // middle into last. A name needs both a first and a last, so single-token strings
      // are dropped.
      const parts = entry.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2) continue;
      const first = parts[0];
      const last = parts[parts.length - 1];
      const middle = parts.slice(1, -1).join(' ');
      out.push({ first, last, ...(middle ? { middle } : {}) });
    } else if (entry && typeof entry === 'object') {
      // Field values come from unknown stored/imported data — coerce non-strings to
      // '' instead of calling .trim() on them (which would throw on e.g. a number).
      const e = entry as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const first = str(e['first']);
      const last = str(e['last']);
      if (!first || !last) continue;
      const middle = str(e['middle']);
      out.push({ first, last, ...(middle ? { middle } : {}) });
    }
  }
  return out;
}

// Renders a broker search URL template.
// Token syntax: {field} or {field|transform}
export function renderUrl(template: string, profile: Profile): string {
  const fields = deriveFields(profile);
  return template.replace(/\{(\w+)(?:\|(\w+))?\}/g, (_m, name: string, transform?: string) => {
    const value = fields[name] ?? '';
    if (!transform) return value;
    return (TRANSFORMS[transform] ?? ((v: string) => v))(value);
  });
}
