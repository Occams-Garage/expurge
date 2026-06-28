import type { Profile } from './types';

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
