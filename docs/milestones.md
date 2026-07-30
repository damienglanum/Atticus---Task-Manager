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

## M9 — Import/export, backup/restore, recovery

**Delivers:** the data-safety features.

Acceptance criteria: US-25, US-26, ADR-0003, ADR-0006. Invalid import writes nothing and lists
issues by JSON path. Older-version fixture imports correctly. Newer version is refused. Replace
mode backs up first. Restore backs up the current database first and rolls back automatically if
the restored file fails to open.

## M10 — Testing, performance, packaging, documentation

**Delivers:** a shippable application.

Acceptance criteria:
- Every performance target in product-spec §9 measured and recorded with its actual number.
- Full E2E suite green against the real app (ADR-0008), including restart-and-persist.
- `npm run tauri build` produces `.app` and `.dmg`; the packaged app is launched from Finder with
  the dev server stopped and network disabled, and the core workflow completed by hand.
- Release build asserted **not** to contain the WebDriver permission.
- No console errors during primary workflows.
- Every visual state in `docs/testing.md` §Visual inspected and corrected.
- All documentation deliverables complete, including an honest "Known limitations".

---

## Reporting

At the end of each milestone: what changed, why, files affected, the exact verification commands
run with their observed results, and remaining risks. A check is reported as passing only if it was
run and observed to pass.
