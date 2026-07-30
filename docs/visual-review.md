# Visual review log

Every entry records a state that was **rendered and looked at**, not merely compiled. Screenshots
are taken of the application's own window by `CGWindowID`, never of a screen region, so an
overlapping window cannot be mistaken for the app (and nothing else on the reviewer's screen is
captured).

Capture method, for reproducibility:

```bash
screencapture -x -o -l "$(./winid "$(pgrep -f 'target/debug/atticus')")" out.png
```

`winid` is a six-line Swift helper that reads `CGWindowListCopyWindowInfo` and prints the id of the
layer-0 window owned by a pid. It lives in the scratchpad, not the repository: it is a reviewer's
tool, not part of the product.

---

## M8 — Theme, accessibility, responsive · 2026-07-30

**The first review at the widths it claims.** Every earlier entry on this page — M4's three sizes
included — was captured at half the stated width, because the driver resizes in physical pixels and
this display is 2×. The M4 row "Narrow, 900 × 700" was a 450 px viewport. Those results are not
withdrawn, but they are evidence about a narrower window than they say, and the shots below replace
them.

| State                          | Result                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| 900 × 700, dark                | Pass — sidebar and filter bar intact, the board scrolls inside itself   |
| 1280 × 820, dark               | Pass                                                                   |
| 1680 × 1000, dark              | Pass                                                                   |
| 1920 × 1080, dark              | Pass — the extra room becomes empty space, columns stay 300 px          |
| 1280 × 820, light              | Pass — V-1 gone; the titlebar follows the app theme                     |
| 1280 × 820, greyscale          | Pass — every signal still readable with the colour removed              |

At 900 px the filter bar still fits on one row with all five facet controls and the search field.
That is the width the previous overflow failure was really about: at 450 px it does not fit, and
450 px is half what product-spec §6 undertakes to support.

Asserted rather than eyeballed, and now at the real widths: the document itself never scrolls
sideways, and the assertion names any box that overhangs rather than reporting a bare `false`.

**The greyscale shot is the one to look at.** With the colour gone, the breached column still reads
`⚠ In Progress 2/1` with a heavier border, priority still reads `⌃ High`, the label chip still
carries its name beside its dot, and subtasks still read `☑ 1/3`. That is design-decisions.md §3's
promise — no signal carried by colour alone — photographed rather than asserted. The assertions that
can actually fail live in `src/features/board/greyscale.test.ts`.

### Changed on review

**The board tab strip lost its hover-only menu.** Each tab carried a "…" revealed on hover, which
put a second and third tab stop inside `role="tablist"`. It is now one permanently visible control
after the tabs, acting on the open board — visible in every shot above as `Board  +  ⋯`.

**The due-date field says "No due date".** WebKit greys today's date inside an empty date input, so
the editor made an unset due date look like one due today. Carried over from M6 and closed here.

---

## M7 — Search and filters · 2026-07-30

| State                        | Result                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| Command palette with a result | Pass — result names its project, board and column, with an excerpt |
| A filtered board             | Pass — active facets highlighted, count stated, one-click clear     |

The palette shows the task's short id on the left, its title, then where it lives and a fragment of
the description with the match in it. The status line under the list — *"1 result. Arrow keys to
move, Enter to open."* — is a live region, so the count reaches someone who cannot see the list.

The filter bar states what it is doing in words: the active facet buttons take the accent colour,
the count reads "1 of 3 tasks", and the clear button names how many facets it will clear. A board
quietly hiding work is the most confusing state this application can be in, so none of that is left
to a subtle change of shade.

---

## M6 — Task detail · 2026-07-30

| State                                   | Result                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| Task editor, every field filled         | Pass                                                            |
| A card carrying label, priority, count  | Pass                                                            |

The editor reads as one page rather than a form: description on the left with the checklist under
it, and the small fixed-size fields in a column on the right. Priority renders as five chips, each
with its own glyph, so the selected level is legible without colour. The card ends up as one line of
metadata — `TAK-6 · ⌃High · ☑1/3` — under the title, with the label chip above it.

### Changed after the user tried it

**Clicking a card did nothing.** The whole card was the drag target, so the actions menu was the
only route into the editor. Now the card is a button and the grip beside the menu does the dragging.

**The window needed a horizontal scrollbar, then opened off-screen.** Both reported directly. It is
now sized from the monitor's work area and positioned by arithmetic; measured at 2200 × 1296 at
x = 1460 on a 5120 × 1440 display, which is exactly centred and entirely on screen.

### Noted, not filed as a defect

**An empty `<input type="date">` shows today's date greyed in WebKit**, rather than a `dd-mm-yyyy`
placeholder. It is the platform control's own rendering, and the card correctly shows no due-date
chip until one is set — but it does make "no due date" look briefly like "due today" inside the
editor. Worth revisiting in M8 alongside the other date affordances; not worth replacing a native,
keyboard-accessible date control over.

---

## M5 — Movement · 2026-07-30

| State                          | Result                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| A task held mid-drag, keyboard | Pass — overlay drawn over the card, destination column highlighted   |

Captured by `e2e/specs/visual.e2e.ts` after picking a card up with `Space` and stepping with
`ArrowUp`. The lifted card is outlined in the accent colour, the column it would land in is shaded,
and the card's own slot dims — three cues, and the announcement carries the same information for
anyone who cannot see them.

**Not captured: a pointer drag in progress.** The driver cannot start one; see `docs/testing.md`.

---

## M4 — The board · 2026-07-30

Now generated by the suite rather than by hand: `e2e/specs/visual.e2e.ts` builds a populated board,
asserts it holds up at each size, and writes the shots to `e2e/artifacts/visual/`. A state that is
rebuilt on every run cannot quietly go stale the way a screenshot taken once does.

| State                                    | Result                                                          |
| ---------------------------------------- | --------------------------------------------------------------- |
| Wide, 1680 × 1000, dark                  | Pass                                                            |
| Laptop, 1280 × 820, dark                 | Pass                                                            |
| Narrow, 900 × 700, dark                  | Pass — the board scrolls inside itself; the page does not        |
| Laptop, light                            | Pass                                                            |
| Delete-column decision                   | Pass — states "1 task", focuses Cancel, defaults to moving       |
| A column over its WIP limit              | Pass — glyph, count and border, none of them colour alone        |
| A very long card title                   | Pass — clamps to three lines, column keeps its width             |

Asserted rather than eyeballed: all five columns are exactly the same width even with a long card
in one of them, and at 900 px the document itself does not overflow.

### Corrected on review

**A "defect" that was not one.** The first light-theme capture showed dark, unreadable cards. Cards
are the only elements carrying `transition-colors`, so the shot had caught them part-way through the
theme change. `shoot()` now settles before capturing. Worth recording because the screenshot was
genuinely alarming and filing it would have sent someone hunting a token bug that does not exist.

**Right-hand "empty space", investigated 2026-07-30.** Measured rather than judged by eye:
`scrollWidth` is 1748 for five columns — 1440 of columns, 60 of gaps, 224 for *Add a column*, 24 of
padding. Nothing phantom. The space reads as empty because the add-column affordance is
deliberately low contrast; raising it is an M8 item.

### Still open

**V-1** (dark titlebar in the light theme) is unchanged and still scheduled for M8.

---

## M3 — Projects and boards · 2026-07-30

Build: `npm run tauri dev`, native window, 1280 × 820, macOS 26.6, Apple Silicon.

| State                        | Theme | Result                                                             |
| ---------------------------- | ----- | ------------------------------------------------------------------ |
| Empty project list           | Dark  | Pass — sidebar and board area each carry their own empty state      |
| Empty project list           | Light | Pass — see defect V-1 below                                         |
| One project, one board, seeded columns | Dark | Pass — project selected, board tab active, both read from SQLite |

What the populated shot proves beyond layout: the project, its board, and the active tab were all
loaded over real IPC from the real database file, and the selection was restored from the
`workspace` row rather than defaulted. Last-opened restoration (US-5) is verified in the assembled
application, not only in unit tests.

The board area shows a bordered placeholder saying columns and tasks arrive in the next milestone.
It is a statement, not a control — there is nothing to click and nothing that pretends to work.

### Defects found

**V-1 · The macOS titlebar stays dark when the app theme is light.** Visible as a dark bar above a
light interface. The window chrome is drawn by the OS from the *window's* theme, which Tauri leaves
at the system value; only the web contents follow the app preference. Fix is a `window.set_theme()`
call whenever the resolved theme changes, which needs a new command, a capability entry and a
binding — too much to bolt onto M3, so it is scheduled into **M8** with the cause already known.
Not a regression and not cosmetic-only: a user who runs macOS in dark mode and picks the light
theme sees it every session.

### Not reviewed at the time, and why

Window sizes other than the launch default, dialogs and focus rings were out of reach: this
environment can capture the native window but cannot send input to it (`osascript`/System Events
fails with `-1719`, no Accessibility permission).

**Resolved in M4b.** The WebdriverIO harness drives and resizes the real window, and the M4 entry
above is the first review to use it.
