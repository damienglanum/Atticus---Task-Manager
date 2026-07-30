# Product specification — Takenkanban v1.0

Status: **approved for implementation** (2026-07-30)
Owner: single user (local, offline)

---

## 1. Target user

One person — a developer running several personal software projects at once, on one Mac. They
context-switch between projects on a scale of days, not minutes, and lose the thread between
sessions. They already dislike web task managers for personal work because of accounts, latency,
and the feeling that the data is not theirs.

They are keyboard-fluent, comfortable with a terminal, and will use this application every day for
short bursts — a minute to capture a thought, ten minutes to plan an evening's work.

**Not the target user:** teams, clients, managers, anyone needing to share a board.

## 2. Primary jobs to be done

| # | Job | Success looks like |
|---|---|---|
| J1 | *When I return to a project after a week, I want to see its exact state without re-reading code* | The board answers "what's in flight, what's next" in under five seconds of looking |
| J2 | *When an idea or bug occurs to me mid-task, capture it without losing my place* | Capture completes in under three seconds and returns focus where it was |
| J3 | *Decide what to work on today across all projects* | One view, filterable by due date and priority, spanning projects |
| J4 | *Turn a vague intention into concrete next steps* | Subtasks, with visible progress on the card |
| J5 | *Keep the context with the task* | Markdown notes and references to real files in the repo |
| J6 | *Trust that this data is mine and will survive* | Plain SQLite on disk, documented location, working export and backup |

## 3. Non-goals

Explicit and permanent for v1:

- **No accounts, no cloud, no sync, no telemetry, no network calls of any kind at runtime.**
- **No collaboration:** no assignees, no comments, no mentions, no activity feed, no sharing,
  no "who changed what". A single-user application that displays these is lying to the user.
- No mobile or web deployment.
- No plugin system, no theming beyond light/dark, no custom fields.
- No AI features.
- No task dependencies or relations (deferred, see §11).
- No time-of-day on due dates (see §8.3 — this is a deliberate correctness decision, not laziness).
- No configurable "group by" for columns. Columns are real records, not a projection over a field.

## 4. Core workflows

**W1 — First run.** App opens with no projects. An empty state explains what a project is and
offers one action: create a project. Creating one seeds a board with five columns
(Backlog, Todo, In Progress, Blocked, Done) and opens it.

**W2 — Daily open.** App restores the last opened project and board. Board renders populated.

**W3 — Quick capture.** `C` (or `⌘N`) anywhere opens a single-line composer at the top of the
current column. Typing a title and pressing `Enter` creates the task and clears the field for the
next one. `Escape` closes and returns focus to the previously focused element.

**W4 — Detailed edit.** `Enter` on a focused card, or clicking it, opens the task editor. Title,
markdown description, priority, labels, due date, estimate, subtasks, file references. Changes
save on blur/debounce; the editor never has a "Save" button that can be forgotten.

**W5 — Move a task.** Three equivalent paths, all of which must work:
1. Pointer drag (dnd-kit).
2. Keyboard drag: focus card → `Space` → arrows → `Space` to drop, `Escape` to cancel.
3. Explicit command: `M` on a focused card, or the card's `⋯` menu → "Move to…", opens a picker of
   board → column → position. This path exists so drag is never the only way.

**W6 — Find.** `⌘K` opens the command palette: it searches tasks across all projects, and also
exposes commands (create project, toggle theme, export…). `/` focuses the board filter bar.

**W7 — Clear the board.** Completed work is archived, not deleted. Archived tasks are hidden by
default, reachable via a filter, and restorable to their original column.

**W8 — Safety.** Manual "Backup now" writes a timestamped copy. Export writes versioned JSON.
Both are reachable from one Settings screen that also displays the database path.

## 5. User stories and acceptance criteria

Notation: **AC** = acceptance criterion. Every AC is written so a test can assert it.

### Projects

**US-1** As a user, I create a project so I can separate my work.
- AC1 Name is required, 1–100 characters after trimming; whitespace-only is rejected with an inline message.
- AC2 Description optional, ≤2000 characters. Colour required, chosen from a fixed palette of 10.
- AC3 Optional local directory path; if set it must exist at creation time, else a warning is shown but creation proceeds.
- AC4 On creation a default board named "Board" is created with the five default columns, and the app navigates to it.
- AC5 Duplicate project names are permitted. No uniqueness constraint on any user-facing name.

**US-2** As a user, I archive a project I am not working on, and restore it later.
- AC1 Archiving is reversible and loses no data; archived projects appear in a separate "Archived" section of the switcher.
- AC2 An archived project's tasks are excluded from global search and cross-project views by default, and included when the "include archived" filter is on.
- AC3 Restoring returns the project to the active list with all boards, columns, tasks and their positions intact.

**US-3** As a user, I permanently delete a project.
- AC1 Requires a confirmation dialog that states the exact counts to be destroyed ("3 boards, 14 columns, 212 tasks").
- AC2 Requires typing the project name to confirm. This is the only action in the app with that requirement.
- AC3 Deletion is **not** undoable and the dialog says so. Deletion cascades to boards, columns, tasks, subtasks, task-label links and file references, in one transaction.
- AC4 Initial focus in the dialog is on Cancel, not Delete.

**US-4** As a user, the app remembers where I was.
- AC1 On launch, the last opened project and board are restored.
- AC2 If that project or board no longer exists, the app opens the most recently updated active project without an error dialog.

### Boards and columns

**US-5** As a user, I create multiple boards within a project.
- AC1 A project may have 1..n boards; the last board cannot be deleted.
- AC2 Boards are switchable from the board toolbar and their order is user-defined.

**US-6** As a user, I add, rename, reorder and delete columns.
- AC1 Column names 1–60 characters. Reordering persists and survives restart.
- AC2 Deleting an **empty** column asks for simple confirmation.
- AC3 Deleting a **non-empty** column requires choosing one of: move its tasks to another named column, or delete the tasks too. The task count is stated.
- AC4 Both variants of AC3 execute in one transaction and are undoable from the toast for the session.
- AC5 The last remaining column of a board cannot be deleted; the control is disabled with a tooltip explaining why.

**US-7** As a user, I set a WIP limit on a column.
- AC1 Limit is an optional positive integer.
- AC2 When count > limit the column header shows `6/5`, a warning icon, and a distinct border — three signals, at least one of which is not colour.
- AC3 The limit is **soft**: moving a task in is never blocked. Exceeding it announces "In Progress is over its limit, 6 of 5" to assistive technology.

**US-8** As a user, task order is stable.
- AC1 After any move, positions within a column are the dense sequence 0..n-1 with no duplicates and no gaps.
- AC2 The order shown after an application restart is byte-identical to the order before it.
- AC3 A rapid sequence of 50 moves leaves the database in the state implied by the last move, with no orphaned or duplicate positions.

### Tasks

**US-9** As a user, I capture a task in under three seconds.
- AC1 The quick composer creates a task from a title alone; all other fields default.
- AC2 `Enter` creates and keeps the composer open for the next one; `Escape` closes it and restores focus to the element focused before it opened.
- AC3 An empty or whitespace-only title does not create a task and does not show an error — it is a no-op.

**US-10** As a user, I edit a task's full detail.
- AC1 Fields: title (required, ≤500 chars), markdown description, column, priority, labels, due date, estimate, subtasks, file references.
- AC2 Edits persist without an explicit save action, debounced at 400 ms, and immediately on blur or close.
- AC3 `updated_at` changes on every persisted field change; `created_at` never changes.
- AC4 Markdown is rendered from a restricted set — no raw HTML, no scripts, no remote images. Links to `http(s)` open in the system browser via the opener plugin, never in the webview.

**US-11** As a user, I duplicate a task.
- AC1 Copies title (suffixed " (copy)"), description, priority, labels, due date, estimate and subtasks.
- AC2 Does **not** copy: the human-readable ID (a new one is allocated), timestamps, archived state.
- AC3 The duplicate is placed directly below the original.

**US-12** As a user, I archive and restore tasks.
- AC1 Archiving hides the task from the board and records `archived_at`.
- AC2 Restoring returns it to its original column, at the end of that column.
- ~~AC3 If the column no longer exists it goes to the board's first column and the user is told.~~
  **Withdrawn 2026-07-30, unreachable.** `tasks.column_id` is a foreign key and foreign keys are
  enforced on every connection, so a task can never point at a column that is gone. Deleting a
  column either deletes its tasks or moves them — archived ones included. Implementing this branch
  would mean shipping code that cannot run and cannot be tested. See `docs/decision-log.md`.

**US-13** As a user, I add subtasks.
- AC1 Subtasks have a title and a done flag, are ordered, and are reorderable.
- AC2 The card shows `2/5` when subtasks exist and nothing when they do not.
- AC3 Completing all subtasks does **not** automatically move or complete the parent. No hidden automation.

**US-14** As a user, I label tasks.
- AC1 Labels are per-project, with a name and a colour from a fixed palette.
- AC2 A task may have 0..n labels. The card shows up to 3 and then "+2".
- AC3 Deleting a label removes it from all tasks after confirmation stating the affected task count.
- AC4 Label colour is never the sole carrier of meaning; the name is always present or available via tooltip.

**US-15** As a user, I set a priority.
- AC1 Scale: None, Low, Medium, High, Urgent. Fixed, not user-editable.
- AC2 Rendered with a distinct **glyph** per level as well as colour, so it survives greyscale and colour-blindness.

**US-16** As a user, I set a due date and see what is overdue.
- AC1 States: no date, future, due within 3 days ("soon"), due today, overdue.
- AC2 Each state has a text label and an icon, not only a colour.
- AC3 "Today" is computed in the user's local timezone and re-evaluated when the app regains focus, so a board left open overnight is not stale.

**US-17** As a user, I reference local files from a task.
- AC1 A reference stores an absolute path, a display name, and the timestamp last verified.
- AC2 A reference whose file is missing renders in a clear "missing" state with the path shown and a "Locate…" action.
- AC3 Opening a reference reveals it in Finder or opens it in the default application. The webview never reads the file's contents.

**US-18** As a user, each task has a stable short ID.
- AC1 Format `<PREFIX>-<n>` where PREFIX is derived from the project name (3 uppercase letters, editable) and n is a per-project counter starting at 1.
- AC2 The counter never reuses a number, including after deletion.
- AC3 The ID is copyable from the task editor with one action.

### Productivity

**US-19** Global search. `⌘K` searches task titles and descriptions across all non-archived projects, ranked, with the project and board shown per result. Selecting a result opens that task.

**US-20** Filters. Filter by column, priority, label, due-date state, and archived state. Filters are per-board, persist across restarts, and are visibly indicated with a count and a one-click clear.

**US-21** Saved filters. A filter can be named and saved, then re-applied from the toolbar or the palette. Saved filters are per-project.

**US-22** Undo. Reversible actions — move task, archive/restore task, delete task, delete column, delete label — offer Undo in a toast and via `⌘Z` for the session. Undo is implemented as an explicit inverse operation applied in a transaction, not as a UI-state snapshot. Project deletion is **not** undoable and says so.

**US-23** Themes. Light, dark, and follow-system. Persisted. Switching does not reload or flash.

**US-24** Reduced motion. With `prefers-reduced-motion: reduce`, all non-essential transition and transform animation is removed; drag still functions and still gives non-animated feedback.

**US-25** Export / import. See §7.

**US-26** Backup / restore. See §7.

## 6. Edge cases — decided behaviour

Each of these has a decided outcome and a test.

| Case | Decided behaviour |
|---|---|
| Move first/last task within a column | No-op if the target position equals the current one; no write, no toast, no `updated_at` change |
| Move into an empty column | Task gets position 0; the empty-state placeholder is itself a valid drop target and is announced as one |
| Rapid reordering | Moves are serialised through a single-writer queue in the frontend; each is one transaction. The UI shows optimistic order and reconciles from the command result. A failed move rolls the UI back to the server's order and shows an error toast |
| Delete non-empty column | Blocked until the user chooses reassign-or-delete (US-6 AC3). One transaction. Undoable |
| Delete the last column | Not permitted; control disabled with an explanatory tooltip |
| Restore archived task whose column is gone | Cannot arise — see US-12 AC3, withdrawn. The foreign key makes it impossible |
| Duplicate titles | Fully permitted everywhere. No name is ever a key |
| Very long title | Validated to ≤500 chars with a live counter. Card clamps to 3 lines; full text available in the editor and as a `title` tooltip. No mid-word overflow |
| Very long description | Accepted. Card never renders the description. The editor warns above 100,000 characters that rendering may slow |
| 5,000 tasks | Board loads only its own board's tasks in one query. Cross-project views are query-limited and paged. See §9 |
| Missing file reference | Verified lazily on task open; missing files render distinctly and never throw |
| Invalid import file | Validated in full with Zod **before any write**. On failure, nothing is written and errors are listed with their JSON paths |
| Older export version | Upgraded through a chain of pure functions v1→v2→…→current. Each step is unit-tested against a fixture |
| Newer export version | Refused with a clear message naming both versions. Never partially imported |
| Migration failure | The database is copied to a timestamped backup **before** migrations run. Migrations run in a transaction; on failure it rolls back, the app shows a recovery screen naming the backup path, and does not start normally |
| Interrupted write | WAL journal mode plus `synchronous=FULL`. A crash or power loss may lose an uncommitted transaction; it can never corrupt the database or leave a half-applied move |
| Keyboard-only movement | Guaranteed by two independent mechanisms (US-5 W5 paths 2 and 3). Path 3 is tested with no pointer events at all |
| Narrow window | Supported down to 900×600. Below ~1100 px the project sidebar collapses to icons; below 900 px a horizontal scroll appears rather than columns becoming unusably narrow. Columns never shrink below 260 px |
| Timezone / DST | Due dates are **calendar dates**, stored as `YYYY-MM-DD` text, never as instants. There is no time-of-day, therefore no DST transition can move a due date. Timestamps (`created_at`/`updated_at`) are UTC epoch milliseconds and are never used for due-date logic |

## 7. Data portability

### 7.1 Export
- Format: JSON, UTF-8, `{ "exportVersion": 1, "generatedAt": "<ISO8601>", "app": "takenkanban", "appVersion": "x.y.z", "data": { … } }`.
- `exportVersion` is independent of the SQLite `schemaVersion` and of the app version. It changes only when the export shape changes.
- Scope: all projects, or one project. Includes archived records; excludes nothing.
- File references export as paths plus display names. Exports do **not** embed file contents.

### 7.2 Import
- Two modes: **merge** (new IDs allocated, nothing overwritten) and **replace** (existing data deleted first).
- Both present a dry-run summary — "will create 3 projects, 11 boards, 214 tasks" — before any write.
- Replace requires the same typed confirmation as project deletion and automatically takes a backup first.
- The entire import is one transaction.

### 7.3 Backup and restore
- "Backup now" copies the database (WAL-checkpointed first) to `backups/takenkanban-<ISO8601>.sqlite3` beside the database.
- An automatic backup is taken on launch when the schema version is about to change, and before any destructive bulk operation (replace-import, project delete).
- Rolling retention: the 10 most recent automatic backups are kept; manual backups are never auto-deleted.
- Restore lists available backups with size and date, requires confirmation, backs up the *current* database first, then swaps and restarts the connection.

## 8. Data-loss risks and mitigations

| Risk | Mitigation | Verified by |
|---|---|---|
| Failed migration leaves a half-upgraded DB | Pre-migration backup; migrations inside one transaction; recovery screen | Integration test that injects a failing migration |
| Destructive action taken by mistake | Confirmation dialogs; typed confirmation for project delete and replace-import; undo for everything else | Component + E2E tests |
| Import corrupts good data | Full validation before any write; single transaction; automatic pre-import backup | Integration test with a malformed fixture |
| Ordering corruption after many moves | `UNIQUE(column_id, position)` at the DB level; transactional reindex | Property-style test: 500 random moves, assert invariant each time |
| Silent write failure | Every command returns a typed `Result`; the UI surfaces errors as toasts and rolls back optimistic state. No `catch {}` that discards | Code review gate + test that a forced DB error surfaces |
| Power loss mid-write | WAL + `synchronous=FULL` | Documented; asserted via pragma read-back test |
| User cannot find their data | Database path shown in Settings with "Reveal in Finder"; documented in README | Manual check |

## 9. Performance targets

Measured on the development machine (Apple Silicon, macOS 26.6). These are the pass/fail numbers
for milestone 10.

| Metric | Target |
|---|---|
| Cold launch → interactive board | ≤ 1500 ms |
| Board render, 500 tasks across 6 columns | ≤ 200 ms to first paint of the board |
| Database queries per board load | **1** for the board's tasks (plus 1 each for labels and subtasks — 3 total, joined). **0 per card** |
| Typing in the task editor | 0 re-renders of any column or card component (asserted via React Profiler commit counts) |
| Global search, 5,000 tasks | ≤ 100 ms to results |
| Task move: drop → committed to SQLite | ≤ 50 ms |
| Total dataset supported | ≥ 5,000 tasks across ≥ 20 projects without target regression |

Virtualisation and memoisation beyond `React.memo` on the card will be introduced **only** if a
measurement shows a target is missed. Profiling precedes optimisation.

## 10. Accessibility requirements

Target: **WCAG 2.2 AA**.

- Every interactive control is reachable and operable by keyboard, in a logical order.
- Focus is always visible, with a token-defined ring that meets 3:1 against both adjacent colours,
  and is visually distinct from selection.
- Every control has an accessible name. Icon-only buttons carry both `aria-label` and a tooltip.
- Dialogs trap focus, restore it on close, close on Escape, and focus the least destructive control
  when destructive.
- Drag operations announce start, over, end and cancel through a live region using position-based
  wording ("position 2 of 5").
- Task movement is possible with **no pointer at all** via the explicit move command.
- Text contrast ≥ 4.5:1 (≥ 3:1 for ≥18.66px bold / 24px regular) in both themes. No decorative
  low-contrast text anywhere.
- Priority, due-date state, and WIP-limit breach each use a glyph or text in addition to colour.
- `prefers-reduced-motion: reduce` removes non-essential motion.
- Minimum target size 24×24 CSS px (WCAG 2.2 SC 2.5.8), with 32×32 for primary controls.

## 11. Deferred (explicitly out of v1)

Calendar view, list view, recurring tasks, time tracking, git integration, desktop notifications,
pomodoro timer, dependency graphs, cloud sync, multi-select, custom fields, task relations,
time-of-day on due dates, Windows/Linux verified builds.

Multi-select is deferred specifically because the brief permits it only if it can be implemented
coherently *and tested*; doing that well interacts with drag, keyboard move, and undo, and would
compromise the core board in v1.

## 12. Release definition — v1.0 is done when

1. All acceptance criteria in §5 pass, verified by automated tests where the AC is testable.
2. All ten milestones' acceptance criteria are met.
3. Every quality gate in `docs/testing.md` has been **run** and observed to pass, with the exact
   command and output recorded.
4. `npm run tauri build` produces a `.app` and `.dmg` that install and run with no dev server and
   no network.
5. Data survives quit-and-relaunch, verified end-to-end against the real packaged app.
6. Backup, restore, export, import, and a migration from a prior-schema fixture are all tested.
7. The interface has been visually inspected in every state listed in `docs/testing.md` §Visual.
8. `THIRD_PARTY_NOTICES.md` accounts for every dependency and every asset.
9. Known limitations are written down in `README.md` honestly, including anything that did not
   get finished.
