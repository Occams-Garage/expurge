import { isOnHost } from '../shared/url';

// Should the off-host paste warning show? True when a non-empty pasted URL isn't on the
// broker's own host (exact or subdomain) — including an unparseable paste, which we can't
// confirm is the broker. Pure: the warn/never-block decision, unit-tested.
export function shouldWarnOffHost(pastedUrl: string, renderedUrl: string): boolean {
  const url = pastedUrl.trim();
  return url !== '' && !isOnHost(url, renderedUrl);
}

// Wire an input's live off-host warning: toggle `warn.hidden` on every input event (paste
// included) and set the initial hidden state. Extracted so the DOM event path — paste → input
// event → warning visibility — is testable in jsdom (the behaviour a QA pass flagged as missing).
export function wirePasteWarning(input: HTMLInputElement, warn: HTMLElement, renderedUrl: string): void {
  const update = (): void => { warn.hidden = !shouldWarnOffHost(input.value, renderedUrl); };
  input.addEventListener('input', update);
  update();
}
