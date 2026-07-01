// Shared test fixtures — one definition of each domain shape so a required-field change to
// Broker/BrokerChannel/Profile/WorkItem is made once, not re-edited in every suite.
// (Excluded from coverage in vitest.config.ts.)

import type { Broker, BrokerChannel } from '../shared/brokers';
import type { Profile, RunState, WorkItem } from '../shared/types';

export const makeProfile = (over: Partial<Profile> = {}): Profile => ({
  first: 'Jane',
  last: 'Doe',
  city: 'Reno',
  state: 'NV',
  ...over,
});

export const makeChannel = (over: Partial<BrokerChannel> = {}): BrokerChannel => ({
  method: 'email',
  target: 'privacy@example.com',
  kind: 'dedicated_optout',
  trust: 'verified',
  ...over,
});

export const makeBroker = (over: Partial<Broker> = {}): Broker => ({
  id: 'b',
  name: 'B',
  tier: 1,
  status: 'active',
  search: {
    url: 'https://b.com/s?n={name|q}',
    requires: ['first', 'last', 'city', 'state'],
    exposes: [],
  },
  optout: [],
  ...over,
});

export const makeItem = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 'b:primary',
  brokerId: 'b',
  nameVariant: 'primary',
  variantFirst: 'Jane',
  variantLast: 'Doe',
  renderedUrl: 'https://b.com/x',
  status: 'pending',
  ...over,
});

export const makeRun = (items: WorkItem[]): RunState => ({
  runId: 'r',
  createdAt: '2026-01-01T00:00:00Z',
  items,
});
