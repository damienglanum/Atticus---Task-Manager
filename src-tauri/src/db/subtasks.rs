//! Subtask persistence.
//!
//! Subtasks are a checklist inside a task, ordered by the same dense-integer
//! scheme as everything else. Completing all of them does **not** move or close
//! the parent — US-13 AC3 rules out hidden automation, and a board that moves
//! work on its own is a board nobody trusts.

use rmcp::schemars::JsonSchema;
use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::projects::new_id;
use crate::db::{now_ms, ordering};
use crate::domain::validate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Subtask.ts")]
pub struct Subtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub done: bool,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "SubtaskPatch.ts")]
pub struct SubtaskPatch {
    #[ts(optional)]
    pub title: Option<String>,
    #[ts(optional)]
    pub done: Option<bool>,
}

const SELECT: &str = "SELECT id, task_id, title, done, position, created_at, updated_at \
                      FROM subtasks";

fn row_to_subtask(row: &Row<'_>) -> rusqlite::Result<Subtask> {
    Ok(Subtask {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        title: row.get("title")?,
        done: row.get("done")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list(conn: &Connection, task_id: &str) -> AppResult<Vec<Subtask>> {
    let mut statement = conn.prepare(&format!("{SELECT} WHERE task_id = ?1 ORDER BY position"))?;
    let rows = statement.query_map([task_id], row_to_subtask)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<Subtask> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_subtask)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "subtask".to_owned(),
            id: id.to_owned(),
        })
}

pub fn create(conn: &mut Connection, task_id: &str, title: &str) -> AppResult<Subtask> {
    crate::db::tasks::find(conn, task_id)?;
    let title = validate::required_text("title", title, validate::SUBTASK_TITLE_MAX)?;

    let id = new_id();
    let now = now_ms();

    let tx = conn.transaction()?;
    let position = ordering::next_position(&tx, ordering::SUBTASKS, Some(task_id))?;
    tx.execute(
        "INSERT INTO subtasks (id, task_id, title, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, task_id, title, position, now],
    )?;
    touch_parent(&tx, task_id, now)?;
    tx.commit()?;

    find(conn, &id)
}

pub fn update(conn: &Connection, id: &str, patch: SubtaskPatch) -> AppResult<Subtask> {
    let existing = find(conn, id)?;

    let title = match patch.title {
        Some(value) => validate::required_text("title", &value, validate::SUBTASK_TITLE_MAX)?,
        None => existing.title,
    };
    let done = patch.done.unwrap_or(existing.done);
    let now = now_ms();

    conn.execute(
        "UPDATE subtasks SET title = ?2, done = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, title, done, now],
    )?;
    conn.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![existing.task_id, now],
    )?;

    find(conn, id)
}

/// Updates a subtask only when its last-read timestamp is still current.
///
/// The immediate transaction keeps the subtask edit and parent-task timestamp
/// together while preventing another process from slipping an edit between the
/// version check and the write.
pub fn update_if_current(
    conn: &mut Connection,
    id: &str,
    patch: SubtaskPatch,
    expected_updated_at: i64,
) -> AppResult<Subtask> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing = find(&tx, id)?;
    if existing.updated_at != expected_updated_at {
        return Err(AppError::Conflict {
            message: format!(
                "Subtask {id} changed after it was read (expected updatedAt {expected_updated_at}, current {}). Call atticus_get_task for its parent, reconcile, and retry using the new updatedAt.",
                existing.updated_at
            ),
        });
    }

    let title = match patch.title {
        Some(value) => validate::required_text("title", &value, validate::SUBTASK_TITLE_MAX)?,
        None => existing.title,
    };
    let done = patch.done.unwrap_or(existing.done);
    let updated_at = now_ms().max(existing.updated_at.saturating_add(1));

    tx.execute(
        "UPDATE subtasks SET title = ?2, done = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, title, done, updated_at],
    )?;
    touch_parent(&tx, &existing.task_id, updated_at)?;
    tx.commit()?;

    find(conn, id)
}

pub fn delete(conn: &mut Connection, id: &str) -> AppResult<()> {
    let existing = find(conn, id)?;

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM subtasks WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::SUBTASKS, Some(&existing.task_id))?;
    touch_parent(&tx, &existing.task_id, now_ms())?;
    tx.commit()?;

    Ok(())
}

pub fn reorder(
    conn: &mut Connection,
    task_id: &str,
    ordered_ids: &[String],
) -> AppResult<Vec<Subtask>> {
    let tx = conn.transaction()?;
    ordering::apply_order(&tx, ordering::SUBTASKS, Some(task_id), ordered_ids)?;
    ordering::assert_dense(&tx, ordering::SUBTASKS, Some(task_id))?;
    touch_parent(&tx, task_id, now_ms())?;
    tx.commit()?;

    list(conn, task_id)
}

/// A change to a subtask is a change to its task.
///
/// Without this the board would show a stale `updated_at` for a task whose
/// checklist just changed, and "sort by recently updated" would be a lie.
fn touch_parent(tx: &rusqlite::Transaction<'_>, task_id: &str, now: i64) -> AppResult<()> {
    tx.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![task_id, now],
    )?;
    Ok(())
}
