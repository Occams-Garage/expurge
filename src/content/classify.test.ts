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

  // Explicitly-rendered Turnstile (turnstile.render(...)) — the TruePeopleSearch /InternalCaptcha
  // managed-challenge shape: no .cf-turnstile container, widget iframes are about:blank, but the
  // Turnstile API script is in the top document. That script is the only reliable signal.
  it('explicitly-rendered Turnstile managed challenge (API script, no container) → true', () => {
    addEl('script', 'src', 'https://challenges.cloudflare.com/turnstile/v0/api.js');
    expect(detectChallenge()).toBe(true);
  });

  // A real solved Turnstile page carries the api.js script too. The `!turnstile` guard must route
  // the container case to the solved/unsolved logic above, so the new script branch does NOT
  // re-detect a solved container-Turnstile just because the script is present.
  it('solved container-Turnstile with the API script present → false (!turnstile guard)', () => {
    document.body.innerHTML =
      '<div class="cf-turnstile"></div><input name="cf-turnstile-response" value="tok">';
    addEl('script', 'src', 'https://challenges.cloudflare.com/turnstile/v0/api.js');
    expect(detectChallenge()).toBe(false);
  });

  // Trap: the /InternalCaptcha page also hosts a cf.clym-widget.net iframe (Clym consent widget,
  // not Cloudflare). Keying off a bare "cf"/"cloudflare" substring would false-positive on it — the
  // selector must match the specific challenges.cloudflare.com host only.
  it('Clym consent widget only (cf.clym-widget.net, no Cloudflare challenge script) → false', () => {
    addEl('iframe', 'src', 'https://cf.clym-widget.net/latest/api-bridge/?instance=us6.clym.io');
    addEl('script', 'src', 'https://cf.clym-widget.net/latest/loader.js');
    expect(detectChallenge()).toBe(false);
  });
});
