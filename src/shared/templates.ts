// TODO Q-010: All template legal language is PLACEHOLDER.
// Before launch: verify CCPA body against current CA Civil Code §1798.100 et seq.;
// cross-reference broker list against public California DROP registry for notice wording.

import type { Profile } from './types';
import type { Broker, BrokerChannel } from './brokers';

// ── Draft types (discriminated union) ───────────────────────────────────────

export interface EmailDraft {
  kind: 'email';
  brokerName: string;
  to: string;
  subject: string;
  body: string;
  isGeneralContact?: boolean;
}

export interface FormField {
  label: string;
  value: string;       // empty string = user must fill in themselves
  note?: string;       // shown below the value in the card
}

export interface FormDraft {
  kind: 'form';
  brokerName: string;
  formUrl: string;
  fields: FormField[];
  steps: string[];
}

export type Draft = EmailDraft | FormDraft;

// ── US general opt-out / deletion ───────────────────────────────────────────

const GENERAL_SUBJECT = 'Personal Data Opt-Out / Deletion Request';

function generalBody(p: Profile, b: Broker, listingUrl?: string): string {
  const host = new URL(b.search.url).hostname;
  const listingLine = listingUrl
    ? [``, `The following profile contains my information and I am requesting its removal:`, listingUrl]
    : [];
  return [
    `To Whom It May Concern,`,
    ``,
    `I am writing to request the removal of my personal information from ${b.name} (${host}).`,
    ...listingLine,
    ``,
    `Name: ${p.first} ${p.last}`,
    `City: ${p.city}, ${p.state}`,
    ``,
    `Please permanently remove all records associated with my name and contact information`,
    `from your database and any downstream services, and confirm when this is complete.`,
    ``,
    `Thank you,`,
    `${p.first} ${p.last}`,
  ].join('\n');
}

// ── California CCPA deletion ─────────────────────────────────────────────────
// TODO Q-010: Statutory citation and deletion-request language are placeholders.
// Verify against current CA Civil Code §1798.105 (CCPA right to delete) before launch.

const CCPA_SUBJECT = 'California CCPA Deletion Request — Right to Delete Personal Information';

function ccpaBody(p: Profile, b: Broker, listingUrl?: string): string {
  const host = new URL(b.search.url).hostname;
  const listingLine = listingUrl
    ? [``, `The following profile contains my information and I am requesting its removal:`, listingUrl]
    : [];
  return [
    `To Whom It May Concern,`,
    ``,
    `I am a California resident exercising my right to delete personal information under`,
    `the California Consumer Privacy Act (CCPA), Cal. Civ. Code §1798.105.`,
    `[TODO Q-010: Verify exact citation and required statutory language before launch]`,
    ...listingLine,
    ``,
    `I request the permanent deletion of all personal information associated with:`,
    ``,
    `Name: ${p.first} ${p.last}`,
    `City: ${p.city}, ${p.state}`,
    ``,
    `This request covers all records, profiles, and derived data held by ${b.name} (${host}).`,
    `Please confirm deletion in writing within the timeframe required by California law.`,
    ``,
    `Sincerely,`,
    `${p.first} ${p.last}`,
    ``,
    `---`,
    `NOTE FOR CALIFORNIA RESIDENTS: California's DELETE Act (DROP) program at privacy.ca.gov`,
    `may also cover some data brokers. expurge covers publicly-searchable people-search sites;`,
    `DROP covers a different (and overlapping) set of registered data brokers — consider using both.`,
    `[TODO Q-010: Verify DROP overlap with this broker list before launch]`,
  ].join('\n');
}

// ── Form instruction card ────────────────────────────────────────────────────

function buildFormCard(p: Profile, broker: Broker, channel: BrokerChannel): FormDraft {
  const fields: FormField[] = [
    { label: 'First Name', value: p.first },
    { label: 'Middle Name', value: '', note: 'Leave blank if not applicable' },
    { label: 'Last Name', value: p.last },
    {
      label: 'Email Address',
      value: '',
      note: 'Enter your own email address — expurge does not store it',
    },
  ];

  const steps = [
    'Open the opt-out form using the button below.',
    'Select "The subject of the request" from the role dropdown.',
    'Fill in the fields above — copy each value to avoid typos.',
    'Enter your email address (required to receive the confirmation link).',
    'Check the authorization checkbox.',
    'Solve the "I am human" hCaptcha.',
    'Submit. Check your email for a confirmation link — click it to complete removal.',
  ];

  return {
    kind: 'form',
    brokerName: broker.name,
    formUrl: channel.target,
    fields,
    steps,
  };
}

// ── Draft construction ────────────────────────────────────────────────────────

function isCA(p: Profile): boolean {
  return /^ca$/i.test(p.state.trim()) || /^california$/i.test(p.state.trim());
}

export function buildDraft(
  p: Profile,
  broker: Broker,
  channel: BrokerChannel,
  listingUrl?: string,
): Draft {
  if (channel.kind === 'form_required') {
    return buildFormCard(p, broker, channel);
  }

  const ca = isCA(p);
  const subject = channel.subject ?? (ca ? CCPA_SUBJECT : GENERAL_SUBJECT);
  const body    = ca ? ccpaBody(p, broker, listingUrl) : generalBody(p, broker, listingUrl);
  return {
    kind: 'email',
    brokerName: broker.name,
    to: channel.target,
    subject,
    body,
    isGeneralContact: channel.kind === 'general_contact',
  };
}

// ── Email send surface helpers ────────────────────────────────────────────────

export function mailtoUrl(draft: EmailDraft): string {
  const params = new URLSearchParams({ subject: draft.subject, body: draft.body });
  return `mailto:${encodeURIComponent(draft.to)}?${params.toString()}`;
}

// RFC 5322 minimal format for .eml download.
export function toEml(draft: EmailDraft): string {
  return [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    draft.body,
  ].join('\r\n');
}

export function toCopyText(draft: EmailDraft): string {
  return `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`;
}
