// TODO Q-010: All template legal language is PLACEHOLDER.
// Before launch: verify CCPA body against current CA Civil Code §1798.100 et seq.;
// cross-reference broker list against public California DROP registry for notice wording.

import type { Profile } from './types';
import type { Broker, BrokerChannel } from './brokers';

export interface Draft {
  to: string;
  subject: string;
  body: string;
}

// ── US general opt-out / deletion ───────────────────────────────────────────

const GENERAL_SUBJECT = 'Personal Data Opt-Out / Deletion Request';

function generalBody(p: Profile, b: Broker): string {
  const host = new URL(b.search.url).hostname;
  return [
    `To Whom It May Concern,`,
    ``,
    `I am writing to request the removal of my personal information from ${b.name} (${host}).`,
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

function ccpaBody(p: Profile, b: Broker): string {
  const host = new URL(b.search.url).hostname;
  return [
    `To Whom It May Concern,`,
    ``,
    `I am a California resident exercising my right to delete personal information under`,
    `the California Consumer Privacy Act (CCPA), Cal. Civ. Code §1798.105.`,
    `[TODO Q-010: Verify exact citation and required statutory language before launch]`,
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

// ── Draft construction ────────────────────────────────────────────────────────

function isCA(p: Profile): boolean {
  return /^ca$/i.test(p.state.trim()) || /^california$/i.test(p.state.trim());
}

// Auto-selects template by state; channel.subject overrides the default subject when present.
export function buildDraft(p: Profile, broker: Broker, channel: BrokerChannel): Draft {
  const ca = isCA(p);
  const subject = channel.subject ?? (ca ? CCPA_SUBJECT : GENERAL_SUBJECT);
  const body    = ca ? ccpaBody(p, broker) : generalBody(p, broker);
  return { to: channel.target, subject, body };
}

// ── Send surface helpers ──────────────────────────────────────────────────────

export function mailtoUrl(draft: Draft): string {
  const params = new URLSearchParams({ subject: draft.subject, body: draft.body });
  return `mailto:${encodeURIComponent(draft.to)}?${params.toString()}`;
}

// RFC 5322 minimal format for .eml download.
export function toEml(draft: Draft): string {
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

// Produces the text block used for copy-paste surface.
export function toCopyText(draft: Draft): string {
  return `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`;
}
