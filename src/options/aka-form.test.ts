import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAkaRow,
  addAkaRow,
  ensureOneAkaRow,
  resetAkaRows,
  readAkaRow,
  firstIncompleteAkaRow,
  readAkaRows,
} from './aka-form';

beforeEach(() => {
  document.body.innerHTML = '<div id="aka-rows"></div>';
});

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('#aka-rows .aka-row'));
const input = (row: HTMLElement, key: string) =>
  row.querySelector<HTMLInputElement>(`input[data-aka="${key}"]`)!;
const setRow = (row: HTMLElement, first: string, middle = '', last = '') => {
  input(row, 'first').value = first;
  input(row, 'middle').value = middle;
  input(row, 'last').value = last;
};

describe('buildAkaRow', () => {
  it('creates first/middle/last inputs + a remove button, populated from the aka', () => {
    const row = buildAkaRow({ first: 'Jane', middle: 'Q', last: 'Doe' });
    expect(input(row, 'first').value).toBe('Jane');
    expect(input(row, 'middle').value).toBe('Q');
    expect(input(row, 'last').value).toBe('Doe');
    expect(row.querySelector('.aka-remove')).not.toBeNull();
  });

  it('builds an empty row when no aka is passed', () => {
    expect(input(buildAkaRow(), 'first').value).toBe('');
  });
});

describe('resetAkaRows / ensureOneAkaRow — the ≥1-row invariant (#5/#12)', () => {
  it('an empty list still leaves exactly one empty row', () => {
    resetAkaRows([]);
    expect(rows()).toHaveLength(1);
    expect(input(rows()[0], 'first').value).toBe('');
  });

  it('populates one row per aka', () => {
    resetAkaRows([{ first: 'A', last: 'B' }, { first: 'C', middle: 'D', last: 'E' }]);
    expect(rows()).toHaveLength(2);
    expect(input(rows()[1], 'middle').value).toBe('D');
  });

  it('ensureOneAkaRow adds a row only when the list is empty', () => {
    ensureOneAkaRow();
    expect(rows()).toHaveLength(1);
    ensureOneAkaRow();
    expect(rows()).toHaveLength(1); // no-op when a row already exists
  });
});

describe('readAkaRow / readAkaRows (#1)', () => {
  it('readAkaRow trims each field', () => {
    resetAkaRows([]);
    setRow(rows()[0], '  Jane  ', '  Q ', ' Doe ');
    expect(readAkaRow(rows()[0])).toEqual({ first: 'Jane', middle: 'Q', last: 'Doe' });
  });

  it('readAkaRow tolerates a row missing its inputs', () => {
    const bare = document.createElement('div');
    bare.className = 'aka-row';
    expect(readAkaRow(bare)).toEqual({ first: '', middle: '', last: '' });
  });

  it('readAkaRows keeps complete rows and drops empty + incomplete ones', () => {
    resetAkaRows([]);
    addAkaRow();
    addAkaRow(); // three rows total
    setRow(rows()[0], 'Jane', '', 'Doe'); // complete
    setRow(rows()[1], 'Bob', '', ''); // no last → dropped
    setRow(rows()[2], '', '', ''); // empty → dropped
    expect(readAkaRows()).toEqual([{ first: 'Jane', last: 'Doe' }]);
  });
});

describe('firstIncompleteAkaRow — the save gate (#1)', () => {
  it('null when every row is complete', () => {
    resetAkaRows([]);
    setRow(rows()[0], 'Jane', '', 'Doe');
    expect(firstIncompleteAkaRow()).toBeNull();
  });

  it('returns the first row with data but a missing first or last', () => {
    resetAkaRows([]);
    addAkaRow();
    setRow(rows()[0], 'Jane', '', 'Doe'); // complete
    setRow(rows()[1], '', '', 'Smith'); // last-only → incomplete
    expect(firstIncompleteAkaRow()).toBe(rows()[1]);
  });

  it('a fully-empty row is never flagged', () => {
    resetAkaRows([]);
    expect(firstIncompleteAkaRow()).toBeNull();
  });
});

describe('row removal — focus follows + ≥1-row floor (#9/#12)', () => {
  it('removing a row focuses the next row', () => {
    resetAkaRows([{ first: 'A', last: 'B' }, { first: 'C', last: 'D' }]);
    (rows()[0].querySelector('.aka-remove') as HTMLButtonElement).click();
    expect(rows()).toHaveLength(1);
    expect(document.activeElement).toBe(input(rows()[0], 'first'));
  });

  it('removing the last row of several focuses the previous row', () => {
    resetAkaRows([{ first: 'A', last: 'B' }, { first: 'C', last: 'D' }]);
    (rows()[1].querySelector('.aka-remove') as HTMLButtonElement).click();
    expect(rows()).toHaveLength(1);
    expect(document.activeElement).toBe(input(rows()[0], 'first'));
  });

  it('removing the only remaining row re-adds one empty row', () => {
    resetAkaRows([{ first: 'A', last: 'B' }]);
    (rows()[0].querySelector('.aka-remove') as HTMLButtonElement).click();
    expect(rows()).toHaveLength(1);
    expect(input(rows()[0], 'first').value).toBe('');
  });
});

describe('addAkaRow (#2 Enter path uses buildAkaRow; button appends)', () => {
  it('appends a row and focuses its first input', () => {
    resetAkaRows([]);
    addAkaRow();
    expect(rows()).toHaveLength(2);
    expect(document.activeElement).toBe(input(rows()[1], 'first'));
  });
});
