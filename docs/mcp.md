# AI access through MCP

Atticus contains a local Model Context Protocol server. It is the same executable as the desktop
application, launched with `--mcp`, and communicates only over stdin/stdout. It opens the same
SQLite profile as the app; there is no account, cloud service, HTTP listener, or second install.

## Enable and connect

1. Open **Settings → AI access** in Atticus.
2. Choose **Read only** or **Read & write**. Access is off by default.
3. Copy the command and argument displayed in that view into the local/stdio MCP server settings
   of Codex, Claude, or another MCP client. Name the server `atticus`.

The generic client configuration is:

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

During development, an isolated profile can be selected without touching normal data:

```text
command: /absolute/path/to/src-tauri/target/debug/Atticus
args: --mcp --data-dir /absolute/path/to/test-profile
```

The existing `TAKENKANBAN_DATA_DIR` override works too.

## Permissions

- **Off**: only the connection diagnostic and workflow guide are available.
- **Read only**: projects, boards, columns, tasks, focus-mode details, and search can be read.
- **Read & write**: the AI can create and update projects, boards, columns, tasks, subtasks, labels,
  links, and move tasks—but only inside its isolated **AI Boards** section. Delete and archive
  tools are deliberately not exposed.
- **File references**: separate opt-in. A referenced file must exist beneath the task project's
  configured folder. The server stores the path; it never reads or uploads the file.

The server reads the policy before every tool call, so changing it applies without reconnecting.

### AI Boards is a hard write boundary

`atticus_create_project` creates a persistently marked AI-managed project. Those projects and all
of their boards appear in the collapsible **AI Boards** sidebar section instead of **My Projects**.
Only resources descended from that marker pass the MCP server's mutation checks. Knowing the ID of
a user project, board, column, task, or subtask does not grant write access; the call is rejected
before the normal database mutation runs.

Existing projects receive no marker during migration, so upgrading protects all existing work by
default. Projects created in the normal Atticus interface are also unmarked and protected. An
imported project is treated as user-owned unless it was restored as part of a complete database
backup that already contained the ownership marker. The user can still inspect, rename, archive,
or delete AI work in the app; this boundary restricts the MCP client, not the owner of the data.

Treat everything placed inside an AI-managed project as AI-writable. The boundary is at the project
level so boards, labels, and tasks cannot accidentally acquire mismatched permissions.

## Attached workflow rules

MCP initialization includes instructions that tell the AI to inspect before writing, avoid
duplicates, move accepted work to **In Progress** only when work begins, keep the task description
and focus-mode details current, and use **Done** only after implementation and verification
succeed. `atticus_workflow_guide` returns the complete version of those rules.

Status movement is conservative. Standard names and a small set of unambiguous synonyms are
recognised; a custom board with no clear match produces an error listing its columns and requires
an explicit column ID. The server never guesses by column position.

## What “automatic” means

The MCP server is passive: it safely performs calls but does not run an AI by itself. While an AI
session is working, the attached instructions teach the client to keep the Atticus task updated.
Work that must continue after the session closes still needs a persistent agent or CI process that
connects to this MCP server.

Every successful external mutation increments a revision in the database. An open Atticus window
polls that small value and refreshes its local query cache, so AI changes appear without reopening
the board.

## Exposed tools

Read and guidance:

- `atticus_connection_status`
- `atticus_workflow_guide`
- `atticus_list_workspace`
- `atticus_get_board`
- `atticus_get_task`
- `atticus_search_tasks`

Create and update:

- `atticus_create_project`
- `atticus_create_board`
- `atticus_create_column`
- `atticus_create_task`
- `atticus_update_task`
- `atticus_move_task`
- `atticus_set_task_status`
- `atticus_add_subtask`
- `atticus_update_subtask`
- `atticus_create_label`
- `atticus_set_task_labels`
- `atticus_add_file`
- `atticus_add_link`

All argument schemas and safety notes are published through `tools/list`. Successful calls return
both human-readable JSON content and MCP structured content; expected validation and permission
failures return tool-level errors with an actionable message.
