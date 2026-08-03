//! Board persistence.

use rmcp::schemars::JsonSchema;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::projects::{new_id, DEFAULT_COLUMNS};
use crate::db::{now_ms, ordering};
use crate::domain::validate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Board.ts")]
pub struct Board {
    pub id: String,
    pub project_id: String,
    pub name: String,
    // `i64` defaults to `bigint` in ts-rs, but serde_json writes it as a JSON
    // number and Tauri's IPC therefore delivers a JS `number`. See ADR-0010.
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "BoardPatch.ts")]
pub struct BoardPatch {
    #[ts(optional)]
    pub name: Option<String>,
}

const SELECT: &str = "SELECT id, project_id, name, position, created_at, updated_at FROM boards";

fn row_to_board(row: &Row<'_>) -> rusqlite::Result<Board> {
    Ok(Board {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list(conn: &Connection, project_id: &str) -> AppResult<Vec<Board>> {
    let mut statement =
        conn.prepare(&format!("{SELECT} WHERE project_id = ?1 ORDER BY position"))?;
    let rows = statement.query_map([project_id], row_to_board)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Every active board inside the isolated MCP workspace, ordered by project and
/// then board. This powers the dedicated sidebar section without broadening the
/// MCP server's permissions.
pub fn list_mcp_managed(conn: &Connection) -> AppResult<Vec<Board>> {
    let mut statement = conn.prepare(
        "SELECT b.id, b.project_id, b.name, b.position, b.created_at, b.updated_at \
         FROM boards b \
         JOIN projects p ON p.id = b.project_id \
         JOIN mcp_managed_projects m ON m.project_id = p.id \
         WHERE p.archived_at IS NULL \
         ORDER BY p.position, b.position",
    )?;
    let rows = statement.query_map([], row_to_board)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<Board> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], |row| {
        row_to_board(row)
    })
    .optional()?
    .ok_or_else(|| AppError::NotFound {
        entity: "board".to_owned(),
        id: id.to_owned(),
    })
}

pub fn count_for_project(conn: &Connection, project_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM boards WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )?)
}

/// Creates a board with the default columns, in one transaction.
pub fn create(conn: &mut Connection, project_id: &str, name: &str) -> AppResult<Board> {
    crate::db::projects::find(conn, project_id)?;
    let name = validate::required_text("name", name, validate::BOARD_NAME_MAX)?;

    let now = now_ms();
    let board_id = new_id();

    let tx = conn.transaction()?;
    let position = ordering::next_position(&tx, ordering::BOARDS, Some(project_id))?;

    tx.execute(
        "INSERT INTO boards (id, project_id, name, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![board_id, project_id, name, position, now],
    )?;

    for (index, column_name) in DEFAULT_COLUMNS.iter().enumerate() {
        tx.execute(
            "INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            rusqlite::params![new_id(), board_id, column_name, index as i64, now],
        )?;
    }

    tx.commit()?;

    find(conn, &board_id)
}

pub fn update(conn: &Connection, id: &str, patch: BoardPatch) -> AppResult<Board> {
    let existing = find(conn, id)?;

    let name = match patch.name {
        Some(value) => validate::required_text("name", &value, validate::BOARD_NAME_MAX)?,
        None => existing.name,
    };

    conn.execute(
        "UPDATE boards SET name = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, name, now_ms()],
    )?;

    find(conn, id)
}

/// Deletes a board and everything on it.
///
/// Refuses to delete a project's last board: a project with no board has no
/// screen to show, and offering an action that leaves the user staring at
/// nothing is worse than not offering it.
pub fn delete(conn: &mut Connection, id: &str) -> AppResult<()> {
    let board = find(conn, id)?;

    if count_for_project(conn, &board.project_id)? <= 1 {
        return Err(AppError::Conflict {
            message: "This is the project's only board, so it can't be deleted. \
                      Create another board first, or archive the project."
                .to_owned(),
        });
    }

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM boards WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::BOARDS, Some(&board.project_id))?;
    tx.commit()?;

    Ok(())
}

pub fn reorder(
    conn: &mut Connection,
    project_id: &str,
    ordered_ids: &[String],
) -> AppResult<Vec<Board>> {
    let tx = conn.transaction()?;
    ordering::apply_order(&tx, ordering::BOARDS, Some(project_id), ordered_ids)?;
    ordering::assert_dense(&tx, ordering::BOARDS, Some(project_id))?;
    tx.commit()?;

    list(conn, project_id)
}
