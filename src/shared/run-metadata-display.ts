import type { BrokerRunMetadata, BrokerRunResult } from './types';

const RESULT_LABELS: Record<BrokerRunResult, string> = {
  hit: 'Listed',
  clear: 'Not listed',
  unknown: 'Couldn’t tell',
  skipped: 'Skipped',
};

export function brokerRunResultLabel(result: BrokerRunResult): string {
  return RESULT_LABELS[result];
}

// Browser UI omits a corrupt date rather than rendering "Invalid Date". Production values have
// already passed storage coercion; locale/timeZone parameters keep the formatter deterministic
// in tests while the default call follows the user's browser locale and zone.
export function formatRunMetadataLine(
  metadata: BrokerRunMetadata,
  locale?: string,
  timeZone?: string,
): string | null {
  const checkedAt = new Date(metadata.checkedAt);
  if (!Number.isFinite(checkedAt.getTime())) return null;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(timeZone ? { timeZone } : {}),
  }).format(checkedAt);
  return `Your last scan: ${brokerRunResultLabel(metadata.result)} · ${date}`;
}
