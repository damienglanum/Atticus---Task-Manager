//! Project persistence.

use rusqlite::{Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::{now_ms, ordering};
use crate::domain::validate;
use crate::error::{AppError, AppResult};

/// The five columns a new board starts with. Chosen to be immediately usable and
/// immediately editable — the point is that nobody has to design a workflow
/// before writing their first task.
pub const DEFAULT_COLUMNS: [&str; 5] = ["Backlog", "Todo", "In Progress", "Review", "Done"];
pub const DEFAULT_BOARD_NAME: &str = "Board";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Project.ts")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub key_prefix: String,
    // `i64` defaults to `bigint` in ts-rs, but serde_json writes it as a JSON
    // number and Tauri's IPC therefore delivers a JS `number`. See ADR-0010.
    #[ts(type = "number")]
    pub next_task_number: i64,
    pub directory_path: Option<String>,
    /// Derived, never stored: a directory on an unmounted volume is still a
    /// valid setting, so this is a warning for the UI rather than an error.
    pub directory_missing: bool,
    // True only for projects created through the MCP server. The marker is a
    // database-enforced write boundary, not a user-editable project setting.
    pub mcp_managed: bool,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "NewProject.ts")]
pub struct NewProject {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub color: String,
    /// Derived from the name when absent.
    #[serde(default)]
    #[ts(optional)]
    pub key_prefix: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub directory_path: Option<String>,
}

/// Every field optional: absent means "leave unchanged", which is what makes a
/// patch different from a replacement.
#[derive(Debug, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ProjectPatch.ts")]
pub struct ProjectPatch {
    #[ts(optional)]
    pub name: Option<String>,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub color: Option<String>,
    #[ts(optional)]
    pub key_prefix: Option<String>,
    /// Absent leaves the path unchanged; an empty string clears it. A dedicated
    /// "clear" flag or a double `Option` would both be more faithful, and both
    /// would be worse to use from TypeScript for a field whose empty value is
    /// already meaningless.
    pub directory_path: Option<String>,
}

/// What deleting a project would destroy. Shown to the user *before* they
/// confirm, with real numbers rather than a vague warning.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "DeletedCounts.ts")]
pub struct DeletedCounts {
    pub boards: u32,
    pub columns: u32,
    pub tasks: u32,
    pub subtasks: u32,
    pub labels: u32,
}

fn row_to_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    let directory_path: Option<String> = row.get("directory_path")?;
    let directory_missing = directory_path
        .as_deref()
        .is_some_and(|path| !std::path::Path::new(path).exists());

    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        color: row.get("color")?,
        key_prefix: row.get("key_prefix")?,
        next_task_number: row.get("next_task_number")?,
        directory_path,
        directory_missing,
        mcp_managed: row.get::<_, i64>("mcp_managed")? != 0,
        position: row.get("position")?,
        archived_at: row.get("archived_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const SELECT: &str = "SELECT projects.id, name, description, color, key_prefix, next_task_number, \
                      directory_path, position, archived_at, created_at, updated_at, \
                      EXISTS(SELECT 1 FROM mcp_managed_projects managed \
                             WHERE managed.project_id = projects.id) AS mcp_managed \
                      FROM projects";

pub fn list(conn: &Connection, include_archived: bool) -> AppResult<Vec<Project>> {
    let sql = if include_archived {
        format!("{SELECT} ORDER BY position")
    } else {
        format!("{SELECT} WHERE archived_at IS NULL ORDER BY position")
    };

    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], row_to_project)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<Project> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], |row| {
        row_to_project(row)
    })
    .optional()?
    .ok_or_else(|| AppError::NotFound {
        entity: "project".to_owned(),
        id: id.to_owned(),
    })
}

/// Creates a project together with its first board and that board's default
/// columns, in **one** transaction. A project without a board is not a state the
/// user should ever be able to observe.
pub fn create(conn: &mut Connection, input: NewProject) -> AppResult<(Project, String)> {
    create_with_scope(conn, input, false)
}

/// Creates the isolated project that contains boards writable through MCP.
/// The ownership marker and initial board commit in the same transaction, so a
/// failure can never leave a normal project accidentally exposed to the AI.
pub fn create_mcp(conn: &mut Connection, input: NewProject) -> AppResult<(Project, String)> {
    create_with_scope(conn, input, true)
}

fn create_with_scope(
    conn: &mut Connection,
    input: NewProject,
    mcp_managed: bool,
) -> AppResult<(Project, String)> {
    let name = validate::required_text("name", &input.name, validate::PROJECT_NAME_MAX)?;
    let description = validate::optional_text(
        "description",
        &input.description,
        validate::PROJECT_DESCRIPTION_MAX,
    )?;
    let color = validate::color("color", &input.color)?;
    let key_prefix = match input.key_prefix.as_deref() {
        Some(value) if !value.trim().is_empty() => validate::key_prefix("keyPrefix", value)?,
        _ => validate::suggest_key_prefix(&name),
    };
    let directory_path =
        validate::optional_directory("directoryPath", input.directory_path.as_deref())?;

    let now = now_ms();
    let project_id = new_id();
    let board_id = new_id();

    let tx = conn.transaction()?;

    let position = ordering::next_position(&tx, ordering::PROJECTS, None)?;

    tx.execute(
        "INSERT INTO projects (id, name, description, color, key_prefix, next_task_number, \
         directory_path, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?8)",
        rusqlite::params![
            project_id,
            name,
            description,
            color,
            key_prefix,
            directory_path,
            position,
            now
        ],
    )?;

    if mcp_managed {
        tx.execute(
            "INSERT INTO mcp_managed_projects (project_id, created_at) VALUES (?1, ?2)",
            rusqlite::params![project_id, now],
        )?;
    }

    tx.execute(
        "INSERT INTO boards (id, project_id, name, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        rusqlite::params![board_id, project_id, DEFAULT_BOARD_NAME, now],
    )?;

    for (index, column_name) in DEFAULT_COLUMNS.iter().enumerate() {
        tx.execute(
            "INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            rusqlite::params![new_id(), board_id, column_name, index as i64, now],
        )?;
    }

    tx.commit()?;

    Ok((find(conn, &project_id)?, board_id))
}

pub fn update(conn: &mut Connection, id: &str, patch: ProjectPatch) -> AppResult<Project> {
    let existing = find(conn, id)?;

    let name = match patch.name {
        Some(value) => validate::required_text("name", &value, validate::PROJECT_NAME_MAX)?,
        None => existing.name,
    };
    let description = match patch.description {
        Some(value) => {
            validate::optional_text("description", &value, validate::PROJECT_DESCRIPTION_MAX)?
        }
        None => existing.description,
    };
    let color = match patch.color {
        Some(value) => validate::color("color", &value)?,
        None => existing.color,
    };
    let key_prefix = match patch.key_prefix {
        Some(value) => validate::key_prefix("keyPrefix", &value)?,
        None => existing.key_prefix,
    };
    let directory_path = match patch.directory_path.as_deref() {
        Some(value) => validate::optional_directory("directoryPath", Some(value))?,
        None => existing.directory_path,
    };

    conn.execute(
        "UPDATE projects SET name = ?2, description = ?3, color = ?4, key_prefix = ?5, \
         directory_path = ?6, updated_at = ?7 WHERE id = ?1",
        rusqlite::params![
            id,
            name,
            description,
            color,
            key_prefix,
            directory_path,
            now_ms()
        ],
    )?;

    find(conn, id)
}

pub fn set_archived(conn: &mut Connection, id: &str, archived: bool) -> AppResult<Project> {
    find(conn, id)?;
    let now = now_ms();

    conn.execute(
        "UPDATE projects SET archived_at = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, archived.then_some(now), now],
    )?;

    find(conn, id)
}

/// What a delete would remove. Counted, not estimated.
pub fn deletion_counts(conn: &Connection, id: &str) -> AppResult<DeletedCounts> {
    let count = |sql: &str| -> AppResult<u32> {
        Ok(conn.query_row(sql, [id], |row| row.get::<_, i64>(0))? as u32)
    };

    Ok(DeletedCounts {
        boards: count("SELECT COUNT(*) FROM boards WHERE project_id = ?1")?,
        columns: count(
            "SELECT COUNT(*) FROM board_columns c \
             JOIN boards b ON b.id = c.board_id WHERE b.project_id = ?1",
        )?,
        tasks: count("SELECT COUNT(*) FROM tasks WHERE project_id = ?1")?,
        subtasks: count(
            "SELECT COUNT(*) FROM subtasks s \
             JOIN tasks t ON t.id = s.task_id WHERE t.project_id = ?1",
        )?,
        labels: count("SELECT COUNT(*) FROM labels WHERE project_id = ?1")?,
    })
}

/// Permanently deletes a project and everything beneath it.
///
/// `confirm_name` must match the project's name exactly. This is the only
/// operation in the application that asks the user to type something, and it is
/// checked in the backend as well as the dialog — a confirmation enforced only
/// by the UI is decoration.
pub fn delete(conn: &mut Connection, id: &str, confirm_name: &str) -> AppResult<DeletedCounts> {
    let project = find(conn, id)?;

    if confirm_name.trim() != project.name {
        return Err(AppError::Conflict {
            message: "The name you typed doesn't match this project. Nothing was deleted."
                .to_owned(),
        });
    }

    let counts = deletion_counts(conn, id)?;

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::PROJECTS, None)?;
    tx.commit()?;

    Ok(counts)
}

pub fn reorder(conn: &mut Connection, ordered_ids: &[String]) -> AppResult<Vec<Project>> {
    let tx = conn.transaction()?;
    ordering::apply_order(&tx, ordering::PROJECTS, None, ordered_ids)?;
    ordering::assert_dense(&tx, ordering::PROJECTS, None)?;
    tx.commit()?;

    list(conn, true)
}

/// Allocates the next per-project task number and advances the counter.
///
/// Numbers are never reused, including after deletion: `KAN-14` in a commit
/// message must not come to mean a different task six months later.
pub fn take_next_task_number(tx: &Transaction<'_>, project_id: &str) -> AppResult<i64> {
    let number: i64 = tx
        .query_row(
            "SELECT next_task_number FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "project".to_owned(),
            id: project_id.to_owned(),
        })?;

    tx.execute(
        "UPDATE projects SET next_task_number = ?2 WHERE id = ?1",
        rusqlite::params![project_id, number + 1],
    )?;

    Ok(number)
}

/// UUIDv7: unique, and monotonic by creation time so ids sort usefully.
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}
