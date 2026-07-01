// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { shouldWarnOffHost, wirePasteWarning } from './paste';

const RENDERED = 'https://www.truepeoplesearch.com/results?name=Jane%20Doe&citystatezip=Reno';

describe('shouldWarnOffHost', () => {
  it('off-host URL → warn', () => {
    expect(shouldWarnOffHost('https://www.google.com/x', RENDERED)).toBe(true);
  });

  it('on-host URL (exact or subdomain) → no warn', () => {
    expect(shouldWarnOffHost('https://www.truepeoplesearch.com/find/person/1', RENDERED)).toBe(false);
    expect(shouldWarnOffHost('https://cdn.www.truepeoplesearch.com/x', RENDERED)).toBe(false);
  });

  it('empty / whitespace → no warn', () => {
    expect(shouldWarnOffHost('', RENDERED)).toBe(false);
    expect(shouldWarnOffHost('   ', RENDERED)).toBe(false);
  });

  it("unparseable paste → warn (can't confirm it's the broker)", () => {
    expect(shouldWarnOffHost('not a url', RENDERED)).toBe(true);
  });
});

describe('wirePasteWarning — the DOM event path', () => {
  const setup = () => {
    const input = document.createElement('input');
    const warn = document.createElement('p');
    wirePasteWarning(input, warn, RENDERED);
    return { input, warn };
  };
  const enter = (input: HTMLInputElement, value: string) => {
    input.value = value;                       // what a paste does to the field…
    input.dispatchEvent(new Event('input'));   // …then fires the input event
  };

  it('starts hidden (empty field)', () => {
    expect(setup().warn.hidden).toBe(true);
  });

  it('an off-host paste shows the warning', () => {
    const { input, warn } = setup();
    enter(input, 'https://www.google.com/x');
    expect(warn.hidden).toBe(false);
  });

  it('replacing it with an on-host URL hides the warning again', () => {
    const { input, warn } = setup();
    enter(input, 'https://www.google.com/x');
    enter(input, 'https://www.truepeoplesearch.com/find/person/1');
    expect(warn.hidden).toBe(true);
  });

  it('clearing the field hides the warning', () => {
    const { input, warn } = setup();
    enter(input, 'https://evil.example/x');
    enter(input, '');
    expect(warn.hidden).toBe(true);
  });
});
