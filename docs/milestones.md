# Milestone plan

Ten vertical milestones. **The application is runnable and the quality gates are green at the end
of every one.** Work does not proceed past a milestone whose critical checks are failing; a failure
is reported, not carried.

Gate command for every milestone (defined in milestone 1):

```bash
npm run verify
```

which runs, in order: format check → lint → `tsc --noEmit` → `vitest run` → `cargo fmt --check` →
`cargo clippy -- -D warnings` → `cargo test` → `vite build`.

---

## M1 — Repository, quality gates, desktop shell

**Delivers:** a Tauri window that opens, showing an app shell with nothing in it.

Acceptance criteria:
- `npm run tauri dev` opens a native window on macOS.
- `npm run verify` passes end to end and is the single gate used by every later milestone.
- TypeScript strict mode on, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- ESLint + Prettier configured; `@typescript-eslint/no-explicit-any` is an **error**.
- `clippy -D warnings` clean; `rustfmt` clean.
- Tailwind v4 via `@tailwindcss/vite`; `@/*` alias in `tsconfig.json`, `tsconfig.app.json` and
  `vite.config.ts`.
- Explicit CSP in `tauri.conf.json` (architecture §11); one `main` capability with a minimal
  permission list.
- One trivial Vitest test and one trivial Rust test exist and run, proving both harnesses work.

Risks: Tailwind v4 + shadcn init on Vite 8 is a combination worth verifying early rather than at
milestone 8.

## M2 — Database, migrations, typed persistence

**Delivers:** the database is created, migrated, and provably correct. No UI yet beyond a
diagnostics panel showing the database path and version.

Acceptance criteria:
- Migration 1 creates the full schema from architecture §3.1.
- `PRAGMA foreign_keys` reads back as 1 on every connection — asserted by a test, not assumed.
- WAL + `synchronous=FULL` asserted by a test.
- A violating insert fails; `ON DELETE CASCADE` verified for each relation.
- **FTS5 availability verified by a test.** If absent, the documented fallback (architecture §3.1)
  is implemented in this milestone, not later.
- Migration runner: applies pending migrations in one transaction; refuses a newer database;
  takes a pre-migration backup; a deliberately failing migration leaves the database untouched and
  returns `AppError::Migration` with a real backup path.
- `ts-rs` binding generation wired; `src/lib/bindings/` committed; CI diff check in `npm run verify`.

## M3 — Projects and boards

**Delivers:** create, rename, archive, restore, delete projects; multiple boards per project;
last-opened restored on launch.

Acceptance criteria: product-spec US-1 … US-5. Project delete requires typed confirmation, states
exact counts, focuses Cancel, cascades in one transaction. Empty, loading and error states exist
for the project list and are visually inspected.

## M4 — Columns and task CRUD

**Delivers:** a usable board. Columns add/rename/reorder/delete with dispositions; tasks create,
edit, duplicate, archive, delete.

Acceptance criteria, all met on 2026-07-30:
- ✅ US-6 columns add / rename / reorder / delete. Reorder is a keyboard-reachable menu command;
  pointer dragging follows in M5. Deletion with tasks offers move-or-delete, states the exact count,
  runs in one transaction, and is undoable.
- ✅ US-7 WIP limits. Three signals for a breach — count, warning glyph, heavier border — plus a
  polite live-region announcement, so none of them is colour alone.
- ✅ US-9 quick capture. Title alone; Enter keeps the composer open; Escape restores focus; an empty
  title is a no-op, not an error.
- ✅ US-11 duplicate, placed directly below the original with its own task number.
- ✅ US-12 archive and restore, with an archive panel that exists so archiving is not a one-way door.
  AC2's "column no longer exists" fallback is unreachable — see the decision log.
- ✅ `board_load` asserted to issue the same number of queries with 0 tasks and with 60, by a test
  that counts statements through `trace_v2`.

Result: 139 Rust tests, 119 component tests, 16 end-to-end specs.

## M4b — End-to-end harness _(pulled forward from M10 on 2026-07-30)_

**Delivers:** the ability to drive and photograph the real application window.

Rationale for the move: M3's visual review established that this environment can screenshot the
native window but cannot send input to it — `osascript`/System Events is refused with `-1719`, no
Accessibility permission. So from here on, every claim about an interaction ("the dialog traps
focus", "the card moved", "it works at 900 px wide") is either unverifiable in the real app or
verified only against jsdom. M5's headline criterion — *move a task with no pointer events at all*
— is precisely such a claim, and it is the highest-risk work in the plan. The harness has to exist
before it, not after.

Acceptance criteria, all met on 2026-07-30:
- ✅ `@wdio/tauri-service` drives the built binary: launch, click, type, resize the window,
  screenshot. All five verified by passing specs, not by inspection.
- ✅ Smoke spec green: launch → create a project → assert it is listed → restart → assert it is
  still listed, **and** that the restart reopened it rather than starting blank.
- ✅ The WebDriver server is absent from every build except the end-to-end one. It turned out to need
  no capability entry at all (it exposes nothing to the frontend), so the promised release-capability
  check is replaced by a Rust test that reads `Cargo.toml` and fails if the dependency stops being
  optional or a default feature enables it. Same property, asserted at its actual source.
- ✅ The plugin proved reliable. Three problems were hit and all three were ours: a build-artefact
  collision, a config module evaluated twice, and a selector that matched the wrong dialog.
- ➕ Not originally required: every run gets a throwaway database, and an isolation spec ordered
  first refuses to let the suite touch real data.

Result: 7 specs, ~26 seconds. See `docs/testing.md`.

## M5 — Ordering and accessible movement

**Delivers:** reliable movement by pointer, by keyboard drag, and by explicit command.

Acceptance criteria, on 2026-07-30:
- ✅ 500 pseudo-random moves from a fixed seed, with every column asserted dense after **each** one,
  and no task lost or duplicated across the run.
- ✅ A no-op move writes nothing and leaves `updated_at` untouched — including a drop past the end of
  a column the task is already last in, which clamps to where it already is.
- ✅ Move into an empty column; first↔last swaps; an index past the end appends.
- ✅ Single-flight queue: 50 dispatches run strictly in order, one at a time, and one rejection does
  not wedge the queue. Fifty consecutive moves through the interface land exactly where the last
  implies.
- ✅ A forced command failure rolls the card back to its original column and names it in the toast.
- ✅ **A task moves between columns using no pointer events at all**, driven end to end. dnd-kit's own
  keyboard drag (`Space`, arrows, `Space`) is covered separately, as is `Escape` issuing no command.
- ✅ `screenReaderInstructions` and `announcements` replaced with board vocabulary and "position 2 of
  5" wording, asserted through the card's own `aria-describedby`.
- ⚠️ **Pointer drag is implemented but not covered end to end.** The embedded WKWebView driver can
  click — a `performActions` press opens the settings dialog — but a press-move-release gesture
  never activates dnd-kit's sensor, with either `PointerSensor` or `MouseSensor`, and with gestures
  from two coarse steps up to twelve fine ones. Everything downstream of the gesture is shared with
  the keyboard paths and is covered; what is unverified is dnd-kit's pointer activation itself.
  Recorded rather than assumed. See `docs/testing.md`.

Result: 155 Rust tests, 145 component tests, 45 end-to-end specs.

## M6 — Task detail: subtasks, labels, priority, due dates, files

**Delivers:** the full task editor.

Acceptance criteria, all met on 2026-07-30:
- ✅ US-10 the full editor. No save button: every field writes on a 400 ms pause, on blur, and on
  close. Markdown renders with **raw HTML disabled** (no `rehype-raw`, asserted by a test), remote
  images refused, and only `http`/`https`/`mailto` links opened — through the system browser.
- ✅ US-13 subtasks: ordered, reorderable, counted on the card, and completing all of them does
  nothing to the parent.
- ✅ US-14 labels: per project, name always shown beside the colour, at most three on a card then
  "+2" — with the hidden ones named for assistive technology. Deleting one states the task count and
  is undoable.
- ✅ US-15 the fixed five-level priority scale, each level with its own glyph as well as a colour.
- ✅ US-16 due-date states, each with words as well as a colour, and "today" re-read when the window
  regains focus so a board left open overnight is not stale.
- ✅ US-17 file references: chosen through the system dialog, verified when the editor opens, with a
  real "missing" state showing the path and a Locate action. The webview holds no filesystem
  permission and reveals files by reference id, never by path.
- ✅ US-18 short IDs, copyable from the editor, never reused after deletion.
- ✅ `board_load` still a fixed number of queries with labels and subtask counts added — six, and the
  test says why each one is there.

Result: 187 Rust tests, 195 component tests, 52 end-to-end specs.

## M7 — Search, filters, palette, shortcuts

**Delivers:** `⌘K` palette, global search, board filters, saved filters, undo.

Acceptance criteria, all met on 2026-07-30:
- ✅ US-19 `⌘K` searches titles and descriptions across every unarchived project, ranked with
  `bm25` (titles weighted ten to one), each result naming its project, board and column. Choosing
  one switches to that board and opens the task.
- ✅ US-20 filters by column, priority, label and due-date state. Per board, persisted, stated in
  words — "1 of 3 tasks" — with a one-click clear.
- ✅ US-21 saved filters, per project, applied from the toolbar.
- ✅ US-22 undo on the toast **and** `⌘Z`, for every action ADR-0009 lists. Project deletion says in
  its dialog that it cannot be undone.
- ✅ **Search over 5,000 tasks measured at 5.2 ms**, against a 100 ms budget. The number is printed
  by the test under `--nocapture` rather than only asserted.

Result: 204 Rust tests, 228 component tests, 68 end-to-end specs.

## M8 — Theme, accessibility, responsive, visual polish

**Delivers:** the chosen visual direction, fully applied.

Acceptance criteria: US-23, US-24, product-spec §10 in full. Contrast measured, not eyeballed, in
both themes. Focus visible and distinct from selection everywhere. Full keyboard pass with no
mouse. Window widths 900 / 1280 / 1920 inspected. Reduced-motion honoured.

Acceptance criteria, all met on 2026-07-30:

- ✅ **Contrast measured in both themes.** `src/styles/contrast.test.ts` resolves the tokens through
  the same `var()` chain the browser follows and computes every pair the interface can produce. It
  found four real defects and all four are fixed — see the decision log. The worst measured ratio is
  now 3.33:1 for a control boundary against a 3:1 threshold and 5.21:1 for text against 4.5:1. The
  numbers are printed, not only asserted.
- ✅ **A focus ring that is actually drawn.** `outline-none` was suppressing it on every text field
  in the application; the menu row's highlight was 1.1:1. Both fixed, and the regression is guarded
  at the source, because neither jsdom nor the end-to-end driver can hold it.
- ✅ **US-24 reduced motion**, asserted on both branches of the media query.
- ✅ **US-23 theme switching without a reload**, asserted end to end by a value parked on `window`.
- ✅ **V-1**, the dark titlebar under the light theme, open since M3. `window_set_theme` takes a
  `ResolvedTheme` that cannot carry "system".
- ✅ **Target sizes.** Two controls were under 24 px — the board tab's actions button at 20×20 and
  the board filter at 18 px tall. Both raised.
- ✅ **900 / 1280 / 1920 genuinely inspected** — for the first time. The suite had been resizing in
  physical pixels on a 2× display, so every width it named was half of it and the "900 px" narrow
  window was really 450. `setViewportWidth()` converts and then proves the viewport landed. See the
  decision log; this is also what the failing overflow assertion below turned out to be.
- ✅ **The keyboard pass, asserted structurally after the cause of the gap was measured.** A
  `keydown` listener on a focused button *does* see `Enter` arrive, so events reach the DOM —
  WKWebView simply performs no default action for a synthetic key, and focus navigation is `Tab`'s
  default action. Confirmed identically across `browser.keys`, `performActions` and
  `elementSendKeys`. So the walk is replaced by an assertion that no positive `tabindex` exists,
  nothing interactive is stranded at `-1` outside a composite, and each composite offers exactly one
  entry point — with no positive `tabindex`, tab order *is* document order. It found the tablist
  defect below on its first run.
- ✅ **The greyscale pass.** `src/features/board/greyscale.test.ts` asserts priority carries a
  distinct glyph *and* distinct words per level, that due-date states are distinct sentences, and —
  the assertion that gives the others teeth — that two priority levels **share a tone**, so colour
  genuinely cannot read the scale. `visual.e2e.ts` photographs a real board under
  `filter: grayscale(1)` as the evidence they render together.
- ✅ **The empty date field**, carried over from M6. WebKit greys today's date inside an empty
  `input[type=date]`, so "no due date" looked like "due today"; the field now says which it is.
- ✅ **The board tablist has one tab stop.** It had three — the tab, a hover-revealed per-board
  actions menu, and "New board". Restructured so the tablist holds only tabs; board actions are now
  one permanently visible control acting on the open board.

Gate green: 265 component tests (up from 228), 207 Rust tests (up from 204), `npm run verify` clean.
End-to-end: **77 specs, all passing**, at the real widths.

**The failing narrow-window assertion is resolved, and it was not a layout defect.** The suite was
resizing in physical pixels against a CSS-pixel layout on a 2× display, so *stays usable in a narrow
window* had been testing 450 px, not 900. At 450 px the filter bar's facet buttons really do
overhang — and 450 px is half the minimum product-spec §6 supports. At a true 900 px nothing
overflows and the board scrolls inside itself as designed.

The hypothesis recorded here previously — the board tab's actions button, raised to 24 px for
SC 2.5.8, pushing the document — was **wrong**. It was reasoned from the diff rather than measured.
Replacing the boolean assertion with one that names the overhanging boxes identified the real
elements on the first run, and the geometry it printed alongside them is what exposed the pixel-ratio
problem underneath. Recorded because the lesson is the cheaper one: a layout assertion should say
*which box*.

`detail.e2e.ts` › *returns focus to the card it opened from*, noted here as an unexplained
intermittent, passed again on the full run. Still unexplained, still watched.

## M9 — Import/export, backup/restore, recovery

**Delivers:** the data-safety features.

Acceptance criteria: US-25, US-26, ADR-0003, ADR-0006. Invalid import writes nothing and lists
issues by JSON path. Older-version fixture imports correctly. Newer version is refused. Replace
mode backs up first. Restore backs up the current database first and rolls back automatically if
the restored file fails to open.

Acceptance criteria, met on 2026-07-30 except where noted:

- ✅ **US-25 export.** Everything or one project, archived records included, pretty-printed so the
  file is readable and diffable. The single-project fixture has *two* projects, because a
  one-project fixture cannot fail a scoping bug, and the test asserts every exported row carries the
  right project rather than counting them.
- ✅ **Validation before any write.** Pure, SQLite-free, and collects **every** problem with its JSON
  path (`data.tasks[3].columnId`) rather than stopping at the first — asserted by a test that breaks
  four things and expects four issues. `AppError::ImportInvalid` carries the list; the panel shows
  it on screen, where a toast could not.
- ✅ **An invalid document writes nothing**, asserted in *replace* mode against a populated database,
  which is also the assertion that validation runs before the delete rather than after it.
- ✅ **One transaction.** A duplicate task number trips the unique index part-way through and the
  test asserts projects, tasks and columns are all back to zero.
- ✅ **US-25 merge and replace.** Merge allocates fresh ids and overwrites nothing; importing the same
  file twice creates two copies, which is ADR-0006's stated decision and has a test named for it.
  Replace takes a `pre-import` backup first and requires the word typed.
- ✅ **US-26 backups.** Listing newest-first, retention pruning that keeps ten automatic snapshots and
  **never** touches a manual one, and restore that snapshots the current database first, refuses a
  file that is not a database before moving anything, and puts the previous one back if the restored
  file fails to open.
- ✅ **Pre-delete backups**, since project deletion is the one destructive action undo cannot reach.
- ✅ **The panel**: scope picker, dry-run summary in words, the issue list, and the typed replace gate.
- ✅ **A fixture for every released version.** `tests/fixtures/exports/v1.json` is checked in and
  imported by a test that asserts the values a careless upgrade function would quietly drop — a due
  date, an estimate, a WIP limit, a `done` flag, an archived timestamp and a saved filter's JSON —
  rather than counting rows. A third test fails if `CURRENT_EXPORT_VERSION` is raised without a
  matching fixture, so ADR-0006's "kept forever" promise is enforced rather than remembered.
- ✅ **Recovery lists the backups.** `backups_list` deliberately does *not* require a working
  database: needing one in order to be told where your backups are is exactly backwards. The state
  now carries the database path through a failed start, and the recovery screen shows every snapshot
  with its path, size and whether the user took it.
- ⚠️ **Restoring from the recovery screen is not offered**, only locating. Restoring needs a live
  connection to snapshot the database it is replacing, and in that state there is none. The by-hand
  procedure is documented and the paths are on screen, selectable.
- ⛔ **Not covered end to end:** the system save and open dialogs — native windows outside the
  WebDriver session. Everything either side of them is.

Gate green: 278 component tests (up from 265), 265 Rust tests (up from 207), `npm run verify` clean.
End-to-end: **84 specs, all passing**, including a real export-to-disk and re-import round trip.

**The file dialogs are not driven, and the round-trip spec says so.** They are native windows outside
the WebDriver session — the same gap `docs/testing.md` records for the file picker — so
`transfer.e2e.ts` calls the commands with a path directly, through `window.__TAURI_INTERNALS__`.
What that still proves is that a real database exports to a real file, that the file is refused when
malformed, and that it imports back into a running application and reaches the board.

## M10 — Testing, performance, packaging, documentation

**Delivers:** a shippable application.

Acceptance criteria:
- Every performance target in product-spec §9 measured and recorded with its actual number.
- Full E2E suite green against the real app (ADR-0008), including restart-and-persist.
- `npm run tauri build` produces an installable bundle; the packaged app is launched from Finder with
  the dev server stopped and network disabled, and the core workflow completed by hand.
- Release build asserted **not** to contain the WebDriver permission.
- No console errors during primary workflows.
- Every visual state in `docs/visual-review.md` inspected and corrected.
- All documentation deliverables complete, including an honest "Known limitations".

**In progress on 2026-07-30.** What is done and what is not:

- ✅ **Performance measured and recorded** in product-spec §9 with actual numbers, each the fastest
  of five runs and each printed under `--nocapture`. Board load with 500 tasks across 6 columns:
  **5.9 ms** against 200. Task move committed: **19.5 ms** against 50. Search over 5,000: **8.9 ms**
  against 100. One board out of a 5,000-task, 20-project database: **3.3 ms**.
  The measurement method is the finding: a single sample timed the move at 9.6 ms alone and 81 ms —
  past budget — while 260 other tests ran beside it. Taking the minimum measures the operation
  rather than the scheduler, and the comment in the file says so.
- ⚠️ **Cold launch is not measurable on this harness**, and is recorded as such rather than
  reported. The document is ready in 71 ms; the board's own `performance.mark` reads ~6900 ms,
  almost all of which is the two five-second window probes the driver performs after a session
  reload. It cannot be measured without a reload either — one application instance outlives the
  whole run, so the only genuine launch happens against an empty database where no board renders.
  The mark now exists in the application, so a release build can be timed by hand with it.
- ✅ **Full end-to-end suite green**: 86 specs, including restart-and-persist and the export round
  trip.
- ✅ **`npm run tauri build` produces `Atticus_0.1.0_aarch64.dmg`** from a 6.9 MB
  binary. `.dmg` only: the `.app` is an intermediate a disk image is made from, and Tauri removes it
  afterwards, so installing leaves one copy of the application rather than two. `release:check`
  fails if a stale `.app` is left behind.
- ✅ **The release binary is asserted clean of the WebDriver server**, against the *artifact* rather
  than the manifest — `npm run release:check`. Four candidate markers were tried and only two
  actually appear in a WebDriver build, so the other two would have been a check of nothing;
  `npm run release:check:markers` re-runs that verification, so the list cannot rot unnoticed.
- ✅ **No console output during the primary workflow**, asserted end to end by a collector installed
  before the workflow runs and covering `console.error`, `console.warn`, uncaught errors and
  unhandled rejections.
- ⛔ **Not done, and not doable here:** launching the packaged app from Finder with the dev server
  stopped and network disabled, and completing the core workflow by hand. That is a person's job,
  not a command's, and claiming it without doing it would be the one dishonesty this plan exists to
  prevent. It blocks release criteria 4 and 5, and it is the only thing that does.
- ✅ **Typing in the editor re-renders no card.** 43 characters, **0 card renders** on a six-card
  board (`src/features/board/rerender.test.tsx`). Counted by mocking `TaskCard` with a wrapper that
  increments and delegates to the real component: a `<Profiler>` cannot answer this alone, because
  the editor is in the same React tree and a commit for the dialog fires the profiler for the whole
  subtree. A second test asserts the counter *does* rise when the board data changes — without it, a
  mock that never wired up would make the zero pass for the wrong reason.
- ✅ **A migration from a prior-schema fixture.** A database is opened at the real released schema 1,
  populated through the ordinary commands, then reopened against a migration list with a second,
  additive migration. The version advances, every row and child row survives, the added column is
  queryable, and a `pre-migration-1` snapshot was taken first.
- ✅ **The §Visual reference is fixed.** Release criterion 7 pointed at a section of
  `docs/testing.md` that does not exist; the visual states live in `docs/visual-review.md`, which is
  where both the criterion and the milestone now point.

---

## Reporting

At the end of each milestone: what changed, why, files affected, the exact verification commands
run with their observed results, and remaining risks. A check is reported as passing only if it was
run and observed to pass.
