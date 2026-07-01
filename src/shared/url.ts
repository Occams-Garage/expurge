// Pure URL helpers shared across the extension — no DOM, no browser, no side effects.
// The background uses these to classify a broker tab's page-type (results vs details);
// they moved out of content/classify.ts so the content/sidebar boundary doesn't own
// shared pure logic. `detectChallenge` (DOM-dependent) stays in content/classify.ts.

// The rendered search URL points at a results listing. If the current page's pathname
// matches, we're on the results page (show guidance); otherwise it's a details page (show
// verdict buttons). Takes the pathname directly (callers pass window.location.pathname,
// which never throws); only the rendered URL is parsed, and a malformed one → not-results.
export function isResultsPage(currentPathname: string, renderedUrl: string): boolean {
  try {
    return currentPathname === new URL(renderedUrl).pathname;
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

// Is `tabUrl` on the broker's own host (exact host or a subdomain of it)? Used to tell a
// real broker page from an off-host detour like a `challenges.cloudflare.com` interstitial:
// the background clears a tab's challenge flag only once it lands back on-host, and won't
// treat the CDN hop itself as the broker page. A malformed URL on either side → false.
export function isOnHost(tabUrl: string, renderedUrl: string): boolean {
  try {
    const brokerHost = new URL(renderedUrl).hostname;
    const tabHost = new URL(tabUrl).hostname;
    return tabHost === brokerHost || tabHost.endsWith('.' + brokerHost);
  } catch {
    return false;
  }
}
