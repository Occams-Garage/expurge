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
      // Legacy "First Last" — split on the first space (preserves prior semantics).
      const t = entry.trim();
      const sp = t.indexOf(' ');
      if (sp < 0) continue;   // single-token legacy AKA — not a searchable first+last name
      const first = t.slice(0, sp);
      const last = t.slice(sp + 1).trim();
      if (!first || !last) continue;
      out.push({ first, last });
    } else if (entry && typeof entry === 'object') {
      const e = entry as Partial<AkaName>;
      const first = (e.first ?? '').trim();
      const last = (e.last ?? '').trim();
      if (!first || !last) continue;
      const middle = (e.middle ?? '').trim();
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
