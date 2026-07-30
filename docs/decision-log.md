# Decision log

Short, dated decisions taken during implementation that are too small for an ADR but would
otherwise be invisible archaeology. Newest first.

---

## M9 — Import/export, backup/restore, recovery

**2026-07-30 · Export and import move files through Rust, not through the webview.**
The first shape returned the whole document to the frontend and took it back again for the apply —
two IPC crossings of a potentially large payload, and a webview holding the user's entire database
in a variable. Now the frontend passes a *path* chosen by the system dialog and Rust does the
reading and writing. The webview holds no filesystem permission (ADR-0007) and never sees the
document. `dialog:allow-save` is the one capability this milestone added.

**2026-07-30 · The import file is read twice, deliberately.**
`import_preview` and `import_apply` are separate commands, and nothing guarantees the file is
unchanged between them — so the apply re-reads and re-validates rather than trusting the plan the
user agreed to. The cost is one extra read of a local file; the alternative is applying a document
nobody previewed.

**2026-07-30 · `restore` takes the database, not a connection.**
The first version took `&Connection` for the safety snapshot and documented that the caller must
drop it before calling, because SQLite holds the file open. The first test that used it failed with
"database is locked" — a doc comment is not a mechanism. It now takes `&mut Database` and closes and
reopens it internally, so the footgun no longer exists. `Database::detach` swaps the live connection
for an in-memory placeholder to close it, which is also what makes the WAL sidecars safe to delete.

**2026-07-30 · Imported file references arrive unverified.**
`found` and `last_verified_at` are neither exported nor imported. They are facts about one machine's
filesystem at one past moment, and carrying them across is precisely how a missing file gets
displayed as present. An imported reference is checked when its task is next opened, like any other.

**2026-07-30 · Project deletion takes a snapshot, because it is the one thing undo cannot reach.**
ADR-0009 makes project deletion non-undoable and says so in its dialog. A `pre-delete` backup is
therefore taken in the command — after the project is known to exist, so a stale id does not litter
the folder with copies of a deletion that never happened.

**2026-07-30 · A backup's timestamp is read from its name, not its mtime.**
Copying or restoring a file rewrites its modification time, but the name still records when the
snapshot was taken. Parsing has to find the 13-digit millisecond component rather than the last
hyphen-separated one, because labels contain hyphens and digits (`pre-migration-3`) and a collision
suffix (`-1`) sits after the timestamp.

---

## M8 — Theme, accessibility, responsive, visual polish

**2026-07-30 · The board tablist had three tab stops, and the fix moved a feature.**
`role="tablist"` wrapped the tabs, a per-board actions menu revealed on hover, and "New board". A
tablist owns tabs and nothing else, so `Tab` landed inside it repeatedly instead of moving past it.
Found by the keyboard-order assertion below, on its first run — which is the argument for writing
that assertion at all.

"New board" simply moved out. The per-board menu was the real decision: keeping it inside the
tablist meant giving it `tabindex="-1"` and hiding the only pointer-free route to renaming a board
behind `Shift+F10`, which is standard but undiscoverable. It is now **one** menu, after the tablist,
acting on the board that is open. Renaming the board you are looking at is the whole of the use
case, and the control is now permanently visible and an ordinary tab stop rather than something that
appears when the mouse passes over it. The cost is that acting on a board you are not looking at
takes one extra click to select it first.

**2026-07-30 · Why the keyboard pass cannot be driven, measured rather than inferred.**
The earlier note said key events arrive without their default actions and that the behaviour was
"not stable enough between runs to assert either way". The second half was wrong and the first half
is now proven: a `keydown` listener on a focused button sees `Enter` arrive, so events do reach the
DOM, and focus does not move under `browser.keys`, `performActions` or `elementSendKeys` alike.
WKWebView does not perform default actions for synthetic keys; focus navigation is `Tab`'s default
action. One cause, three mechanisms, consistent.

What replaced the walk asserts the same property from the other end: no positive `tabindex`, nothing
interactive stranded at `-1` outside a composite, and exactly one entry point per composite. With no
positive `tabindex`, tab order *is* document order, so there is nothing left for a walk to discover.

**2026-07-30 · The empty due-date field says "No due date" rather than being replaced.**
WebKit draws today's date greyed inside an empty `input[type=date]` instead of a placeholder, so an
unset due date looked exactly like one set to today — the one pair of states this control must not
confuse. Noted in M6's visual review and deferred to here. The fix is words in the slot that already
existed under the field, which rendered nothing for the "none" state. Replacing the native control
would have cost a keyboard-accessible, locale-aware date picker to solve a labelling problem, and
product-spec §10 wants every state carrying words regardless.

**2026-07-30 · The greyscale pass is two tests, because a screenshot cannot fail.**
`design-decisions.md` §3 called greyscale "the test we actually run in milestone 8". A desaturated
screenshot shows the encodings surviving but goes green forever once someone deletes a glyph, so the
properties live in `src/features/board/greyscale.test.ts` and the picture is the evidence they are
rendered together. The load-bearing assertion is that **two priority levels share a tone** — if
every level had its own colour, the glyph tests would pass while proving nothing.

**2026-07-30 · The responsive suite had never tested a single one of its stated widths.**
`setWindowRect` on this driver is in **physical** pixels; layout is in CSS pixels; the display is
2×. So every width the visual review claimed to inspect was half of it. The "900 px narrow window"
laid out at 450 px, the "1280 px laptop" at 640, the "1680 px wide" at 840, and the 1920 px shot
added earlier in this milestone at 960. Measured across six widths from 900 to 3840 and linear
throughout, so the conversion is exact rather than approximate.

This is what the failing overflow assertion was really reporting. At 450 px the filter bar's facet
buttons genuinely do extend past the window — but 450 px is half the 900 px minimum product-spec §6
supports, so the interface was being failed for not doing something it never promised. The
hypothesis recorded here first — that the board tab's actions button, raised to 24 px for SC 2.5.8,
had pushed the document — was wrong, and it was wrong because it was reasoned from a diff instead of
measured. The diagnostic that settled it took one run and names the offending boxes.

`setViewportWidth()` now converts through `devicePixelRatio` and then **waits for the viewport to
actually read that width**, so a spec that says 900 gets 900 or fails saying what it got. All three
widths are reachable: the window may exceed the display, and 3840 physical on a 1920 physical screen
yields a true 1920 px viewport.

The assertion it replaced was a bare `expect(documentOverflows).toBe(false)`. It cost most of a
session, because "the document is wider than the window" does not name a single box. The
replacement lists the elements that overhang, skipping anything inside a horizontal scroller —
board content is *supposed* to extend past the viewport.

**2026-07-30 · The foreground ladder has two steps, not three.**
`--color-fg-tertiary` was Radix's step 10 and measured 3.33:1 at worst against our own surfaces —
below 4.5:1, and it was carrying the card metadata row, every empty state, every hint and every file
path: 58 call sites of ordinary content. Radix offers exactly two guaranteed accessible text steps,
11 and 12, so there was no third one to move to. The token is gone; what remains is
`--color-fg-muted`, which is the same step 10 restricted to the disabled and inactive states WCAG
2.2 SC 1.4.3 exempts, and a test that fails if anything else reaches for it. This is also what
`design-decisions.md` §3 asked for in the first place — the title at full contrast and everything
else one step down is two steps.

**2026-07-30 · The danger solid is a pinned hex rather than a Radix step.**
White on a fill has the same contrast in both themes, so the step has to be chosen once for both.
Red 9 — Radix's brand step, identical in light and dark for that same reason — measures 3.91:1
against white. The value is pinned to light-theme red 11, 5.21:1, matching white on the accent
solid exactly.

**2026-07-30 · The warning foreground differs by theme; the hue does not.**
Radix tunes step 11 with APCA, and the divergence from WCAG 2's ratio is widest in the bright
yellows: light amber 11 measured 4.05:1 on the sunken surface and 4.25:1 on its own tint. Light uses
amber 12, dark keeps amber 11 — dark amber 12 is a pale cream that stops reading as amber at all.
The cost is a browner warning in the light theme; the meaning was never carried by the colour alone,
so it survives.

**2026-07-30 · `outline-none` was silently removing the focus ring from every text field.**
Tailwind's utilities layer beats our `:focus-visible` rule in `@layer base` at equal specificity, so
`outline-none` on an input won. Focusing the estimate field, the label name, a subtask or the quick
composer showed nothing at all. Removed where nothing replaced it; where the ring belongs on the
wrapping box instead — the board filter and the command palette — it moved to `focus-within` on the
wrapper. Asserted end to end against the computed style, because a class name is exactly what was
lying.

**2026-07-30 · A menu row's highlight carries the ring too.**
`data-highlighted:bg-surface-sunken` against the menu surface measures 1.1:1 in the light theme,
which is a focus state one can fail to see. The row now draws the same ring as everything else,
inset. It follows the pointer as well as the keyboard because `data-highlighted` is Radix's single
notion of which row the menu is on, and splitting it would mean two ideas of what is focused.

**2026-07-30 · Control boundaries moved to step 10; container hairlines did not.**
SC 1.4.11 asks 3:1 of what identifies a control. An empty text field is identified by its border, so
inputs, secondary buttons and the checkbox now use `--color-border-strong` at rest — it was on
*hover*, which is no use to someone who has not hovered. Dialogs, menus and cards keep the lighter
hairline: their contents identify them, and raising every line in the interface to 3:1 would replace
the Ledger direction with a wireframe.

**2026-07-30 · V-1 is fixed by a command, and the frontend decides the theme.**
`window_set_theme` takes a `ResolvedTheme` — a type that cannot hold "system". The frontend has
already resolved the preference in order to set the document class, and resolving it a second time
in Rust is how the titlebar and the board come to disagree.

---

## M7 — Search, filters, palette, shortcuts

**2026-07-30 · `cmdk` was planned and not adopted.**
Its substantial contribution is fuzzy filtering, and this palette does not filter — search is FTS5
in SQLite, ranked by `bm25`. What would have been left is roving focus and a handful of ARIA
attributes, which is less code than the integration would have been. Built on the W3C APG
combobox-with-listbox pattern instead.

**2026-07-30 · What the user types never reaches FTS5.**
FTS5 has its own syntax, so a stray `"` is a syntax error rather than a search for a quote. Input is
split into word runs, each quoted, with a `*` on the last so results appear while typing. Four
tests cover the punctuation that would otherwise turn a keystroke into an error.

**2026-07-30 · Filtering happens in the frontend; search happens in SQLite.**
Different problems. A board is a bounded set already in memory, so filtering it is instant and needs
no round trip; search spans every project and belongs on an index.

**2026-07-30 · A stored filter that cannot be read shows everything.**
`parseFilter` drops values it does not recognise and falls back to no filter. The failure mode
matters: a filter written by a later version must never silently hide work, and a board that
refused to open over a stale preference would be a poor trade for type purity.

**2026-07-30 · `ui_state_*` is prefixed in Rust, not by convention.**
A generic key-value command exposed to the webview could otherwise overwrite `workspace` or `theme`
— state this application owns and relies on the shape of. Every key it writes goes under `ui:`, and
the prefix is applied in the command rather than trusted from the caller.

**2026-07-30 · `⌘K` fires while typing; `⌘Z` does not.**
"Search from anywhere" is the whole point of the first. Inside a text field the second means undo
the typing, and stealing it would be worse than not having it.

**2026-07-30 · Opening a menu sends Enter only if the click did not open it.**
The driver sometimes opens a Radix menu on click and sometimes only focuses the trigger. Sending
Enter unconditionally toggled it shut again, which showed up as a menu item that existed and then
did not — an hour of chasing a test failure that was entirely in the helper.

**2026-07-30 · `scrollIntoView` is stubbed in the test setup, not guarded in components.**
jsdom implements no layout and therefore no `scrollIntoView`. Writing `element.scrollIntoView?.()`
through the components would be shaping the application around a gap in the test environment.

---

## M6 — Task detail

**2026-07-30 · Autosave flushes *before* the dialog closes, not in an unmount cleanup.**
The obvious implementation — flush the pending debounce in a `useEffect` cleanup — looks right and
silently loses the last edit: a TanStack mutation dispatched from a component that is already
unmounting never reaches the backend. Closing the editor within 400 ms of typing therefore discarded
whatever had just been written. Fields now register a flush with the editor, which runs them all
before propagating the close. Found end to end; the component test that covers it now closes the
dialog rather than unmounting it, because unmounting is exactly the case that failed to catch it.

**2026-07-30 · `task_update` writes its result into the detail cache.**
Invalidating alone left the editor showing the previous text for the length of a refetch when it was
reopened — brief, but precisely the moment a user is checking whether their edit was kept. The
command already returns the updated task, so there is nothing to refetch.

**2026-07-30 · Markdown is rendered without `rehype-raw`, and a test enforces it.**
That single omission removes script injection, iframes and event handlers together. Remote images
render as their alt text — an `<img>` with a URL would turn opening a task into a network request
from an application whose whole promise is that it makes none. Links are allow-listed to
`http`/`https`/`mailto` in the webview *and* in the Tauri capability; a `javascript:` link is inert
text.

**2026-07-30 · Patch types are `#[ts(optional)]`.**
`TaskPatch`'s doc comment said every field was optional while the generated TypeScript required all
of them as `T | null`. The comment was right and the type was wrong. All four patch types now
generate `field?: T`, so "absent means leave it alone" is expressible rather than merely described.

**2026-07-30 · The subtask form handles Enter itself.**
It relied on a form's implicit submission, which requires exactly one field and no submit button —
a rule easy to break later by adding a second control, and which did not fire under the test driver
at all. The quick composer already handled Enter explicitly; now both do.

**2026-07-30 · The card is a button; dragging moved to a grip. Reported by the user.**
The first version made the whole card dnd-kit's drag target, so clicking a card did nothing at all
and the only way into the editor was the actions menu — which nobody thinks to look in. I had
deferred a drag handle to M8 as an "interaction question"; it was not one, it was the feature being
unusable, and deferring it was the wrong call. The card is now a real `<button>` (click, and Enter
when focused) with the grip beside the menu carrying the drag listeners. Costs one tab stop per
card, buys back the obvious gesture.

**2026-07-30 · Closing the editor restores focus to the card. Found by a test that was written for
something else.**
Radix restores focus itself, but only while its dialog is still mounted, and this one is unmounted
the instant the editor closes — so focus landed on `<body>` and a keyboard user was dropped at the
top of the document. Restoring it explicitly is the W3C APG modal requirement.

**2026-07-30 · The window is sized and positioned from the monitor's work area at startup.**
Reported by the user twice: first that the board needed a horizontal scrollbar at the default size,
then that the window rendered partly off-screen. `"maximized": true` was the first attempt and
caused the second problem. The size now comes from `Monitor::work_area()` — what the OS says is
usable, menu bar and dock already excluded — capped at 2200 × 1400 so an ultrawide display does not
open a window with a metre of empty space in it. Position is computed arithmetically rather than
with `Window::center()`, which centres on the size the window had when it was called and therefore
put a 2200-wide window where a 1440-wide one belonged. Verified against the real display: x = 1460
on a 5120-wide screen, which is exactly centred.

**2026-07-30 · Columns share the available width instead of being fixed at 18rem.**
`flex-1` between `min-w-68` and `max-w-96`. A fixed width left a wide display mostly empty *and*
still scrolled; an unbounded one would make a two-column board absurd.

**2026-07-30 · The description textarea is not called "Description".**
The section is already named that, and two things with the same accessible name in one region is
ambiguous to a screen reader as well as to a test. It is "Edit description".

---

## M5 — Ordering and accessible movement

**2026-07-30 · The board grouped tasks by array order, not by position.**
`board_load` happens to return tasks already ordered, so grouping them in array order looked
correct — until an optimistic move rewrote `position` in place without moving anything in the
array. A within-column move then committed to the database and showed the *old* order, with a
"Moved a task" toast next to a board that had not changed. Found by the first end-to-end run of the
keyboard move; the fix is one `sort` and a comment saying why it is not redundant.

**2026-07-30 · Movement has three entry points and one implementation.**
Pointer drag, dnd-kit's keyboard drag, and the actions-menu commands all end in the same
`requestMove`, which is the only caller of `task_move`. That is what stops keyboard movement rotting
into a second-class parallel path — there is no parallel path to rot.

**2026-07-30 · The single-flight queue chains off settlement, not value.**
`tail.then(op, op)` rather than `tail.then(op)`: chaining off the value alone means one rejected
move poisons every later one, so a single transient failure would leave the board unreorderable for
the rest of the session. A test asserts the queue keeps going after a rejection.

**2026-07-30 · Pointer drag could not be tested end to end, and is reported as such.**
Established that `performActions` does reach the page — it opens the settings dialog — so this is
specifically dnd-kit's sensor not seeing the synthesised gesture. Tried both sensor configurations
and gestures from two steps to twelve. The failing test was removed rather than left red or quietly
marked pending, and the gap is written into the M5 criteria, `docs/testing.md` and the README.

**2026-07-30 · The reorder maths is a pure module with its own tests.**
`reorder.ts` is where the off-by-one lives — a drop index is computed from what the user sees and
has to agree exactly with what the backend does with it. Eighteen table-driven cases settle that
far more reliably than dragging things around by hand, and they run in milliseconds.

---

## M4 — Columns and task CRUD

**2026-07-30 · One ordering primitive, because three hand-rolled copies were all wrong.**
Restoring a deleted column, restoring a deleted task, and duplicating a task each opened a slot with
`UPDATE ... SET position = position + 1 WHERE position >= n`. That shift walks rows in an order
SQLite chooses and the unique index on `(parent, position)` is checked after every statement, so it
collides with itself the moment more than one row has to move. `duplicate` had exactly one task
below it in its first test and passed; with two it would have failed for every user. All three now
call `ordering::place_at`, which reuses the two-phase renumber that was already correct, and each
has a regression test with enough rows to have caught it.

**2026-07-30 · Deleting a column with "move the tasks" moves the archived ones too.**
`ids_in_order` only sees live tasks, so archived ones stayed pointing at the column and
`ON DELETE CASCADE` destroyed them — silently, in the branch the user chose specifically to keep
their work. Found by a test that tried to reach US-12 AC2's fallback and could not.

**2026-07-30 · US-12 AC2's fallback is unreachable, so there is no code for it.**
The spec anticipated restoring a task whose column had been deleted. It cannot happen:
`tasks.column_id` is a foreign key, foreign keys are enforced on every connection, and deleting a
column now either deletes its tasks or moves them, archived ones included. Defensive code for that
branch would be untestable and would never run, so `set_archived` restores to the task's own column
and nothing else. The spec is annotated rather than left to imply a feature that does not exist.

**2026-07-30 · The quick composer is not disabled while a task is being created.**
Disabling a focused element blurs it; the blur handler saw an empty box and closed the composer. So
"Enter creates and keeps the composer open for the next one" — US-9 AC2, the whole point of the
control — was broken on every single task. The component test missed it because a mocked handler
never flips `isPending`; the end-to-end test caught it on the first run against the real app.

**2026-07-30 · The task actions button is dimmed, not hidden.**
It was `opacity-0` until hover. That makes it non-existent for a touch user, discoverable only by
accident for a mouse user, and invisible to WebDriver's "is it displayed" check — three symptoms of
one mistake. Now `opacity-60`, full on hover or focus.

**2026-07-30 · Column reorder, task rename and the archive panel were added before calling M4 done.**
Each closed a gap that made the milestone incoherent rather than merely incomplete: columns could
not be reordered at all (US-6 AC1), `useUpdateTask` existed with nothing calling it, and — worst —
archiving was a one-way door. An archive with no route back is a delete that lies about what it did.
Column reorder is a keyboard-reachable menu command, which is what the accessibility requirements
want regardless of what M5's drag-and-drop adds later.

**2026-07-30 · The `<select>` in the delete-column dialog is not nested inside its radio's label.**
A form control inside a `<label>` makes clicks on it ambiguous. Diagnosed while chasing a test
failure that turned out to be a driver limitation instead — the nesting was still wrong, so it was
fixed, but it was not the cause. The controlled `<select>` was briefly changed to uncontrolled on
that same wrong hypothesis and has been changed back.

**2026-07-30 · The default window is 1440 × 900 and centred.**
1280 × 820 showed four columns and read as cramped on first open.

---

## M4b — End-to-end harness

**2026-07-30 · The e2e binary builds into `target/e2e`, not `target/debug`.**
The first version shared `target/debug/atticus` with `tauri dev` and `cargo build`. A
`tauri dev` running in another terminal rebuilt that path without the feature, between the moment
the WebDriver binary was built and the moment it was launched — so the probe found no listening port
and the plugin looked broken. It was not; the binary had been replaced. A separate target directory
also gives the two builds separate cargo locks, so they no longer block each other.

**2026-07-30 · `TAKENKANBAN_DATA_DIR` is a real feature, not test scaffolding.**
The suite needs the app to write somewhere other than the user's data. Rather than a test-only hook,
this is a documented environment variable that also serves a second profile or a portable install.
An empty value counts as unset — an unquoted shell variable expands to the current directory, which
is never what was meant.

**2026-07-30 · The isolation assertion reads the filesystem, not the app's own display of it.**
Reading the database path out of the diagnostics panel was tried first and is wrong twice: WebKit's
rendered-text extraction inserts the soft line breaks of a wrapped path, and a path containing a
space — `Application Support`, on this platform — cannot be reconstructed from rendered text at all.
Checking that the database file exists in the run's temp directory tests the same property without
depending on either.

**2026-07-30 · Dialogs are addressed by accessible name.**
`div[role="dialog"]` matched whichever dialog was open. A Settings dialog left behind by an earlier
spec satisfied "the project dialog closed", and the failure surfaced as a confusing timeout in an
unrelated test. `dialogNamed()` scopes by the title, which is also how a screen-reader user
distinguishes them.

**2026-07-30 · The suite pins the window once per session.**
Not a micro-optimisation: it took the run from over five minutes to about thirty seconds. See
ADR-0008's implementation notes for why the underlying probe cannot succeed here, and why satisfying
it would have meant putting test-tool concessions into shipped code.

**2026-07-30 · Two npm overrides, one accepted advisory.**
`serialize-javascript` forced to a patched major that Mocha's pin excludes; `@wdio/native-utils`
forced to the version `@wdio/tauri-service` actually calls into but does not pin. The
`brace-expansion` advisory is left open: 5.0.8 is the first patched release, and forcing it was
tried and broke ESLint. Recorded in `THIRD_PARTY_NOTICES.md` rather than silently carried.

---

## M3 — Projects and boards

**2026-07-30 · 64-bit integers are annotated `#[ts(type = "number")]`.**
ADR-0010 assumed `ts-rs` maps `i64`/`u64` to `number`. It maps them to `bigint`. `serde_json`
writes them as JSON numbers and Tauri's IPC delivers a JS `number`, so every timestamp and position
binding was a type that type-checked while being false about runtime — the exact drift that ADR
exists to prevent, arriving through the generator rather than by hand. Fixed at the Rust structs;
`scripts/check-bindings.mjs` now fails on any `bigint` in a generated file, and the resulting
`Number(...)` coercion in `DiagnosticsPanel` is gone. ADR-0010's consequences section is corrected
rather than quietly left wrong.

**2026-07-30 · Delete-blocked state is derived from the count query, not from `isPending`.**
`DeleteProjectDialog` re-enabled its confirm button when the cascade-count query *failed*, because
`isPending` goes false on error as well as on success — the dialog said deletion was blocked while
allowing it. Found by a component test written against the error path. The disabled state now
derives from having an actual count, so an unreachable count can only fail closed.

**2026-07-30 · Screenshots capture a `CGWindowID`, never a screen region.**
The first attempt cropped a fixed rectangle out of a full-screen capture. A second window drifted
over the app between two runs and the "app screenshot" contained unrelated content from the user's
desktop. Region capture is now not used at all: a small Swift helper resolves the app's own window
id and `screencapture -l` photographs that window alone, whatever is stacked above it. Method
recorded in `docs/visual-review.md`.

**2026-07-30 · The E2E harness moves from M10 to M4b.**
Not scope creep — a correction. `osascript` is refused Accessibility permission here (`-1719`), so
the native window can be photographed but not typed into, clicked, or resized. Every remaining
milestone makes interaction claims, and M5's central one is *move a task with no pointer events at
all*. Verifying that against jsdom and calling it done would be exactly the dishonesty the brief
forbids, so the harness is built before the risk lands rather than after.

**2026-07-30 · Light theme leaves the macOS titlebar dark (defect V-1).**
Found by looking at the rendered window, not by any test. Tauri applies the theme to the web
contents; the OS draws the titlebar from the *window's* theme, which stays at the system value.
Cause identified, fix (`window.set_theme()` on resolved-theme change) scheduled into M8 because it
needs a new command, a capability entry and a binding. Recorded so it cannot be quietly forgotten.

---

## M2 — Database, migrations, typed persistence

**2026-07-30 · FTS5 is available; the documented fallback is not needed.**
`db::tests::fts5_is_available_and_indexes_tasks` creates an external-content FTS5 table and matches
against it. It passes with `rusqlite`'s `bundled` feature, which compiles SQLite from source — so
the SQLite version and its compiled-in features are identical on every machine and cannot be
changed by an OS update. The `title_norm` + `LIKE` fallback in architecture §3.1 is therefore
**not implemented**, and the risk is closed rather than carried.

**2026-07-30 · A failed startup opens the window anyway.**
`AppState` is an enum: `Ready { database }` or `Failed { error }`. Every command returns the stored
error, and the UI renders a recovery screen naming the pre-migration backup. Refusing to launch
would be the worst possible response for someone whose data is at stake — they need the path, and
they need it on screen, not in a log they will never look at. `AppError` gained `Clone` for this.

**2026-07-30 · A poisoned mutex is recovered from, not propagated.**
If a command panics mid-transaction, SQLite rolls that transaction back and the connection stays
usable. Refusing to work for the rest of the session would turn one bug into a dead application.
The panic is still reported to the log; only the poisoning is ignored.

**2026-07-30 · `app_state` reads are total.**
A missing or unparseable preference falls back to the default and logs, rather than failing. A
corrupt theme setting must never be the reason someone cannot see their tasks. Tested by
`a_corrupt_value_yields_the_default_rather_than_failing_to_start`.

**2026-07-30 · The theme toggle is now real, ahead of its milestone.**
M1 deliberately shipped no toggle because there was nowhere to persist it. With `app_state` in
place the cost was a radio group and two commands, and it removes a documented gap — so it landed
here rather than waiting for M8. Built as a native `<fieldset>`/`<input type="radio">` group so
arrow-key navigation, roving tab order, and "2 of 3" announcements come from the platform instead
of being reimplemented with ARIA.

**2026-07-30 · `Database::open_with` takes the migration list as a parameter.**
Not test-only cruft: `open()` delegates to it, so the upgrade, failure, and refusal tests exercise
the exact code path production uses rather than a reimplementation of it. This is what let the
pre-migration backup be tested against a real file on disk.

**2026-07-30 · The table is `board_columns`, not `columns`.**
`columns` collides with SQLite's own vocabulary and makes every query harder to read. Renaming
after release would be a migration; renaming now is free.

---

## M1 — Repository, quality gates, desktop shell

**2026-07-30 · ESLint pinned to 9.x rather than 10.**
`eslint-plugin-jsx-a11y` 6.10.2 declares `eslint: ^3 … ^9`. Accessibility is a hard requirement of
this product, so the plugin wins and the major version waits. Revisit when jsx-a11y ships ESLint 10
support. Recorded in README known limitations.

**2026-07-30 · TypeScript pinned to 6.0.3 rather than 7.0.2.**
`typescript-eslint` 8.65.0 declares `typescript: >=4.8.4 <6.1.0`. Type-aware linting
(`strictTypeChecked`) catches a class of bug that plain linting cannot, and is worth more here than
being on the newest compiler. TypeScript 6 also deprecates `baseUrl`, so `paths` is used without it.

**2026-07-30 · `cargo` scripts `cd src-tauri` instead of using `--manifest-path`.**
Cargo discovers `.cargo/config.toml` relative to the **working directory**, not the manifest. With
`--manifest-path` from the repository root, `src-tauri/.cargo/config.toml` was silently ignored and
`ts-rs` wrote its bindings to `src-tauri/bindings/` instead of `src/lib/bindings/`. Found by
checking where the files actually landed rather than trusting the config.

**2026-07-30 · Bindings drift check is git-independent.**
`scripts/check-bindings.mjs` regenerates into a temp directory and compares file-by-file rather
than using `git diff --exit-code`. It therefore works in a fresh checkout, in CI, and before the
first commit exists.

**2026-07-30 · Commands are referenced by full module path in `generate_handler!`.**
`#[tauri::command]` generates sibling items that the macro resolves by path, so a flattening
`pub use commands::app_info::app_info;` breaks the build. `commands::mod` carries a comment saying
why it does not re-export.

**2026-07-30 · IPC failures are thrown as a real `Error` subclass.**
`ipc.ts` originally threw the bare serialised `AppError` object, which ESLint's `only-throw-error`
correctly flagged. Rather than suppress the rule, `IpcError extends Error` now carries the typed
payload in `.appError` — real stack traces, works with any generic error boundary, and `toAppError`
unwraps it. Error text moved to `lib/errors.ts` so it is unit-testable without rendering.

**2026-07-30 · Milestone 1 ships no theme toggle.**
The theme follows the system preference and nothing more. Persisting an explicit user choice needs
the `app_state` table, which arrives in M2. A toggle that forgot its setting on restart would be
exactly the kind of half-feature the brief forbids, so it is absent rather than fake.

**2026-07-30 · Native-window screenshots are unavailable in this environment.**
`screencapture` fails with "could not create image from display" — macOS Screen Recording
permission has not been granted to the calling process. Visual review of the web layer is done in a
browser against `localhost:1420`, which renders the same React tree but cannot exercise Tauri IPC
(commands correctly fail there, which is how the error state was verified). Reviewing the real
packaged window, required by M8 and M10, needs that permission granted first. Flagged rather than
worked around.
