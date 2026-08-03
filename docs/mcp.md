# AI access through MCP

Atticus includes a local Model Context Protocol (MCP) server in the desktop application executable.
Launch the executable with `--mcp` and it communicates over stdin/stdout with the same SQLite profile
as the app. It opens no HTTP port, creates no cloud account, and does not send task, note, or file content to
an Atticus service.

The integration is designed for two equally valid uses:

- read-only assistants that inspect, search, summarize, and plan from the user's workspace;
- write-enabled assistants that manage work in a separate, visibly isolated **AI Boards** area.

Availability is never authorization. The initialization contract tells a connected model not to create
or change Atticus records unless the user asked to track/manage work there or the request clearly refers
to an existing Atticus task or project note.

## Enable and connect

1. Open **Settings → AI access** in Atticus.
2. Choose **Read only** or **Read & write**. Access is **Off** by default.
3. Copy the executable path and `--mcp` argument shown in that view into any local/stdio MCP client.
4. Name the server `atticus`.

Generic client configuration:

```json
{
  "mcpServers": {
    "atticus": {
      "command": "/absolute/path/shown/by/Atticus",
      "args": ["--mcp"]
    }
  }
}
```

During development, use a separate profile so protocol tests cannot touch normal data:

```text
command: /absolute/path/to/src-tauri/target/debug/Atticus
args: --mcp --data-dir /absolute/path/to/test-profile
```

`TAKENKANBAN_DATA_DIR` remains available as an alternative profile override.

To exercise the packaged protocol boundary against a fresh temporary profile:

```bash
npm run test:mcp-protocol
```

The command first builds the current debug executable, then performs a real stdio initialize handshake,
checks all 24 published tool contracts, including the exact note-tool catalog, and calls the
guidance/status/error paths. The Rust lifecycle test
covers the full read/write workflow.

## Permission model

The client can always discover the static tool catalog. The server re-reads the user's policy before
every call, so changes take effect without reconnecting.

| Mode | Callable operations |
| --- | --- |
| **Off** | `atticus_connection_status` and `atticus_workflow_guide`; other calls return a structured permission error. |
| **Read only** | The two guidance tools plus workspace, board, task, project-note, and search reads. Full note bodies are readable. Mutation calls return a structured permission error. |
| **Read & write** | Reads plus task and note mutations inside active MCP-created projects only. Delete, archive, restore, and removal tools are not exposed. |
| **File references enabled** | An additional opt-in layered on Read & write. The file must exist beneath the task project's configured folder. |

The connection diagnostic deliberately does not disclose the local database path. It reports the access
mode, file-reference permission, server version, workflow-guide version, and write-scope description.

### AI Boards is a database-enforced boundary

`atticus_create_project` creates a persistently marked MCP-managed project. These projects appear in the
collapsible **AI Boards** sidebar section. Only active resources descended from that marker pass mutation
checks. Knowing the ID of a user project, board, column, task, subtask, or note does not grant write access.

Existing and normally created projects have no marker and are protected by default. Their project notes are
readable when AI access is enabled, including full Markdown bodies, but remain write-protected. Archived
projects and tasks are also read-only through MCP. The owner can still
rename, archive, restore, or delete AI-managed work in the desktop app.

The boundary applies in database queries, not only in model instructions. The MCP server cannot broaden its
scope by guessing an ID, moving a managed task into a user board, or attaching a label from another project.

## Contract delivered to connected models

MCP initialization attaches the same canonical operating contract returned by
`atticus_workflow_guide`. It explains:

- when Atticus mutations are and are not authorized;
- the Project → Board → ordered Column → Task model and project-owned notes with optional task associations;
- how to discover opaque IDs and exact human task references such as `ATT-42`;
- the user-owned versus MCP-managed write boundary;
- duplicate prevention and non-idempotent retry recovery;
- replacement semantics, optimistic concurrency, and validation rules;
- task lifecycle guidance that works for software, research, writing, operations, and personal work;
- verified links and confined file references;
- unavailable destructive/removal operations;
- the fact that the server is passive and stops when its client session ends.

The guide is versioned in `atticus_connection_status`. The application version is published from the Cargo
package version rather than duplicated in the server implementation.

## Recommended model workflow

1. Call `atticus_connection_status` when access is uncertain.
2. Call `atticus_list_workspace`, then inspect a relevant board, task, or project note, or search with distinctive words.
3. Use a result's `writable` flag. Never infer ownership from a name or ID.
4. Reuse existing work. Create a project, board, task, note, label, or attachment only when needed and intended.
5. Read a task or note immediately before updating it or replacing an association set.
6. Pass its current `updatedAt` as `expected_updated_at`; reconcile and re-read after a conflict.
7. Use returned objects as authoritative for the next call.
8. If a non-idempotent call's outcome is unknown, inspect or search before retrying.
9. Report exactly what changed and any unresolved blocker.

For active work, move a task to `in_progress` only when work actually begins. A subtask is done only when
that item is complete. The parent moves to `done` only after the requested outcome and verification suitable
to the domain are complete. Otherwise it remains active/in review with the blocker recorded in Markdown.

## Data and input conventions

- IDs such as `task_id` are opaque strings returned by tools. A human reference such as `ATT-42` is accepted
  by search but is not interchangeable with an opaque task ID.
- Priority is `0` none, `1` low, `2` medium, `3` high, or `4` urgent.
- Due dates use the calendar format `YYYY-MM-DD`.
- Estimates are whole minutes from `1` to `20,160`.
- Descriptions are Markdown and are complete replacements when supplied to `atticus_update_task`.
- Note bodies are Markdown and are complete replacements when supplied to `atticus_update_note`.
- Omitted update fields are unchanged. Empty updates are rejected.
- `due_date` and `clear_due_date` are mutually exclusive; so are `estimate_minutes` and `clear_estimate`.
- `atticus_set_task_labels` replaces the complete unique label set. Merge current `labelIds` first; `[]`
  intentionally clears all labels.
- `task_ids` on `atticus_create_note` is the complete unique association set and defaults to none. On
  `atticus_update_note`, omission preserves current associations, while a supplied list replaces all of
  them and `[]` intentionally clears them. Every referenced task must exist in the note's project.
- Move positions are zero-based; omit `index` to append. Negative values are rejected.
- Label colors are `slate`, `indigo`, `blue`, `cyan`, `teal`, `grass`, `amber`, `orange`, `red`, or `plum`.
- Links must be complete `http://` or `https://` URLs and duplicate URLs are rejected.
- Unknown JSON properties are rejected, so a misspelled field cannot turn into a silent no-op.

These constraints appear in the JSON Schemas published through `tools/list` and are independently enforced
at runtime.

## Tool catalog

Every tool publishes a human title, an operational description, an input schema, an output schema, and MCP
annotations for read-only, destructive, idempotent, and open-world behavior.

### Guidance and reads

| Tool | Purpose |
| --- | --- |
| `atticus_connection_status` | Inspect current permission and contract/server versions, even while Off. |
| `atticus_workflow_guide` | Return the complete canonical connected-model contract. |
| `atticus_list_workspace` | List active projects, boards, and ordered columns; `project.mcpManaged` identifies owned scope. |
| `atticus_get_board` | Return project/board context, writable state, columns, live tasks, labels, and archive count. |
| `atticus_get_task` | Return the human reference, location, writable state, task fields, subtasks, labels, files, and links. |
| `atticus_search_tasks` | Resolve an exact task reference or search title/description words across active projects. |
| `atticus_list_notes` | List ordered note summaries and task associations for one project without returning full bodies. |
| `atticus_get_note` | Return one note's full Markdown body, task associations, timestamp, project context, and writable state. |
| `atticus_search_notes` | Search note titles/bodies globally or within one project and return bounded excerpts plus writable state. |

Search can return live or archived tasks and user-owned or MCP-managed tasks. `writable` is true only for a
live task in an active MCP-managed project. For text queries, all parsed words must match and only the last
word is prefix-matched. Punctuation-only/empty queries are rejected by the MCP adapter.

Note search matches title and Markdown body text. All parsed words must match and the final word is
prefix-matched. It accepts an optional exact `project_id`, defaults to 50 results, returns at most 100, and
exposes a bounded excerpt rather than the full body. Use `atticus_get_note` when full content is needed. A
note's `writable` value is true only while its project is active and MCP-managed.

### Mutations

| Tool | Effect and important semantics |
| --- | --- |
| `atticus_create_project` | Creates the only new MCP write scope, an initial Board, and five default columns. |
| `atticus_create_board` | Creates a board plus the five default columns in an active MCP-managed project. |
| `atticus_create_column` | Appends one custom column to an active MCP-managed board. |
| `atticus_create_task` | Appends a fully described task to a writable column and returns full task detail. |
| `atticus_update_task` | Patches fields with required `expected_updated_at`; description is replacement Markdown. |
| `atticus_move_task` | Moves/reorders a task within its current board using an exact column ID. |
| `atticus_set_task_status` | Appends to one unambiguous semantic workflow column; never guesses by position. |
| `atticus_add_subtask` | Appends a checklist item without moving or completing its parent. |
| `atticus_update_subtask` | Patches title/completion with required subtask `expected_updated_at`. |
| `atticus_create_label` | Creates one reusable project label; duplicate names are rejected. |
| `atticus_set_task_labels` | Replaces the full label set with required task `expected_updated_at`. |
| `atticus_add_file` | Stores one confined path reference after all filesystem and permission checks. |
| `atticus_add_link` | Stores one verified, non-duplicate web URL. |
| `atticus_create_note` | Creates a project note with a complete body and complete task association set in managed scope. |
| `atticus_update_note` | CAS-patches title/body and optionally replaces all task associations; `[]` clears them. |

Create/append calls are non-idempotent. Update, replacement, move, and status tools are marked destructive
because they can overwrite, clear, or reorder state even though entity deletion itself is unavailable.
Exact move and semantic-status calls are idempotent: repeating an already achieved placement writes nothing
and does not increment the external revision. Other mutations remain non-idempotent because they create,
replace, or refresh state.
All database-only tools are closed-world. The project-directory and file tools are marked open-world because
they consult the local filesystem.

## Structured results and errors

Successful calls return the same JSON as readable text and as MCP `structuredContent` for compatibility.
Each published `outputSchema` accepts both its successful data shape and the common structured execution-error
envelope, so strict clients can validate every structured result. Mutations return authoritative objects,
including current IDs and timestamps.

Expected failures use `isError: true` and retain the serialized `AppError` in structured content:

```json
{
  "error": {
    "kind": "conflict",
    "message": "Task … changed after it was read …"
  },
  "message": "Task … changed after it was read …",
  "retryableWithSameArguments": false,
  "mutationMayHaveCommitted": false,
  "recovery": "Read the current resource, reconcile the conflict, and retry only with current state."
}
```

Validation errors name their field. Not-found errors direct the model to refresh real IDs. Permission errors
direct it to stop and ask the user rather than loop. If an infrastructure failure might have happened after a
mutation, `mutationMayHaveCommitted` is true and the recovery text requires inspection before retrying.

## Common recipes

### Reuse existing work

1. List the workspace and search distinctive terms.
2. If the matching hit is writable and live, get the task and update it.
3. If it is user-owned, inspect/report only. If archived, tell the user it must be restored in Atticus.

### Create tracked work

1. Confirm the user intends Atticus tracking.
2. Reuse an existing MCP-managed project/board where appropriate.
3. Search for duplicates.
4. Use a real returned column ID with `atticus_create_task`.
5. Keep the returned task ID and `updatedAt`; do not derive either from its human reference.

### Record an outcome or blocker

1. Get the task immediately before editing.
2. Merge the current Markdown description with the useful outcome, decision, evidence, or blocker.
3. Call `atticus_update_task` with current `expected_updated_at`.
4. If it conflicts, get the task again and reconcile instead of resubmitting stale Markdown.

### Create or maintain long-form project context

1. Search notes with distinctive title/body terms, optionally constrained to the intended project.
2. Reuse a relevant note when possible; create one only inside an active MCP-managed project.
3. Get the note immediately before updating it and preserve useful Markdown context.
4. Treat `task_ids` as a full replacement when supplied: merge current IDs first, or use `[]` deliberately
   to clear all associations.
5. Pass the current note `updatedAt` as `expected_updated_at`; after a conflict, get and reconcile again.

MCP intentionally exposes no note-delete tool. Remove notes in the Atticus desktop app when necessary.

### Complete verified work

1. Complete only the subtasks actually finished.
2. Record the final outcome and suitable verification.
3. Move the task to `done` only if the requested outcome is complete; otherwise keep it active/in review.
4. Report the exact task reference and state returned by the server.

## File-reference safety

File attachment requires all of the following:

1. Read & write access.
2. Separate **Allow file references** permission.
3. A configured project folder.
4. A user-verified absolute path.
5. An existing regular file.
6. Canonical containment beneath the configured folder, including after resolving symlinks.

The server stores the canonical path and display metadata only. It does not read or upload file contents.
Duplicate references are rejected. There is no MCP removal tool; corrections are made by the user in Atticus.

## Passive operation and desktop refresh

The MCP server performs calls but does not run an AI, schedule work, or continue after the client disconnects.
Long-running automation still needs a persistent client or CI process that connects to the stdio server.

Every successful external mutation increments a revision in SQLite. An open Atticus window polls that small
value and invalidates its local query cache, so MCP changes appear without reopening the board.
