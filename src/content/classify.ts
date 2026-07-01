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

  // Other embedded CAPTCHA widgets.
  return [
    'iframe[src*="hcaptcha.com"]',
    'iframe[src*="recaptcha/api2/bframe"]',
    '.g-recaptcha',
    'iframe[src*="geo.captcha-delivery.com"]',
  ].some((sel) => document.querySelector(sel) !== null);
}

// The rendered search URL points at a results listing. If the current page shares that
// pathname we're on the results page (show guidance); otherwise it's a details page (show
// verdict buttons). A malformed rendered URL is treated as not-results.
export function isResultsPage(currentUrl: string, renderedUrl: string): boolean {
  try {
    return new URL(currentUrl).pathname === new URL(renderedUrl).pathname;
  } catch {
    return false;
  }
}

// The broker's hostname from its rendered search URL, or '' if it can't be parsed.
export function brokerHostname(renderedUrl: string): string {
  try {
    return new URL(renderedUrl).hostname;
  } catch {
    return '';
  }
}
