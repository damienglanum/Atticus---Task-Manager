# Keyboard

Everything the board can do, it can do without a mouse. Where a keyboard route
exists it is listed here; where one does not yet exist, that is said plainly
rather than left to be discovered.

## Moving a task

Three routes, all landing in the same command. None of them is a fallback for
the others — the menu is the fastest way to send a task across the board, and
drag is the fastest way to nudge one within a column.

| Action | Keys |
| --- | --- |
| Focus a task card | `Tab` / `Shift`+`Tab` |
| Open the focused task | `Enter` |
| Pick a task up | `Space` or `Enter` on its grip handle |
| Move it while held | Arrow keys |
| Drop it | `Space` or `Enter` |
| Abandon the drag, leaving the task untouched | `Escape` |
| Open a task's actions | `Enter` on its **⋯** button |
| Move up / down one place | Actions menu → **Move up** / **Move down** |
| Send to another column | Actions menu → the column's name |

A cancelled drag writes nothing at all — not a move that is then reversed, but no
command in the first place.

Screen readers get board vocabulary rather than dnd-kit's defaults: *"Picked up
Write the release notes, position 2 of 5 in Todo"*, and on drop *"Dropped Write
the release notes at position 1 of 3 in In Progress"*. Positions are announced as
"2 of 5", never as an array index.

## Anywhere

| Action | Keys |
| --- | --- |
| Search and commands | `⌘K` — works while typing, so it is reachable from any field |
| Undo the last action | `⌘Z` — **not** while typing, where it means undo the typing |

Inside the palette: type to search every project, arrow keys to move, `Enter` to
open, `Escape` to close. `Home` and `End` jump to the ends of the list.

## In the task editor

| Action | Keys |
| --- | --- |
| Save | Nothing — every field writes on its own, and again when the editor closes |
| Add another subtask | `Enter` in the "Add a subtask" field |
| Toggle a subtask | `Space` on its checkbox |
| Switch the description between editing and reading | `Enter` on the pencil / eye button |
| Close, saving anything mid-edit | `Escape` |

## Elsewhere

| Action | Keys |
| --- | --- |
| Close a dialog, popover or menu | `Escape` |
| Move between menu items | Arrow keys |
| Choose a menu item | `Enter` |
| Confirm a dialog | `Enter` while its primary button has focus |
| Leave the quick composer | `Escape` — focus returns to the button that opened it |
| Add another task without leaving the composer | `Enter` |
| A line break inside a task title | `Shift`+`Enter` |

Dialogs trap focus while open and return it to whatever opened them, which is the
W3C APG modal pattern; it is implemented once, in `components/ui/Dialog.tsx`, so
every dialog behaves the same way.

## Not yet

Honest list, kept current:

- **Columns are reordered from their menu**, not by dragging and not by a
  shortcut.
- **No shortcut to jump between columns or projects.** The palette can open any
  task, which switches project and board as a side effect, but there is no
  "go to project" command yet.
- **Filters have no keyboard shortcut**; they are reached by tabbing to the
  filter bar.
