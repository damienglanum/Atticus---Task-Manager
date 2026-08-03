//! Persistent policy and change tracking for the local MCP integration.
//!
//! The MCP process opens the same SQLite file as the desktop application. Its
//! permissions therefore live in that file too: copying a profile copies its
//! policy, and changing a setting while a client is connected takes effect on
//! the next tool call without restarting either process.

use rmcp::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::app_state;
use crate::error::{AppError, AppResult};

const SETTINGS_KEY: &str = "mcp:settings";
const REVISION_KEY: &str = "mcp:external-revision";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "McpAccess.ts")]
pub enum McpAccess {
    #[default]
    Disabled,
    ReadOnly,
    ReadWrite,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "McpSettings.ts")]
pub struct McpSettings {
    pub access: McpAccess,
    // Even in read/write mode, attaching a path is a separate opt-in. The MCP
    // server additionally confines it to the task project's configured folder.
    pub allow_file_attachments: bool,
}

pub fn settings(conn: &rusqlite::Connection) -> AppResult<McpSettings> {
    app_state::get_or(conn, SETTINGS_KEY, McpSettings::default())
}

pub fn set_settings(conn: &rusqlite::Connection, settings: &McpSettings) -> AppResult<McpSettings> {
    app_state::set(conn, SETTINGS_KEY, settings)?;
    Ok(settings.clone())
}

/// A monotonically increasing signal written after an external mutation.
///
/// TanStack Query deliberately keeps local data fresh forever because normal
/// application writes invalidate their own queries. The MCP process is outside
/// that React tree, so the shell polls this cheap integer and invalidates when
/// it advances.
pub fn revision(conn: &rusqlite::Connection) -> AppResult<i64> {
    app_state::get_or(conn, REVISION_KEY, 0_i64)
}

pub fn record_external_change(conn: &rusqlite::Connection) -> AppResult<i64> {
    let next = revision(conn)?.saturating_add(1);
    app_state::set(conn, REVISION_KEY, &next)?;
    Ok(next)
}

/// Whether a project belongs to the MCP-only workspace.
///
/// Existing projects predate the boundary and have no row here, so an upgrade
/// grants the AI access to nothing. New access is only created atomically by
/// `projects::create_mcp`.
pub fn is_managed_project(conn: &rusqlite::Connection, project_id: &str) -> AppResult<bool> {
    let found: i64 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM mcp_managed_projects WHERE project_id = ?1)",
        [project_id],
        |row| row.get(0),
    )?;
    Ok(found != 0)
}

pub fn require_managed_project(conn: &rusqlite::Connection, project_id: &str) -> AppResult<()> {
    require_managed(
        conn,
        "project",
        project_id,
        "SELECT EXISTS(SELECT 1 FROM mcp_managed_projects WHERE project_id = ?1)",
    )
}

pub fn require_active_managed_project(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> AppResult<()> {
    require_managed_project(conn, project_id)?;
    let project = crate::db::projects::find(conn, project_id)?;
    if project.archived_at.is_some() {
        return Err(AppError::Conflict {
            message: "Archived projects are read-only through MCP. Restore this project in Atticus before changing it."
                .to_owned(),
        });
    }
    Ok(())
}

pub fn require_managed_board(conn: &rusqlite::Connection, board_id: &str) -> AppResult<()> {
    require_managed(
        conn,
        "board",
        board_id,
        "SELECT EXISTS(\
           SELECT 1 FROM boards b \
           JOIN mcp_managed_projects m ON m.project_id = b.project_id \
           WHERE b.id = ?1\
         )",
    )
}

pub fn require_active_managed_board(conn: &rusqlite::Connection, board_id: &str) -> AppResult<()> {
    require_managed_board(conn, board_id)?;
    let board = crate::db::boards::find(conn, board_id)?;
    require_active_managed_project(conn, &board.project_id)
}

pub fn require_managed_column(conn: &rusqlite::Connection, column_id: &str) -> AppResult<()> {
    require_managed(
        conn,
        "column",
        column_id,
        "SELECT EXISTS(\
           SELECT 1 FROM board_columns c \
           JOIN boards b ON b.id = c.board_id \
           JOIN mcp_managed_projects m ON m.project_id = b.project_id \
           WHERE c.id = ?1\
         )",
    )
}

pub fn require_active_managed_column(
    conn: &rusqlite::Connection,
    column_id: &str,
) -> AppResult<()> {
    require_managed_column(conn, column_id)?;
    let column = crate::db::columns::find(conn, column_id)?;
    require_active_managed_board(conn, &column.board_id)
}

pub fn require_managed_task(conn: &rusqlite::Connection, task_id: &str) -> AppResult<()> {
    require_managed(
        conn,
        "task",
        task_id,
        "SELECT EXISTS(\
           SELECT 1 FROM tasks t \
           JOIN mcp_managed_projects m ON m.project_id = t.project_id \
           WHERE t.id = ?1\
         )",
    )
}

pub fn require_live_managed_task(conn: &rusqlite::Connection, task_id: &str) -> AppResult<()> {
    require_managed_task(conn, task_id)?;
    let task = crate::db::tasks::find(conn, task_id)?;
    require_active_managed_project(conn, &task.project_id)?;
    if task.archived_at.is_some() {
        return Err(AppError::Conflict {
            message: "Archived tasks are read-only through MCP. Restore this task in Atticus before changing it."
                .to_owned(),
        });
    }
    Ok(())
}

pub fn require_managed_subtask(conn: &rusqlite::Connection, subtask_id: &str) -> AppResult<()> {
    require_managed(
        conn,
        "subtask",
        subtask_id,
        "SELECT EXISTS(\
           SELECT 1 FROM subtasks s \
           JOIN tasks t ON t.id = s.task_id \
           JOIN mcp_managed_projects m ON m.project_id = t.project_id \
           WHERE s.id = ?1\
         )",
    )
}

pub fn require_live_managed_subtask(
    conn: &rusqlite::Connection,
    subtask_id: &str,
) -> AppResult<()> {
    require_managed_subtask(conn, subtask_id)?;
    let subtask = crate::db::subtasks::find(conn, subtask_id)?;
    require_live_managed_task(conn, &subtask.task_id)
}

pub fn require_managed_note(conn: &rusqlite::Connection, note_id: &str) -> AppResult<()> {
    require_managed(
        conn,
        "note",
        note_id,
        "SELECT EXISTS(\
           SELECT 1 FROM notes n \
           JOIN mcp_managed_projects m ON m.project_id = n.project_id \
           WHERE n.id = ?1\
         )",
    )
}

pub fn require_active_managed_note(conn: &rusqlite::Connection, note_id: &str) -> AppResult<()> {
    require_managed_note(conn, note_id)?;
    let note = crate::db::notes::find(conn, note_id)?;
    require_active_managed_project(conn, &note.project_id)
}

fn require_managed(
    conn: &rusqlite::Connection,
    entity: &str,
    id: &str,
    sql: &str,
) -> AppResult<()> {
    let allowed: i64 = conn.query_row(sql, [id], |row| row.get(0))?;
    if allowed != 0 {
        return Ok(());
    }

    Err(AppError::Conflict {
        message: format!(
            "MCP cannot modify this {entity}. It is outside the isolated AI Boards section. \
             Create or choose an AI-managed board instead."
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::columns;
    use crate::db::notes;
    use crate::db::projects::{self, NewProject};
    use crate::db::subtasks;
    use crate::db::tasks::{self, NewTask};
    use crate::db::Database;

    fn project_input(name: &str) -> NewProject {
        NewProject {
            name: name.to_owned(),
            description: String::new(),
            color: "blue".to_owned(),
            key_prefix: None,
            directory_path: None,
        }
    }

    #[test]
    fn access_is_disabled_until_the_user_enables_it() {
        let database = Database::open_in_memory().expect("database opens");
        assert_eq!(
            settings(database.connection()).expect("settings read"),
            McpSettings::default()
        );
    }

    #[test]
    fn settings_and_external_revision_persist() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join(crate::db::DATABASE_FILE_NAME);

        {
            let database = Database::open(&path).expect("database opens");
            set_settings(
                database.connection(),
                &McpSettings {
                    access: McpAccess::ReadWrite,
                    allow_file_attachments: true,
                },
            )
            .expect("settings save");
            assert_eq!(
                record_external_change(database.connection()).expect("revision increments"),
                1
            );
        }

        let reopened = Database::open(&path).expect("database reopens");
        assert_eq!(
            settings(reopened.connection()).expect("settings read"),
            McpSettings {
                access: McpAccess::ReadWrite,
                allow_file_attachments: true,
            }
        );
        assert_eq!(revision(reopened.connection()).expect("revision reads"), 1);
    }

    #[test]
    fn only_mcp_created_projects_and_their_descendants_are_writable() {
        let mut database = Database::open_in_memory().expect("database opens");

        let (user_project, user_board) =
            projects::create(database.connection_mut(), project_input("Personal project"))
                .expect("user project creates");
        let user_column = columns::list(database.connection(), &user_board)
            .expect("user columns")
            .remove(0);
        let user_task = tasks::create(
            database.connection_mut(),
            NewTask {
                column_id: user_column.id.clone(),
                title: "Private work".to_owned(),
            },
        )
        .expect("user task creates");
        let user_subtask = subtasks::create(
            database.connection_mut(),
            &user_task.id,
            "Private checklist item",
        )
        .expect("user subtask creates");
        let user_note = notes::create(
            database.connection_mut(),
            &user_project.id,
            "Private note",
            "Only the user may change this body.",
            std::slice::from_ref(&user_task.id),
        )
        .expect("user note creates");

        assert!(!user_project.mcp_managed);
        assert!(!is_managed_project(database.connection(), &user_project.id).expect("scope reads"));
        assert!(require_managed_project(database.connection(), &user_project.id).is_err());
        assert!(require_managed_board(database.connection(), &user_board).is_err());
        assert!(require_managed_column(database.connection(), &user_column.id).is_err());
        assert!(require_managed_task(database.connection(), &user_task.id).is_err());
        assert!(require_managed_subtask(database.connection(), &user_subtask.id).is_err());
        assert!(require_managed_note(database.connection(), &user_note.id).is_err());

        let (ai_project, ai_board) =
            projects::create_mcp(database.connection_mut(), project_input("Agent workspace"))
                .expect("AI project creates");
        let ai_column = columns::list(database.connection(), &ai_board)
            .expect("AI columns")
            .remove(0);
        let ai_task = tasks::create(
            database.connection_mut(),
            NewTask {
                column_id: ai_column.id.clone(),
                title: "Agent work".to_owned(),
            },
        )
        .expect("AI task creates");
        let ai_subtask = subtasks::create(
            database.connection_mut(),
            &ai_task.id,
            "Agent checklist item",
        )
        .expect("AI subtask creates");
        let ai_note = notes::create(
            database.connection_mut(),
            &ai_project.id,
            "Agent note",
            "Long-form context for managed work.",
            std::slice::from_ref(&ai_task.id),
        )
        .expect("AI note creates");

        assert!(ai_project.mcp_managed);
        assert!(is_managed_project(database.connection(), &ai_project.id).expect("scope reads"));
        require_managed_project(database.connection(), &ai_project.id).expect("project allowed");
        require_managed_board(database.connection(), &ai_board).expect("board allowed");
        require_managed_column(database.connection(), &ai_column.id).expect("column allowed");
        require_managed_task(database.connection(), &ai_task.id).expect("task allowed");
        require_managed_subtask(database.connection(), &ai_subtask.id).expect("subtask allowed");
        require_managed_note(database.connection(), &ai_note.id).expect("note allowed");

        let sidebar_boards = crate::db::boards::list_mcp_managed(database.connection())
            .expect("managed boards list");
        assert_eq!(sidebar_boards.len(), 1);
        assert_eq!(sidebar_boards[0].id, ai_board);
    }
}
