//! Web links attached to a task.

use rmcp::schemars::JsonSchema;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;
use ts_rs::TS;

use crate::db::projects::new_id;
use crate::db::{now_ms, ordering};
use crate::domain::validate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "LinkRef.ts")]
pub struct LinkRef {
    pub id: String,
    pub task_id: String,
    pub url: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
}

const SELECT: &str = "SELECT id, task_id, url, position, created_at FROM link_refs";

fn row_to_link_ref(row: &Row<'_>) -> rusqlite::Result<LinkRef> {
    Ok(LinkRef {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        url: row.get("url")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
    })
}

pub fn list(conn: &Connection, task_id: &str) -> AppResult<Vec<LinkRef>> {
    let mut statement = conn.prepare(&format!("{SELECT} WHERE task_id = ?1 ORDER BY position"))?;
    let rows = statement.query_map([task_id], row_to_link_ref)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<LinkRef> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_link_ref)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "link reference".to_owned(),
            id: id.to_owned(),
        })
}

pub fn add(conn: &mut Connection, task_id: &str, raw_url: &str) -> AppResult<LinkRef> {
    crate::db::tasks::find(conn, task_id)?;
    let url = validate::web_url("url", raw_url)?;
    let id = new_id();
    let now = now_ms();

    let tx = conn.transaction()?;
    let position = ordering::next_position(&tx, ordering::LINK_REFS, Some(task_id))?;
    tx.execute(
        "INSERT INTO link_refs (id, task_id, url, position, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, task_id, url, position, now],
    )?;
    tx.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![task_id, now],
    )?;
    tx.commit()?;

    find(conn, &id)
}

pub fn remove(conn: &mut Connection, id: &str) -> AppResult<()> {
    let existing = find(conn, id)?;

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM link_refs WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::LINK_REFS, Some(&existing.task_id))?;
    tx.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![existing.task_id, now_ms()],
    )?;
    tx.commit()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_links_are_accepted() {
        for valid in ["https://example.com/docs", "http://localhost:3000/a"] {
            assert!(validate::web_url("url", valid).is_ok(), "{valid}");
        }
        for invalid in [
            "example.com",
            "http://?missing-host",
            "file:///tmp/secret",
            "javascript:alert(1)",
        ] {
            assert!(validate::web_url("url", invalid).is_err(), "{invalid}");
        }
    }
}
