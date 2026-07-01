import { describe, it, expect } from 'vitest';
import { isResultsPage, brokerHostname } from './url';

describe('isResultsPage', () => {
  it('matching pathname → true (results page)', () => {
    expect(isResultsPage('/results', 'https://b.com/results?name=x')).toBe(true);
  });

  it('different pathname → false (details page)', () => {
    expect(isResultsPage('/person/123', 'https://b.com/results?name=x')).toBe(false);
  });

  it('malformed rendered URL → false', () => {
    expect(isResultsPage('/results', 'not a url')).toBe(false);
  });
});

describe('brokerHostname', () => {
  it('returns the hostname of the rendered URL', () => {
    expect(brokerHostname('https://www.truepeoplesearch.com/results?x=1')).toBe(
      'www.truepeoplesearch.com',
    );
  });

  it('malformed URL → empty string', () => {
    expect(brokerHostname('::::')).toBe('');
  });
});
