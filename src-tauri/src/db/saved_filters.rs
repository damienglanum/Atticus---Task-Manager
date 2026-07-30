//! Named filters, saved per project.
//!
//! The filter itself is stored as opaque JSON. Its shape is a frontend concern
//! and changes with the interface; giving it columns here would mean a
//! migration every time a new facet is added, for no gain — nothing in SQL ever
//! queries inside it.

use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;
use ts_rs::TS;

use crate::db::projects::new_id;
use crate::db::{now_ms, ordering};
use crate::domain::validate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "SavedFilter.ts")]
pub struct SavedFilter {
    pub id: String,
    pub project_id: String,
    pub name: String,
    /// The frontend's filter object, serialised. Opaque to Rust.
    pub filter: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

const SELECT: &str = "SELECT id, project_id, name, filter, position, created_at, updated_at \
                      FROM saved_filters";

fn row_to_filter(row: &Row<'_>) -> rusqlite::Result<SavedFilter> {
    Ok(SavedFilter {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        filter: row.get("filter")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list(conn: &Connection, project_id: &str) -> AppResult<Vec<SavedFilter>> {
    let mut statement =
        conn.prepare(&format!("{SELECT} WHERE project_id = ?1 ORDER BY position"))?;
    let rows = statement.query_map([project_id], row_to_filter)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn create(
    conn: &mut Connection,
    project_id: &str,
    name: &str,
    filter: &str,
) -> AppResult<SavedFilter> {
    crate::db::projects::find(conn, project_id)?;
    let name = validate::required_text("name", name, validate::SAVED_FILTER_NAME_MAX)?;

    // Parsed only to reject something that is not JSON at all. A filter the
    // frontend cannot read back would be a saved filter that silently does
    // nothing when applied.
    serde_json::from_str::<serde_json::Value>(filter)
        .map_err(|_| AppError::validation("filter", "That filter could not be saved."))?;

    let id = new_id();
    let now = now_ms();

    let tx = conn.transaction()?;
    let position = ordering::next_position(&tx, ordering::SAVED_FILTERS, Some(project_id))?;
    tx.execute(
        "INSERT INTO saved_filters (id, project_id, name, filter, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        rusqlite::params![id, project_id, name, filter, position, now],
    )?;
    tx.commit()?;

    find(conn, &id)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<SavedFilter> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_filter)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "saved filter".to_owned(),
            id: id.to_owned(),
        })
}

pub fn delete(conn: &mut Connection, id: &str) -> AppResult<()> {
    let existing = find(conn, id)?;

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM saved_filters WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::SAVED_FILTERS, Some(&existing.project_id))?;
    tx.commit()?;

    Ok(())
}
