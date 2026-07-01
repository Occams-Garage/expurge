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
