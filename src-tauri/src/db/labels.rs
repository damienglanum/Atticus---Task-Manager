//! Label persistence.
//!
//! Labels belong to a project, not to a board or a task: the same "blocked on
//! review" means the same thing across every board in a project, and a label
//! that had to be recreated per board would stop being a way to find things.

use rmcp::schemars::JsonSchema;
use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::now_ms;
use crate::db::projects::new_id;
use crate::domain::validate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Label.ts")]
pub struct Label {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "LabelInput.ts")]
pub struct LabelInput {
    pub name: String,
    pub color: String,
}

const SELECT: &str = "SELECT id, project_id, name, color, created_at, updated_at FROM labels";

fn row_to_label(row: &Row<'_>) -> rusqlite::Result<Label> {
    Ok(Label {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list(conn: &Connection, project_id: &str) -> AppResult<Vec<Label>> {
    let mut statement = conn.prepare(&format!(
        "{SELECT} WHERE project_id = ?1 ORDER BY name COLLATE NOCASE"
    ))?;
    let rows = statement.query_map([project_id], row_to_label)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<Label> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_label)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "label".to_owned(),
            id: id.to_owned(),
        })
}

pub fn create(conn: &Connection, project_id: &str, input: LabelInput) -> AppResult<Label> {
    crate::db::projects::find(conn, project_id)?;

    let name = validate::required_text("name", &input.name, validate::LABEL_NAME_MAX)?;
    let color = validate::color("color", &input.color)?;
    reject_duplicate_name(conn, project_id, &name, None)?;

    let id = new_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO labels (id, project_id, name, color, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, project_id, name, color, now],
    )?;

    find(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: LabelInput) -> AppResult<Label> {
    let existing = find(conn, id)?;

    let name = validate::required_text("name", &input.name, validate::LABEL_NAME_MAX)?;
    let color = validate::color("color", &input.color)?;
    reject_duplicate_name(conn, &existing.project_id, &name, Some(id))?;

    conn.execute(
        "UPDATE labels SET name = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, name, color, now_ms()],
    )?;

    find(conn, id)
}

/// Two labels with the same name in one project are indistinguishable on a card,
/// so the second one is refused rather than silently created.
fn reject_duplicate_name(
    conn: &Connection,
    project_id: &str,
    name: &str,
    ignoring: Option<&str>,
) -> AppResult<()> {
    let taken: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM labels \
         WHERE project_id = ?1 AND name = ?2 COLLATE NOCASE AND (?3 IS NULL OR id <> ?3))",
        rusqlite::params![project_id, name, ignoring],
        |row| row.get(0),
    )?;

    if taken {
        return Err(AppError::validation(
            "name",
            format!("This project already has a label called “{name}”."),
        ));
    }
    Ok(())
}

/// How many tasks carry this label, so the delete confirmation can say so.
pub fn usage_count(conn: &Connection, id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM task_labels WHERE label_id = ?1",
        [id],
        |row| row.get(0),
    )?)
}

/// Deletes a label, returning what it takes with it so the caller can undo.
pub fn delete(conn: &mut Connection, id: &str) -> AppResult<DeletedLabel> {
    let label = find(conn, id)?;

    let tx = conn.transaction()?;
    let mut statement = tx.prepare("SELECT task_id FROM task_labels WHERE label_id = ?1")?;
    let task_ids = statement
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    tx.execute("DELETE FROM labels WHERE id = ?1", [id])?;
    tx.commit()?;

    Ok(DeletedLabel {
        label: label.into(),
        task_ids,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "DeletedLabel.ts")]
pub struct DeletedLabel {
    pub label: LabelRow,
    /// Every task that carried it, so an undo restores the links as well as the
    /// label itself.
    pub task_ids: Vec<String>,
}

/// The stored shape of a label, for round-tripping through an undo token.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "LabelRow.ts")]
pub struct LabelRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

impl From<Label> for LabelRow {
    fn from(label: Label) -> Self {
        Self {
            id: label.id,
            project_id: label.project_id,
            name: label.name,
            color: label.color,
            created_at: label.created_at,
            updated_at: label.updated_at,
        }
    }
}

pub fn reinsert(tx: &rusqlite::Transaction<'_>, deleted: &DeletedLabel) -> AppResult<()> {
    let label = &deleted.label;
    tx.execute(
        "INSERT INTO labels (id, project_id, name, color, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            label.id,
            label.project_id,
            label.name,
            label.color,
            label.created_at,
            label.updated_at
        ],
    )?;

    for task_id in &deleted.task_ids {
        // A task deleted meanwhile is not a reason to refuse the whole undo.
        tx.execute(
            "INSERT OR IGNORE INTO task_labels (task_id, label_id) \
             SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?1)",
            rusqlite::params![task_id, label.id],
        )?;
    }

    Ok(())
}

/// Replaces a task's labels with exactly the given set.
///
/// A set rather than add/remove calls: the label picker knows the state it wants,
/// and sending that state avoids the class of bug where two toggles race and
/// leave a link nobody asked for.
pub fn set_for_task(conn: &mut Connection, task_id: &str, label_ids: &[String]) -> AppResult<()> {
    let task = crate::db::tasks::find(conn, task_id)?;

    for label_id in label_ids {
        let label = find(conn, label_id)?;
        if label.project_id != task.project_id {
            return Err(AppError::Conflict {
                message: "That label belongs to a different project.".to_owned(),
            });
        }
    }

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM task_labels WHERE task_id = ?1", [task_id])?;
    {
        let mut insert =
            tx.prepare("INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)")?;
        for label_id in label_ids {
            insert.execute(rusqlite::params![task_id, label_id])?;
        }
    }
    tx.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
        rusqlite::params![task_id, now_ms()],
    )?;
    tx.commit()?;

    Ok(())
}

/// Replaces labels only when the parent task still has the timestamp the
/// caller read. The timestamp compare, replacement, and new timestamp commit
/// together, so a desktop edit can never be silently overwritten by MCP.
pub fn set_for_task_if_current(
    conn: &mut Connection,
    task_id: &str,
    label_ids: &[String],
    expected_updated_at: i64,
) -> AppResult<()> {
    let task = crate::db::tasks::find(conn, task_id)?;
    for label_id in label_ids {
        let label = find(conn, label_id)?;
        if label.project_id != task.project_id {
            return Err(AppError::Conflict {
                message: "That label belongs to a different project.".to_owned(),
            });
        }
    }

    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let updated_at = now_ms().max(task.updated_at.saturating_add(1));
    let changed = tx.execute(
        "UPDATE tasks SET updated_at = ?2 WHERE id = ?1 AND updated_at = ?3",
        rusqlite::params![task_id, updated_at, expected_updated_at],
    )?;
    if changed == 0 {
        let current = crate::db::tasks::find(&tx, task_id)?;
        return Err(AppError::Conflict {
            message: format!(
                "Task {task_id} changed after it was read (expected updatedAt {expected_updated_at}, current {}). Call atticus_get_task, merge with current labelIds, and retry using the new updatedAt.",
                current.updated_at
            ),
        });
    }

    tx.execute("DELETE FROM task_labels WHERE task_id = ?1", [task_id])?;
    {
        let mut insert =
            tx.prepare("INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)")?;
        for label_id in label_ids {
            insert.execute(rusqlite::params![task_id, label_id])?;
        }
    }
    tx.commit()?;

    Ok(())
}

pub fn for_task(conn: &Connection, task_id: &str) -> AppResult<Vec<String>> {
    let mut statement = conn.prepare("SELECT label_id FROM task_labels WHERE task_id = ?1")?;
    let rows = statement.query_map([task_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
