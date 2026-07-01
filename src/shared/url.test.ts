import { describe, it, expect } from 'vitest';
import { isResultsPage, brokerHostname, isOnHost } from './url';

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

describe('isOnHost', () => {
  const rendered = 'https://www.truepeoplesearch.com/results?name=x';

  it('exact host match → true', () => {
    expect(isOnHost('https://www.truepeoplesearch.com/find/person/1', rendered)).toBe(true);
  });

  it('subdomain of the broker host → true', () => {
    expect(isOnHost('https://cdn.www.truepeoplesearch.com/x', rendered)).toBe(true);
  });

  it('off-host challenge detour → false', () => {
    expect(isOnHost('https://challenges.cloudflare.com/turnstile', rendered)).toBe(false);
  });

  it('a bare-suffix lookalike is not a subdomain → false', () => {
    // "nottruepeoplesearch.com" endsWith "truepeoplesearch.com" but isn't a subdomain;
    // the leading dot in the check prevents the false match.
    expect(isOnHost('https://nottruepeoplesearch.com/x', rendered)).toBe(false);
  });

  it('malformed URL on either side → false', () => {
    expect(isOnHost('::::', rendered)).toBe(false);
    expect(isOnHost('https://www.truepeoplesearch.com/x', 'not a url')).toBe(false);
  });
});
