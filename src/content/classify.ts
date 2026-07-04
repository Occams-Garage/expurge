// Pure cross-site page classification for the content script — DOM reads only, no browser
// and no side effects, so it is unit-testable in a DOM environment.

// True when the page is showing an active bot-challenge / CAPTCHA interstitial the human
// must clear before we can ask for a verdict. Reads only the live document.
export function detectChallenge(): boolean {
  // These elements only exist on CF interstitial challenge pages; removed on redirect.
  const blocking = [
    '#challenge-running',
    '#challenge-stage',
    '.cf-browser-verification',
    '#cf-challenge-running',
  ];
  if (blocking.some((sel) => document.querySelector(sel) !== null)) return true;

  // Turnstile: the container div persists after solving (only the iframe content changes).
  // Blocking only while the response token hasn't been set yet.
  const turnstile = document.querySelector<HTMLElement>('.cf-turnstile');
  if (turnstile) {
    const resp = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
    if (!resp?.value) return true; // unsolved
    // Solved — don't count the CF challenge iframe inside this container as a separate block.
  } else if (document.querySelector('iframe[src*="challenges.cloudflare.com"]') !== null) {
    return true; // standalone CF iframe (non-Turnstile challenge)
  }

  // Explicitly-rendered Turnstile (turnstile.render(...)): no .cf-turnstile container and the widget
  // iframes are about:blank, so neither branch above matches — but the Turnstile API script is in the
  // top document. This is the TruePeopleSearch /InternalCaptcha managed-challenge shape. Match the
  // specific host ONLY: a co-resident cf.clym-widget.net iframe (Clym consent, not Cloudflare) must
  // not match a bare "cf"/"cloudflare" substring. The `!turnstile` guard defers the container case to
  // the block above — a solved container-Turnstile still carries this script and must stay resolved.
  if (!turnstile && document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
    return true;
  }

  // Other embedded CAPTCHA widgets.
  return [
    'iframe[src*="hcaptcha.com"]',
    'iframe[src*="recaptcha/api2/bframe"]',
    '.g-recaptcha',
    'iframe[src*="geo.captcha-delivery.com"]',
  ].some((sel) => document.querySelector(sel) !== null);
}
