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

**Density baseline: 4 px.** Everything is a multiple of 4. Board columns share
the available width equally between 260 and 384 px, then scroll rather than
shrinking below that readable floor. Card vertical rhythm stays in 4 px steps.

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

## 7. v1.1 — the visual direction, revised

Milestones 1–10 shipped Direction A ("Ledger", §5): austere, dense, indigo, and built to put as
many cards on screen as the type scale allowed. v1.1 keeps its reasoning and changes its clothes.
The brief was a set of mockups; what follows is what they asked for, and what was refused.

### What changed, and why

- **The accent is cyan, not indigo.** A brand decision, taken by the product owner. It carries a
  measurement consequence recorded in `tokens.css`: cyan is a high-chroma scale, and neither its
  step 9 (3.00:1 against white) nor its light step 11 (4.19:1 on the sunken surface) clears the
  threshold the interface holds itself to. Both are therefore *pinned* to darker values, exactly as
  `--color-danger-solid` already was. **The buttons are a deeper cyan than the mockups show, and
  that is the reason.** The alternative — the mockups' brighter fill with a white label — measures
  around 2.8:1, which this codebase does not ship.
- **The canvas is white and the panels are tinted**, inverting v1.0, where a tinted page held
  near-white columns. This single swap is most of why the board now reads as panels on a page.
- **The type ceiling moved, slightly.** v1.0 capped every string at 15px. v1.1 keeps that for the
  board's contents — card titles went from 12 to 14px, and that is the largest change — and breaks
  it only for the page title and the editor's, which are `--text-xl` (22px). There are two of them
  in the whole application.
- **Cards carry two lines of description.** The mockups' cards are scannable without opening
  anything, and this is what does it. It is also the one change that costs density: a column shows
  fewer cards than it did, which §5 explicitly traded the other way. The trade is reversed because
  a card that must be opened to be understood is not a card that saved you anything.
- **The task editor is a page, not a floating dialog** — full window, its own header, and an
  edge-to-edge body with a fixed metadata rail. The main workspace becomes a writing column plus a
  supporting checklist/reference column when the window is wide enough; it never returns to a
  centred outer canvas. It is still a Radix dialog underneath (`DialogPage`): Escape, focus
  trapping, focus restoration and `aria-hidden` on the background are not worth reimplementing for
  a visual result that does not depend on them.

### What the mockups asked for and did not get

The mockups depict a different product in places, and those parts were declined rather than faked.
Atticus is local-first and single-user; there is no account, no server and no second person.

- **Assignee avatars, a member stack, "Discussions", and "Last synced with Cloud"** — there is
  nobody to assign to and nothing to sync with. Rendering them would be a promise the application
  cannot keep.
- **A notification bell** — nothing generates notifications.
- **A Dashboard and a Notes section** — features, not styling. Not built.
- **A "Welcome, share your name" first-run screen** — the application has no concept of a user.
- **A Cancel / Save Changes pair in the editor** — v1.0's no-save-button decision stands, and the
  header says "Saves as you type" instead. A save button users can forget costs them their writing.

### One deviation worth naming

The mockup's editor header reads "Edit Task". Ours reads the task's own name, because that string
is the dialog's accessible name — and "Edit Task" would tell a screen-reader user only that *a*
task is open. The reference sits above it, where the mockup puts its breadcrumb.

### The one-shadow rule survived

`--shadow-overlay` is still the only shadow in the system, and still reserved for the drag overlay
and true overlays. Every panel, card and column in the new direction is separated by a hairline and
a surface step. Where the dark theme cannot spend a shadow, it spends a step instead — which is why
`--color-surface-raised` is now one step above the card rather than equal to it.

## 8. v1.1 — the mockups as the specification

§7 recorded a restyle: the mockups read as a visual direction, and the parts that
depicted a different product were declined. That was the wrong reading. The
mockups are the specification, minus the parts that require a server. This
section records what that changed and what it cost.

### Reversed from §7

- **The task editor has Cancel and Save Changes**, and they do what they say.
  Nothing typed in the editor reaches the database until Save; Cancel discards
  the draft. This reverses US-10's no-save-button rule, which v1.0 argued for on
  the grounds that a save button is a thing to forget. The argument was sound and
  it lost to a stronger one: the design calls for a Cancel, and a Cancel that
  cannot cancel is a worse lie than a Save you might forget. **The forgetting is
  now guarded** — closing a dirty editor asks first — so the failure mode the old
  rule avoided is covered by the guard rather than by the button's absence.
  The draft covers the checklist and the linked files too, not only the task's own
  columns; see `taskDraft.ts` for why that was worth the extra code.
- **Onboarding, Dashboard, and Notes are built.** §7 called them "features, not
  styling" and declined them. They are features, and they were the ask.

### What the "minus the online part" line excludes

Assignees and avatars, the member stack, Discussions, and "Last synced with
Cloud". Also the email address under the sidebar profile: a name is a local
preference, an email address implies an account. Everything else in the mockups
was built, including the bell — which reports things this machine can see for
itself, currently projects whose folder has moved.

### What each new surface cost

| Surface | Where it lives |
|---|---|
| Welcome screen | Frontend only. The name is a `ui_state` key, not a schema change |
| Dashboard, My Projects | Frontend only, derived from board snapshots already loaded |
| Notes | **Schema 2** — a table, an FTS index, four commands, export coverage |
| Editor furniture | Frontend: markdown toolbar, checklist badge, Status select, tag chips |

### Notes, and the export version

Adding a table means adding a collection to the export document, which means
`CURRENT_EXPORT_VERSION` is now **2**. ADR-0006's chain gained its first real
arm, `v1_to_v2`, and `tests/fixtures/exports/v2.json` is checked in beside
`v1.json` — the guard that demands one per released version failed until it was,
which is the guard working.

A note is deliberately **not a task without a column**. It has no status, no
board position and nothing to drag; giving it those would mean every board query
filtering them out forever after.

### Three places the design was not followed exactly, and why

- **"Upload files" is "Link files".** ADR-0007 records the path and never copies
  the file. A control labelled Upload would promise a copy that does not exist,
  and the promise fails much later — when the original moves.
- **The primary buttons are a deeper cyan than the swatch.** Unchanged from §7,
  and measured: the brighter fill carrying a white label is about 2.8:1.
- **`EXTERNAL LINKS` is not built.** The one panel from the editor mockup that is
  missing. It needs its own table and commands, and was scoped out.

## 9. The mark, and the splash

Both come from a supplied asset: eight topographic contours drawn from the
centre outward, over 5.067 seconds, in `#dedede` on black.

### The mark

The v1.1 mark was a cyan tile with a check glyph inside it. This replaces it with
the contour map, drawn in line rather than filled. Linework has no inside, so it
takes `currentColor` from whatever it sits in and needs no separate contrast
argument for a glyph — the tile did.

**It sheds rings as it shrinks.** Eight contours inside a compact sidebar mark
is a smudge. Below 25 px it draws two; the 36 px sidebar lockup draws three;
medium marks step through four and five; from 96 px the full eight-ring artwork
has enough room to breathe.

Two things had to be got right for that to work, and the first attempt got both
wrong:

- **The frame shrinks with the artwork.** Slicing the outer rings off while
  keeping the 360 × 360 canvas leaves the survivors in the middle of a mostly
  empty box. Rendered at sidebar size it was a speck with a wide margin. `VIEW_BOXES`
  in `logoContours.ts` holds a computed square box per ring count.
- **The stroke is specified in rendered pixels, not viewBox units.** The source
  art's 2.2 units is right at 360 px and renders 0.4 px at 64 px — which made
  the *full* mark paler than the reduced one above it in the size ladder.
  `targetStroke` converts a target thickness back into viewBox units.

Geometry lives in `src/components/ui/logoContours.ts` and is read by both the
in-app logo and the splash window. One copy: eight path strings of that length,
duplicated, would drift the first time one was nudged.

### The splash

A real second Tauri window, not a React screen inside the app. By the time React
can paint, the slow part of a cold launch is over; a splash that appears then is
just a delay. `splash.html` is a second Vite entry with inline CSS and no
framework. The current composition puts a 156 px contour mark beside a quiet
divider, the Atticus wordmark, and a small `LOCAL WORKSPACE` status line. It is a
launch identity rather than a miniature version of the application shell.

**SVG plus the native Web Animations API is the right amount of machinery.** The
eight supplied paths already describe the artwork exactly, and WAAPI can reveal
their strokes without adding React, a timeline dependency, or a rendering
context before the first useful paint. Anime.js would only replace a small
native timeline; WebGL would add shaders, a canvas, and context-loss handling to
a two-dimensional line drawing. Both would make startup less reliable without
changing what the user sees.

**The essential reveal lasts 1.65 s.** Contours resolve from the centre outward,
a brief cyan tracing front settles into the finished mark, then the divider,
wordmark, and workspace line arrive. The halo and status point may breathe after
that while a cold database is still opening, but ambient motion is not part of
the hand-off. The supplied 5.067 s sequence was still too much of a title
sequence; the earlier 1.5 s draw felt rushed once the wordmark joined it.

Two signals — `splash_animation_finished` from the splash and `app_ready` from
the shell — control the transition, and whichever arrives second shows the main
window. A fast start therefore gives the 1.65 s reveal room to land; a cold start
is never cut off and never closes before the workspace is ready. With Reduced
Motion enabled, the splash settles directly into its completed frame and reports
completion immediately; the halo and status-point loops are disabled too.

The hand-off fails open at both ends. The splash script races the native
animation promises with a short bounded guard and reports completion even if its
root is missing or an animation API throws. Once `app_ready` has arrived, Rust
also starts a one-shot 2.8 s watchdog. If the splash's JavaScript or IPC message
never arrives, the watchdog still shows the main window before closing the
splash. An atomic claim keeps duplicate commands and the watchdog from swapping
the windows twice.

The main window is created with `visible: false` and shown by the same handshake.
Without that, the OS draws an empty white frame beside the splash for the whole
boot.

**`app_ready` fires when the shell's two queries have *settled*, not succeeded.**
A database that failed to open still has a recovery screen to show, and leaving
somebody on a splash because their data is in trouble would be the worst possible
moment for it.

Under the `e2e-webdriver` feature the splash is closed in `setup` and the main
window shown immediately: the harness pins `main` by label and drives it, and a
launch experience is not what those specs are testing.

### The application icons

Generated by `scripts/generate-icons.py`, not exported by hand, and **drawn once
per logical size and pixel density rather than downscaled from one master**. The
packaged icon deliberately uses the same three-contour geometry as the 36 px
sidebar mark; 16–32 px representations drop to two. Fuller five- and
eight-contour variants turn into visual noise in the Dock and browser tabs.
Standard and Retina renders receive independent line weights and are packed
directly into their matching `.icns` entries.

The line weight scales with the artwork above compact sizes. Capping the 1024 px
source at a 2.2 px line made the cyan less than a pixel after macOS downsampled
it, which read as fog rather than a mark. Placement uses the length-weighted
centre of the visible strokes as well: control-point bounds left this asymmetric
shape visibly low and right even when its SVG box was mathematically centred.

The script reads the geometry from `logoContours.ts`, so the icon and the
interface cannot disagree about what the mark is. It needs Pillow and is not
part of `npm run verify`: it writes binary assets that are checked in, and it is
run when the mark changes.

The artwork is the simplified contour mark in a crisp `#6ee2f1` cyan on a
cool graphite tile, inside a rounded square with a 10% baked-in margin. A narrow
rim and restrained vertical value shift keep the tile legible in a dark Dock;
there is no glow or blur. The small representation gets real foreground pixels
instead of a halo that turns grey when resampled.

### The name

`Atticus`, not `Atticus - Task Manager` — in the bundle, the window title, the
document title, and the prose. The suffix was a description wearing a name's
clothes, and it was the only thing in the menu bar.

**The Cargo binary target is `Atticus` too**, which is not redundant with
`productName`. `tauri dev` runs the compiled binary directly rather than a
bundle, and macOS labels the Dock tile with the executable's own file name — so
with a lower-case `atticus` target the application announced itself in lower
case for the whole of development, whatever the config said. `mainBinaryName`
pins the same string on the bundle side. Renaming the target moved the paths in
`wdio.conf.ts`, `e2e.mjs` and `check-release.mjs`, which all name it.

### The favicon

`public/favicon.svg`, generated from the same contours. Never visible in the
shipped application — a Tauri window has no tab bar — but the dev server is
opened in a browser constantly, and a blank page icon is a small permanent
papercut. It carries the black square rather than being bare linework, because a
favicon sits on browser chrome that may be either light or dark.
