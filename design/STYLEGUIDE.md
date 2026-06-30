# expurge — Style Guide for Agents

This is the operating manual for any agent (LLM or human) building **expurge**: a free,
open-source Firefox extension that helps people find their personal data on
people-search / data-broker sites and generate opt-out requests.

**Audience:** anxious, often non-technical people worried about data exposure.
**The brand's job:** feel calm, trustworthy, human, and honest — the opposite of the
creepy broker sites it fights. Never alarming, never "antivirus/hacker."

Design tokens live in `tokens.css` (CSS custom properties) and `tokens.json`. **Always
reference tokens — never hard-code hex values in components.**

---

## 0. Non-negotiable invariants

These are ethics, not aesthetics. Do not violate them, ever, even if asked to "just for now."

1. **The on-page overlay NEVER displays the user's actual personal data.** It shows only
   *generic guidance* ("look for your age, current address, relatives' names"). The user's
   real name/address/etc. must never be rendered into a broker page.
2. **Consent is a focused page, never a popup/modal.** Single page, plain language, no
   pre-ticked boxes.
3. **Declining is exactly as easy as accepting.** Equal visual weight, equal click cost.
   No buried "no thanks," no guilt copy, no dark patterns anywhere.
4. **Profile data (name/city/state) is stored on-device only.** Never uploaded, sold, or
   used for tracking. Say so where the user enters it.
5. **Leaving is easy.** "Delete all my data" is one click, no waiting period, no
   confirmation maze — and we make that ease *visible* (the opposite of the brokers).
6. **Point users to better options when they exist** — e.g. tell California users about the
   state's free DROP service — even when it means they need expurge less.
7. **Never inflate the threat to drive action.** No countdowns, no "act now," no red alarms.

---

## 1. Voice & tone

Calm · plain-language · honest · never alarming · never naggy · on the user's side.

- Use plain words. Short sentences. No jargon, no hype, no exclamation pile-ups, no emoji.
- Frame remaining work as **"what's left to finish,"** never as failure or danger.
- Reassure about what's *fine* before describing what to do.
- Reminders state facts ("12 listings left to review. You can finish anytime."), never nag.

**Before → After**

| Context | ✗ Don't | ✓ Do |
|---|---|---|
| Scan error | "⚠ Error! Scan failed. Your data may be at risk." | "We couldn't reach that site just now. Nothing's wrong with your data — let's try again in a moment." |
| Empty | "No data found. You haven't protected yourself yet!" | "Nothing to review yet. Start a scan whenever you're ready — there's no rush." |
| Reminder | "You still have 12 unresolved exposures! Act now." | "12 listings left to review. You can pick these up anytime — they'll be here." |
| Success | "Success!!! 🎉 You crushed it!" | "Opt-out sent. We'll let you know when the broker confirms — usually a few weeks." |
| Better option | "Only expurge can keep you safe." | "In California? The state's free DROP service removes you from many brokers at once. We'll show you how — even if it means you won't need us." |

---

## 2. Color

Six colors. The green stays **cool and grayed** so it reads as a privacy tool, not
eco/wellness. Use `tokens.css` semantic variables (`--bg`, `--text`, `--primary`, …) so
light/dark swaps for free.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | Cream `#FBF6EE` | Ink `#211D18` | Page background |
| `--surface` | Cream | Ink-card `#2A2620` | Cards / panels |
| `--fill` | Oat `#ECE3D4` | `#2E2A24` | Soft fills, chips, hover wells |
| `--text` | Ink `#211D18` | Cream `#FBF6EE` | Body text |
| `--text-muted` | `#6B6053` | `#C9C2B6` | Secondary text |
| `--primary` | Pine `#2C5446` | Mint `#7FB89C` | Strip, buttons, links |
| `--on-primary` | Cream | Ink | Text on primary fill |
| `--accent` | Terracotta `#B25C3C` | `#C9744E` | **Sparing** warm accent only |

### Contrast rules (WCAG)

- **Text-safe** (use for body & UI text): ink & pine on cream/oat; cream & mint on ink.
  All ≥ 6.7:1.
- **Accent-only:** Terracotta is ~4.3:1 on cream / ~3.6:1 on dark → **never body text.**
  Use it only for large emphasis (≥24px, or bold ≥19px), a link-hover underline, or a
  single small UI detail. Never the strip, never a primary fill.
- Pine is the primary everywhere on light; **Mint is pine's lift on dark** (pine on ink is
  too low-contrast). The same swap applies to the strip and the favicon glyph.

---

## 3. Typography

Three families, clearly divided. Reference `--font-display / --font-ui / --font-mono`.

| Style | Family | Size (px) | Weight | Line-height | Use |
|---|---|---|---|---|---|
| Display | Newsreader | 48–128 | 600 | 1.1 | Wordmark, hero |
| H1 | Newsreader | 30–40 | 600 | 1.1 | Page titles |
| H2 | Hanken Grotesk | 20–24 | 600 | 1.25 | Section headers |
| Body | Hanken Grotesk | 15–16 | 400 | 1.6 | Everything users read |
| Small | Hanken Grotesk | 12.5–13.5 | 400 | 1.55 | Captions, helper text |
| Mono label | IBM Plex Mono | 11–12 | 400 | 1.4 | Labels, IDs, statuses, fine print; `.14em` tracking, UPPERCASE |

Rule of thumb: **Newsreader = the brand's human voice. Hanken = the interface. Plex Mono =
machine-facing detail.** Don't set body copy in Newsreader or Mono.

---

## 4. The wordmark

`expurge`, lowercase, Newsreader Semibold, with a pine tear-strip cut through **"pur"** —
top + bottom perforation, knocked-out letters, 3px corners. **The strip is an incision
*through* the word, not a sticker *on* it.**

### Canonical implementation

```html
<span class="xpg-wordmark">ex<span class="xpg-strip">pur</span>ge</span>
```

```css
.xpg-wordmark {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  line-height: 1;
}
.xpg-strip {
  position: relative;
  color: var(--strip-knockout);     /* cream on light, ink on dark */
  margin: 0 0.065em 0 0.05em;        /* tuned so "ex"/"ge" gaps are symmetric */
}
.xpg-strip::before {                 /* the pine band, sized off the letters */
  content: "";
  position: absolute;
  z-index: 0;
  left: -0.02em; right: -0.035em;    /* symmetric ink margins around "pur" */
  top: 0.24em; bottom: -0.05em;      /* even air above x-height, contains the "p" descender */
  background: var(--strip-bg);       /* pine on light, mint on dark */
  border-radius: 3px;
  border-top: 0.045em dashed var(--bg);
  border-bottom: 0.045em dashed var(--bg);
  box-sizing: border-box;
}
.xpg-strip > * { position: relative; z-index: 1; }
```

(Perforation dash weight scales with size; ~2.5px at hero, ~1.5px ≤48px.)

### Wordmark rules

- **Do:** keep clear space = the strip height on all sides; use cream lockup on light,
  reversed (mint strip) on dark; min size **24px** (below that use the glyph).
- **Don't:** recolor the strip (it's pine/mint only — never terracotta); enclose all four
  sides; let the strip bisect any letter (edges fall in the inter-letter gaps; the band
  fully contains "pur" including the descender); swap the typeface; add dust/fades/shadows.

### Favicon / app glyph

A **purpose-drawn deep-notch pine bar** — 3 deep notches per edge (a perforated tab), not a
shrunk-down dashed strip. Below ~16px, fall back to a **solid pine bar**. Min glyph size 16px.
Pine on light contexts, mint on dark. (See `tokens.json → wordmark`.)

### Tear motif (beyond the wordmark)

- **Top+bottom strip** is the reusable device: section dividers, a redaction bar over a
  broker name in marketing, "torn-away" progress segments. Use sparingly — accent, not wallpaper.
- **4-side enclosed "removable tab"** is a *separate* motif for standalone/animated use only
  (stickers, the install / "you're removed" moment, a literal "remove this" chip). **Never
  the wordmark, never below 24px** (the vertical dashes vanish).

---

## 5. Components

All components ship in **both light and dark** via semantic tokens. Minimum touch target
**44×44px**. Visible focus state on every interactive element (`--focus-ring` +
`--focus-ring-shadow`).

### Buttons & links
- **Primary:** `--primary` fill, `--on-primary` text, radius `--r-control` (9px), ~11px/20px
  padding. Hover → `--primary-hover`. Disabled → `--fill` bg, `--text-faint` text.
- **Secondary:** transparent bg, 1.5px `--primary` border, `--primary` text. Hover → `--fill` bg.
- **Quiet:** `--primary` text only, no border. Hover → `--fill` bg.
- **Link:** `--link` with a 1.5px underline; hover → `--link-hover` (terracotta on light).

### Form inputs (profile intake: first, last, city, state)
- `--input-bg`, 1.5px `--input-border`, radius 9px, label in Hanken 500 / 13px.
- Focus: `--focus-ring` border + 3px `--focus-ring-shadow` ring.
- Always pair the form with the on-device reassurance line (mono + glyph): *"Stored only on
  this device · never uploaded."* Collect the minimum; say why each field is needed.

### On-page overlay (signature surface)
- Compact card docked over the broker page; pine/mint perforated strip along the top edge as
  the identifier. Soft shadow, radius 14px. Reassuring and unmistakable, light on the page.
- Content: a question ("Could this listing be you?"), **generic guidance chips** (age /
  current address / relatives' names), a line stating *we never show your data here*, and the
  **four verdicts**: **Yes, this is me** (primary) · **No, not me** (secondary) · **Not sure**
  (quiet) · **Skip** (faint).
- **Three states:** `unjudged` (verdicts active) → `saving` (spinner + "Saving your
  answer…") → `recorded` (check + "Marked as yours · we'll prepare an opt-out" + Undo).
- **INVARIANT:** never render the user's real data here.

### Coverage report
- Headline as progress ("22 of 48 cleared"), not a score to fail. Stacked bar + legend with
  four buckets: **Clear** (pine/mint) · **Listed** (terracotta/`#C9744E`, "found, opt-out
  ready") · **Couldn't tell** (`--text-faint` tone) · **Not checked** (`--fill`).
- "Not checked" expands into a *why* breakdown: **need more info** (offer to add a field),
  **not yet verified** (we'll re-check automatically). Framed as "what's left to finish."

### Consent surface
- Focused single page (never popup). Three plain points: what it does / what it stores
  (on-device) / what it never does. Two **equal-weight** buttons: "Accept & continue"
  (primary) and "No thanks" (secondary). "Change anytime in Settings."

### Delete-all
- Card: "Delete everything, anytime." Body emphasizes one click, no hoops, no waiting period.
  Use calm **pine** (not red). Optional quick confirm with equal "Yes, delete it all" /
  "Keep my data" buttons and reassuring copy ("nothing is held hostage").

### Empty / loading / success
- **Empty:** glyph + "Nothing to review yet" + "Start a scan when you're ready" + button.
- **Loading:** ring spinner + "Checking 48 brokers…" + progress bar + mono "22 / 48" +
  "runs quietly in the background."
- **Success:** check in a primary circle + "You're all clear here" + reassuring follow-up.

---

## 6. Implementation checklist for agents

- [ ] Import `tokens.css`; use semantic vars, not raw hex. Support light + dark (via
      `prefers-color-scheme` and an explicit `[data-theme]` override).
- [ ] Body text only in text-safe pairings; terracotta never carries body text.
- [ ] Every interactive element ≥44px target with a visible focus ring.
- [ ] Wordmark uses the canonical recipe; never recolored/enclosed/bisected/re-typed.
- [ ] Overlay shows generic guidance only — no real user data, ever.
- [ ] Consent is a page, decline == accept in effort, delete-all is one click.
- [ ] Copy passes the voice test: calm, plain, honest, no alarm, no nag, no emoji.
- [ ] Point to better external options where they exist (e.g. CA DROP).
