// channel-level `broken` (opt-out path failed) is DISTINCT from broker-level `status: broken`
// (search URL failed) — the two halves of the search-vs-optout split share no status axis.
export type ChannelTrust = 'unverified' | 'verified' | 'broken';

export interface BrokerChannel {
  method: 'email' | 'web_form' | 'mail';
  target: string;
  kind: 'dedicated_optout' | 'general_contact' | 'form_required';
  subject?: string;     // if present, overrides the template's default subject
  template?: string;    // named body template
  trust: ChannelTrust;
  last_checked?: string;  // ISO date; gate computes expiry live from this field
  source?: string;
  verified_by?: string;
}

export interface Broker {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  status: 'active' | 'broken' | 'disabled';
  search: {
    url: string;         // template with {field|transform} tokens
    requires: string[];  // raw profile fields needed; missing → skip
    exposes: string[];   // what the site shows (drives overlay guidance — never gates)
  };
  optout: BrokerChannel[];  // ordered list; first verified+unexpired wins
}

// ── M0-M3 slice: one hardcoded broker ───────────────────────────────────────
// The opt-out channel is STUBBED for this slice. Before shipping, run the full
// verification checklist (§5a) on the real opt-out page and update trust fields.

export const BROKERS: readonly Broker[] = [
  {
    id: 'truepeoplesearch',
    name: 'TruePeopleSearch',
    tier: 1,
    status: 'active',
    search: {
      url: 'https://www.truepeoplesearch.com/results?name={name|q}&citystatezip={citystate|q}',
      requires: ['first', 'last', 'city', 'state'],
      exposes: ['full name', 'age', 'home address', 'relatives', 'associates'],
    },
    optout: [
      {
        method: 'email',
        target: 'optout@truepeoplesearch.com',  // TODO: verify via §5a checklist before launch
        kind: 'dedicated_optout',
        subject: 'Opt-Out Request',
        template: 'us_general',
        // Stubbed trust bits for M0-M3. Real verification required before shipping.
        trust: 'verified',
        last_checked: '2026-06-01',
        source: 'https://www.truepeoplesearch.com/opt-out',  // TODO: confirm
        verified_by: 'dustinrvk@gmail.com',
      },
    ],
  },
];

export function getBroker(id: string): Broker | undefined {
  return BROKERS.find(b => b.id === id);
}
