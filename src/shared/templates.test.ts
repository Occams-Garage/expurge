import { describe, it, expect } from 'vitest';
import { buildDraft, mailtoUrl, toEml, toCopyText, type EmailDraft } from './templates';
import type { Profile } from './types';
import type { Broker, BrokerChannel } from './brokers';

const broker: Broker = {
  id: 'b',
  name: 'TruePeopleSearch',
  tier: 1,
  status: 'active',
  search: { url: 'https://www.truepeoplesearch.com/results?x=1', requires: [], exposes: [] },
  optout: [],
};

const emailChannel = (over: Partial<BrokerChannel> = {}): BrokerChannel => ({
  method: 'email',
  target: 'privacy@tps.com',
  kind: 'dedicated_optout',
  trust: 'verified',
  ...over,
});

const p = (over: Partial<Profile> = {}): Profile => ({
  first: 'Jane',
  last: 'Doe',
  city: 'Reno',
  state: 'NV',
  ...over,
});

describe('buildDraft', () => {
  it('form_required channel → form card with the user first/last prefilled', () => {
    const d = buildDraft(p(), broker, emailChannel({ kind: 'form_required', target: 'https://tps.com/removal' }));
    expect(d.kind).toBe('form');
    if (d.kind === 'form') {
      expect(d.formUrl).toBe('https://tps.com/removal');
      expect(d.fields.find((f) => f.label === 'First Name')?.value).toBe('Jane');
      expect(d.fields.find((f) => f.label === 'Last Name')?.value).toBe('Doe');
      expect(d.steps.length).toBeGreaterThan(0);
    }
  });

  it('non-CA → general subject + body carrying name and city', () => {
    const d = buildDraft(p({ state: 'NV' }), broker, emailChannel()) as EmailDraft;
    expect(d.kind).toBe('email');
    expect(d.subject).toBe('Personal Data Opt-Out / Deletion Request');
    expect(d.body).toContain('Name: Jane Doe');
    expect(d.body).toContain('City: Reno, NV');
    expect(d.to).toBe('privacy@tps.com');
  });

  it('CA (any casing / full name) → CCPA subject + body + DROP notice', () => {
    for (const state of ['CA', 'ca', 'California', 'california']) {
      const d = buildDraft(p({ state }), broker, emailChannel()) as EmailDraft;
      expect(d.subject).toContain('CCPA');
      expect(d.body).toContain('CCPA');
      expect(d.body).toContain('DROP');
    }
  });

  it('listingUrl is embedded in both general and CCPA bodies when provided', () => {
    const general = buildDraft(p({ state: 'NV' }), broker, emailChannel(), 'https://tps.com/p/1') as EmailDraft;
    expect(general.body).toContain('https://tps.com/p/1');
    const ccpa = buildDraft(p({ state: 'CA' }), broker, emailChannel(), 'https://tps.com/p/2') as EmailDraft;
    expect(ccpa.body).toContain('https://tps.com/p/2');
  });

  it('channel.subject overrides the default subject', () => {
    const d = buildDraft(p(), broker, emailChannel({ subject: 'Custom Subject' })) as EmailDraft;
    expect(d.subject).toBe('Custom Subject');
  });

  it('general_contact kind sets isGeneralContact', () => {
    const d = buildDraft(p(), broker, emailChannel({ kind: 'general_contact' })) as EmailDraft;
    expect(d.isGeneralContact).toBe(true);
  });
});

describe('send-surface serializers', () => {
  const draft: EmailDraft = {
    kind: 'email',
    brokerName: 'B',
    to: 'a@b.com',
    subject: 'Hi there',
    body: 'Line 1\nLine 2',
  };

  it('mailtoUrl percent-encodes recipient and query-encodes subject/body', () => {
    const url = mailtoUrl(draft);
    expect(url.startsWith('mailto:a%40b.com?')).toBe(true);
    expect(url).toContain('subject=Hi+there');
    expect(url).toContain('body=Line+1%0ALine+2');
  });

  it('toEml uses CRLF headers with a blank-line body separator', () => {
    const lines = toEml(draft).split('\r\n');
    expect(lines[0]).toBe('To: a@b.com');
    expect(lines[1]).toBe('Subject: Hi there');
    expect(lines).toContain('MIME-Version: 1.0');
    const blank = lines.indexOf('');
    expect(blank).toBeGreaterThan(0);
    expect(lines.slice(blank + 1).join('\r\n')).toBe('Line 1\nLine 2');
  });

  it('toCopyText is To / Subject / blank line / body', () => {
    expect(toCopyText(draft)).toBe('To: a@b.com\nSubject: Hi there\n\nLine 1\nLine 2');
  });
});
