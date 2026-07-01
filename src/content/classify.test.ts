// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { detectChallenge } from './classify';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('detectChallenge', () => {
  it('a clean results page → false', () => {
    document.body.innerHTML = '<h1>Search Results</h1><div class="results"></div>';
    expect(detectChallenge()).toBe(false);
  });

  it.each(['challenge-running', 'challenge-stage', 'cf-challenge-running'])(
    'Cloudflare interstitial #%s → true',
    (id) => {
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
      expect(detectChallenge()).toBe(true);
    },
  );

  it('.cf-browser-verification marker → true', () => {
    document.body.innerHTML = '<div class="cf-browser-verification"></div>';
    expect(detectChallenge()).toBe(true);
  });

  it('unsolved Turnstile (no response token) → true', () => {
    document.body.innerHTML = '<div class="cf-turnstile"></div>';
    expect(detectChallenge()).toBe(true);
  });

  it('solved Turnstile (response token present) → false', () => {
    document.body.innerHTML =
      '<div class="cf-turnstile"></div><input name="cf-turnstile-response" value="tok">';
    expect(detectChallenge()).toBe(false);
  });

  // Build iframes via createElement (not innerHTML) so the fixture is explicit about the
  // one attribute the selector matches; jsdom materializes them inertly (no fetch/throw).
  const addEl = (tag: string, attr: string, value: string) => {
    const el = document.createElement(tag);
    el.setAttribute(attr, value);
    document.body.appendChild(el);
  };

  it('standalone Cloudflare challenge iframe → true', () => {
    addEl('iframe', 'src', 'https://challenges.cloudflare.com/x');
    expect(detectChallenge()).toBe(true);
  });

  it.each([
    ['iframe', 'src', 'https://hcaptcha.com/1'],
    ['iframe', 'src', 'https://www.google.com/recaptcha/api2/bframe?k=1'],
    ['div', 'class', 'g-recaptcha'],
    ['iframe', 'src', 'https://geo.captcha-delivery.com/x'],
  ])('embedded CAPTCHA widget → true (%s %s=%s)', (tag, attr, value) => {
    addEl(tag, attr, value);
    expect(detectChallenge()).toBe(true);
  });
});
