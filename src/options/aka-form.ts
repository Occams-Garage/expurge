import type { AkaName } from '../shared/types';
import { normalizeAkas } from '../shared/transforms';

// "Other names" (also_known_as) dynamic rows. Each name is captured as separate
// First/Middle/Last inputs, mirroring the primary name; the #aka-rows container always
// holds at least one row. These are pure DOM helpers (no browser/extension APIs), so they
// are unit-testable against a bare #aka-rows element in a DOM env.

function akaRowsContainer(): HTMLElement {
  return document.getElementById('aka-rows')!;
}

export function buildAkaRow(aka?: AkaName): HTMLElement {
  const row = document.createElement('div');
  row.className = 'aka-row';

  const mkInput = (key: keyof AkaName, label: string): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    input.dataset['aka'] = key;
    input.value = aka?.[key] ?? '';
    return input;
  };

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-quiet aka-remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove this name');
  remove.addEventListener('click', () => {
    const focusAfter = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null;
    row.remove();
    ensureOneAkaRow(); // never leave the list empty
    const target = focusAfter ?? document.querySelector<HTMLElement>('#aka-rows .aka-row');
    target?.querySelector<HTMLInputElement>('input[data-aka="first"]')?.focus();
  });

  row.append(mkInput('first', 'First'), mkInput('middle', 'Middle'), mkInput('last', 'Last'), remove);
  return row;
}

export function addAkaRow(aka?: AkaName): void {
  const row = buildAkaRow(aka);
  akaRowsContainer().appendChild(row);
  row.querySelector<HTMLInputElement>('input[data-aka="first"]')?.focus();
}

// The list always keeps at least one row. Querying `.aka-row` (not the raw child count)
// keeps the invariant robust if a non-row node is ever added to the container.
export function ensureOneAkaRow(): void {
  const container = akaRowsContainer();
  if (!container.querySelector('.aka-row')) container.appendChild(buildAkaRow());
}

// Clear and repopulate the rows; always leave at least one (empty) row.
export function resetAkaRows(akas: AkaName[]): void {
  akaRowsContainer().replaceChildren(...akas.map((aka) => buildAkaRow(aka)));
  ensureOneAkaRow();
}

// Read one row's trimmed First/Middle/Last values.
export function readAkaRow(row: HTMLElement): { first: string; middle: string; last: string } {
  const val = (key: keyof AkaName) =>
    (row.querySelector<HTMLInputElement>(`input[data-aka="${key}"]`)?.value ?? '').trim();
  return { first: val('first'), middle: val('middle'), last: val('last') };
}

// First row that has data but is missing a first or last name (an unsearchable, incomplete
// name), else null. A searchable name needs both, mirroring the primary name — the save
// handler blocks on such a row, so readAkaRows never has to drop one.
export function firstIncompleteAkaRow(): HTMLElement | null {
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('#aka-rows .aka-row'))) {
    const { first, middle, last } = readAkaRow(row);
    const hasData = first || middle || last;
    if (hasData && (!first || !last)) return row;
  }
  return null;
}

// Read rows into AkaName[] via the single canonicalizer — normalizeAkas applies the same
// trim + drop-if-missing-first/last rules (incomplete rows are blocked at save time).
export function readAkaRows(): AkaName[] {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('#aka-rows .aka-row')).map(readAkaRow);
  return normalizeAkas(rows);
}
