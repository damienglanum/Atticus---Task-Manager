# Design decisions

How researched patterns were synthesised into an original interface for Atticus.
Research sources and what was accepted or rejected from each are in [`research.md`](research.md).

---

## 1. What the research actually gave us

Three product references were successfully read (GitHub Projects, Plane, Vikunja). Linear, Height
and Notion **were not** — their pages 404'd or dropped the connection — so **no design lineage is
claimed from any of them**, and none is used as a visual target. This matters: the interface below
is derived from information-design reasoning about *this* product's content, plus the W3C APG, not
from imitating a screenshot.

What the readable references contributed:

| Source | Idea taken | Idea rejected |
|---|---|---|
| GitHub Projects | Moving a card is a *write to a field*, so the card must show that field's value legibly | Columns as a projection over a field — ours are real records |
| Plane | A short stable identifier (`KAN-14`) is worth space on the card; labels and priority are different kinds of thing and should not look alike | Assignees, relations, cycles, work-item types — all noise for one person |
| Vikunja | Saved filters deserve first-class placement in the toolbar | AGPLv3 code (none adopted); attachment upload model |
| W3C APG | Focus styling must be visually distinct from selection styling; moves need live-region confirmation | `listbox`/`option` roles for cards — they are composite widgets |

## 2. The information-design problem, stated plainly

A card must remain readable carrying, simultaneously: a title of up to three lines, a short ID, a
priority, up to three labels plus an overflow count, a due-date state, a subtask ratio, and a file
indicator. That is up to **eight** pieces of information in roughly 260×110 px.

Everything below follows from that constraint. The design brief's warnings — no huge radii, no
excessive shadows, no oversized headings, no decorative elements — are not stylistic preferences
here; they are what happens when eight signals must coexist without shouting.

**The rule adopted across all three directions:** the title is the only element with full contrast.
Every other signal sits one step down and earns attention only by *state* — a label is quiet until
filtered on, a due date is quiet until it is near. This is the difference between a dense interface
and a noisy one.

## 3. Foundations common to all three directions

These were decided before the directions diverge, because they are correctness decisions rather
than taste.

**Typeface: the system stack.** `system-ui` resolves to SF Pro on macOS — designed for this
platform, hinted for these displays, already on disk. Zero bundle cost, zero licence question, and
it makes the app feel native rather than like a web page in a frame. `font-variant-numeric:
tabular-nums` is applied to every count (`6/5`, `2/5`, `KAN-14`) so numerals do not jitter as
values change.

> Inter was evaluated as an alternative and its licence verified as **SIL Open Font License 1.1**
> (<https://rsms.me/inter/>, accessed 2026-07-30). It is not bundled in v1 — it would be the choice
> if this app is ever built for Windows and Linux, where `system-ui` is less predictable.

**Colour foundation: Radix Colors** (`@radix-ui/colors` 3.0.0, MIT, verified on npm 2026-07-30).
Its documented properties are the reason: scales are organised by role — "Backgrounds",
"Interactive components", "Borders and separators", "Solid colors", "Accessible text" — light and
dark are paired scales rather than inverted values, and *"Text colors are guaranteed to pass target
contrast ratios against the corresponding background colors"* using the APCA algorithm
(<https://www.radix-ui.com/colors>, accessed 2026-07-30).

We take the **scales**, not a look. Which steps map to which of our tokens is decided and recorded
during milestone 8 and verified by measurement, not asserted here.

**Icons: Lucide only** (`lucide-react` 1.27.0, ISC). One set, consistent stroke weight. No emoji in
the interface chrome — emoji appear only if the user picks one as a project symbol, which is not
offered in v1 (projects use a colour).

**Non-colour encoding, everywhere.** Priority has a distinct glyph per level. Due-date state has an
icon plus a text label. A WIP breach shows a count, an icon, and a border change. Every one of these
survives greyscale, which is the test we actually run in milestone 8.

**Density baseline: 4 px.** Everything is a multiple of 4. Column width 300 px fixed (never below
260). Card vertical rhythm in 4 px steps.

## 4. Three directions

### Direction A — "Ledger"

**Thesis:** the board is a *document*, not a dashboard. Structure comes from rules and alignment,
the way a well-set table or a ledger page does — not from floating boxes. Nothing is elevated,
because nothing needs to be: separation is achieved by a hairline and consistent alignment, which
costs zero visual weight and never competes with content.

**Typography.** System stack. Card title 13px/1.35, weight 500. Metadata 11px, weight 450,
one contrast step down. Column header 12px, weight 600, uppercase with +0.04em tracking — the only
uppercase in the app, so it reads as structure rather than emphasis. No heading above 15px anywhere;
the workspace is the point.

**Colour strategy.** Near-neutral greys (Radix `sand`/`slate`) carrying almost everything, with a
**single** desaturated ink-blue accent used only for: focus rings, the active board tab, and the
primary action in a dialog. Priority and labels are the *only* other saturated colour on screen,
and both are small. Backgrounds differ between page, column, and card by one scale step each — just
enough to read as layered without any border being needed for the effect.

**Density.** Highest of the three. Card padding 10px 12px; 6px between cards; column gutter 12px.
A 900px-tall window shows ~7 cards per column.

**Spacing system.** 4px base: 4 / 8 / 12 / 16 / 24 / 32. Only six values exist. Anything else is a
bug.

**Surfaces and borders.** Radius 4px throughout — enough to not look accidental, small enough to
stay out of the way. Borders are 1px hairlines at a low contrast step. **Zero shadows** in the
resting state; exactly one shadow exists in the entire system, on the drag overlay, to signal
"lifted". Popovers and dialogs use a border plus a scrim, not elevation.

**Board and card treatment.** Columns are vertical bands separated by a hairline, with a sticky
header carrying name, count, and WIP indicator. Cards are hairline-bordered rectangles; the card's
left edge carries a 2px priority bar when priority > None — a non-colour-dependent position cue that
costs no vertical space. Labels are small text chips with a 1px border and a 6px colour dot, not
solid colour fills, so three labels do not overwhelm a title. Due date and subtask ratio sit on one
metadata row with the ID, right-aligned to the card edge so they form a scannable column down the
board.

**Advantages.** Maximum information per pixel. Ages well. Reads as a professional tool. Trivially
accessible: contrast comes from type weight and scale steps, not from colour tricks. Cheapest to
render and to keep consistent.

**Risks.** Can read as austere or "unfinished" to someone expecting visual richness. Hairlines must
be tuned carefully per theme or they vanish in dark mode. With zero elevation, the drag overlay has
to work hard to read as lifted.

---

### Direction B — "Workbench"

**Thesis:** cards are *objects on a surface*. The board is a recessed work surface; cards sit on it
and can be picked up. The physicality is functional, not decorative — it makes drag-and-drop
legible, because a thing that is already an object obviously lifts.

**Typography.** System stack. Card title 13.5px/1.4, weight 500. Metadata 11.5px. Column header
13px weight 600, sentence case — softer than A's uppercase. Marginally larger sizes throughout to
match the more generous spacing.

**Colour strategy.** Warm neutrals (Radix `sand`) rather than cool greys. The board surface is one
step *darker* than the cards in light theme — inverting the usual "cards on white" so cards read as
raised without needing a strong shadow. Accent: a clay/amber tone for the active state. Warmth is
carried by the neutrals themselves, not by tinting the accent, which keeps saturated colour
reserved for labels and priority.

**Density.** Moderate. Card padding 12px 14px; 8px between cards; column gutter 16px. ~6 cards per
column in a 900px window — about 15% less than A.

**Spacing system.** 4px base: 4 / 8 / 12 / 16 / 20 / 24 / 32.

**Surfaces and borders.** Radius 6px. **One** shadow level for resting cards (a 1px, very low-alpha
drop) and a second, larger one for the drag overlay. Borders are used sparingly — the surface
contrast usually does the separating work, and a border is added only where contrast alone is
insufficient (dark theme).

**Board and card treatment.** Columns are shallow wells with a slightly recessed background and a
rounded top. Cards are the only rounded, elevated elements in the app, which makes "card" mean
something. Priority is a filled glyph at the top-right of the card rather than an edge bar. Labels
are soft-filled chips (colour at ~12% alpha with matching text) — more visible than A's outline
chips, which is the tradeoff for lower density.

**Advantages.** Most immediately pleasant. Drag-and-drop is the most legible of the three because
the metaphor is already established at rest. Warm neutrals are easier on the eyes over long
sessions than cool greys. Most forgiving of imperfect spacing.

**Risks.** ~15% less information on screen — a real cost for the "what's the state of this project"
job. Two shadow levels and a warm palette drift toward generic-friendly-SaaS if not held tightly.
Soft-filled label chips compete with the title when a card has three of them; needs testing at the
worst case, not the average one.

---

### Direction C — "Console"

**Thesis:** a developer's board should read like a developer's tools. Monospace for every
identifier and count, strong structural lines, maximum contrast, no softness. Optimised for
scanning and for keyboard operation, and honest about being a technical instrument.

**Typography.** Dual stack: `system-ui` for titles and prose, `ui-monospace` (SF Mono) for IDs,
counts, dates, and estimates. Card title 13px/1.35 weight 500. Mono metadata 10.5px with tracking
−0.01em. Column header 11px mono, uppercase.

**Colour strategy.** Cool near-neutrals (Radix `slate`) at higher contrast than A — borders sit at
a visibly darker step, so structure is explicit rather than implied. Accent: a single signal colour
(cyan in dark, deep teal in light) used only for focus and active state.

**Density.** Highest possible. Card padding 8px 10px; 4px between cards; column gutter 8px.
~8 cards per column at 900px.

**Spacing system.** 4px base, but with a 2px half-step available for mono metadata rows.

**Surfaces and borders.** Radius 2px — nearly square. Borders 1px at a clearly visible step; they
are the primary structural device. No shadows at all, including on the drag overlay, which instead
inverts its border and gains a 2px accent outline.

**Board and card treatment.** Columns are bordered boxes in an explicit grid. Cards are bordered
rectangles with the ID in mono at the top-left, giving every card a consistent anchor point for the
eye. Labels are bracketed mono text (`[api]`, `[bug]`) with a colour dot — extremely compact and
completely readable in greyscale. Due dates render as `07-30` in mono, right-aligned, forming a
literal column.

**Advantages.** Densest and fastest to scan once learned. Mono metadata aligns perfectly down a
column, which no proportional font achieves. Greyscale-safe almost by default. Distinctly not a
generic dashboard.

**Risks.** **Highest.** Small mono at 10.5px risks failing the "no tiny low-contrast text" rule —
it must be measured, and may need to grow, which erodes the density advantage. High-contrast
borders everywhere can read as busy in light theme. Bracketed labels are an acquired taste and are
worse than chips for a user who thinks in colour. Most likely of the three to be tiring over a long
session.

## 5. Recommendation

**Direction A — "Ledger".**

- **Decision:** adopt Ledger as the visual direction.
- **Evidence:** the governing constraint (§2) is eight signals in a small card. A resolves it with
  the cheapest possible devices — hairlines, alignment, one accent, and a single shadow reserved
  for the one moment that needs it. It also has the smallest gap between "looks right" and "is
  accessible": its hierarchy is built from type scale and contrast steps, which are the same things
  WCAG measures.
- **Alternatives considered:** B is more pleasant on first sight and makes drag most legible, but
  costs ~15% of the screen for it, and the job to be done (§product-spec J1) is answered by seeing
  more, not by seeing prettier. C is the most distinctive and the best-aligned to a developer's
  instincts, but its density comes from small mono text, which is precisely the pattern the brief
  warns against, and it is the direction most likely to need walking back after contrast
  measurement.
- **Tradeoffs of choosing A:** it will look austere before the details are in. The drag overlay and
  the dark-theme hairlines need real care, and those are the two places milestone 8 must spend its
  time.
- **Recommendation:** A, with one idea borrowed from each of the others — C's `tabular-nums` and
  right-aligned metadata column (already in the foundations, because it is correct regardless), and
  B's single drag shadow, which A already reserves for exactly that purpose.

## 6. Token structure (values measured in milestone 8)

Defined in `src/styles/tokens.css` as CSS custom properties inside Tailwind v4's `@theme`, so they
are usable by Tailwind utilities *and* by plain CSS.

| Group | Tokens |
|---|---|
| Colour | `--color-surface-{app,column,card,raised,sunken}`, `--color-fg-{primary,secondary}` plus `--color-fg-muted`, `--color-border-{subtle,default,strong}`, `--color-accent-{fg,bg,solid,border}`, `--color-on-solid`, `--color-{priority,due,label}-*`, `--color-danger-*`, `--color-warning-*` |
| Typography | `--font-{sans,mono}`, `--text-{2xs,xs,sm,base,lg}` each with a paired line-height, `--font-weight-{normal,medium,semibold}` |
| Spacing | `--space-{1,2,3,4,6,8}` (4→32px). Six values, no others |
| Radius | `--radius-{sm,md,lg}` = 2 / 4 / 8px |
| Border | `--border-width-{hairline,default}` = 1 / 2px |
| Shadow | `--shadow-overlay` — **the only shadow in the system** |
| Motion | `--duration-{fast,base}` = 100 / 160ms, `--ease-out`; all zeroed under `prefers-reduced-motion` |
| Focus | `--focus-ring-{color,width,offset}` — one ring, used identically everywhere, ≥3:1 against both neighbours |
| Z-index | `--z-{base,sticky,dropdown,overlay,dialog,toast}` = 0 / 10 / 20 / 30 / 40 / 50. Numbers appear nowhere else |

Every one of these is verified by measurement in milestone 8, not by eye.

### What the measurement changed

`src/styles/contrast.test.ts` resolves the tokens through the same `var()` chain the browser
follows and computes the WCAG 2.2 ratio for every pair the interface can actually produce, in both
themes. Four of the assignments sketched above did not survive it:

- **There is no third foreground step.** Radix guarantees two accessible text steps per scale. Step
  10 measured 3.33:1 on our own surfaces, so `--color-fg-tertiary` is gone and `--color-fg-muted`
  took its place, restricted to disabled and inactive states.
- **The focus ring is step 11, not the step 9 accent**, which fell to 2.77:1 on the raised surface
  in the dark theme. Step 11 is a paired scale, so one token still covers both themes.
- **A control's boundary is step 10.** Step 8 measured 1.68:1. Container hairlines were left where
  they were: SC 1.4.11 governs what identifies a *control*, and a dialog is identified by what is
  in it.
- **The danger solid is pinned rather than derived**, because white on a fill has the same contrast
  in both themes and so cannot come from a scale that flips.

The worst measured ratio in either theme is now 3.33:1 for a control boundary against a 3:1
threshold, and 5.21:1 for text against 4.5:1. The numbers are printed by the test, not only
asserted.
