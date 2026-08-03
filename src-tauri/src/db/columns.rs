//! Board column persistence.

use rmcp::schemars::JsonSchema;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::projects::new_id;
use crate::db::{now_ms, ordering, tasks};
use crate::domain::validate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Column.ts")]
pub struct Column {
    pub id: String,
    pub board_id: String,
    pub name: String,
    /// Soft: exceeding it warns, it never blocks a move (US-7 AC3).
    #[ts(type = "number | null")]
    pub wip_limit: Option<i64>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// The full settings of a column, not a patch.
///
/// A patch would need to distinguish "leave the WIP limit alone" from "clear
/// it", which in JSON means the difference between an absent key and a null —
/// a distinction that is easy to lose in transit and awkward to type. The
/// settings dialog always submits both fields anyway, so sending both is honest
/// about what the operation does.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ColumnSettings.ts")]
pub struct ColumnSettings {
    pub name: String,
    #[ts(type = "number | null")]
    pub wip_limit: Option<i64>,
}

/// What happens to the tasks in a column that is being deleted.
///
/// There is no default. Deleting work silently is the one outcome this type
/// exists to prevent, so the caller has to say which it meant.
// `rename_all` renames an enum's *variants*; the fields inside a struct variant
// need `rename_all_fields`, or half this type reaches TypeScript in snake_case.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export, export_to = "ColumnDisposition.ts")]
pub enum ColumnDisposition {
    /// Move the tasks to another column on the same board, appended in order.
    MoveTo { column_id: String },
    /// Delete the tasks with the column.
    DeleteTasks,
}

const SELECT: &str = "SELECT id, board_id, name, wip_limit, position, created_at, updated_at \
                      FROM board_columns";

fn row_to_column(row: &Row<'_>) -> rusqlite::Result<Column> {
    Ok(Column {
        id: row.get("id")?,
        board_id: row.get("board_id")?,
        name: row.get("name")?,
        wip_limit: row.get("wip_limit")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list(conn: &Connection, board_id: &str) -> AppResult<Vec<Column>> {
    let mut statement = conn.prepare(&format!("{SELECT} WHERE board_id = ?1 ORDER BY position"))?;
    let rows = statement.query_map([board_id], row_to_column)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<Column> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_column)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "column".to_owned(),
            id: id.to_owned(),
        })
}

pub fn count_for_board(conn: &Connection, board_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM board_columns WHERE board_id = ?1",
        [board_id],
        |row| row.get(0),
    )?)
}

pub fn create(conn: &mut Connection, board_id: &str, name: &str) -> AppResult<Column> {
    crate::db::boards::find(conn, board_id)?;
    let name = validate::required_text("name", name, validate::COLUMN_NAME_MAX)?;

    let id = new_id();
    let now = now_ms();

    let tx = conn.transaction()?;
    let position = ordering::next_position(&tx, ordering::BOARD_COLUMNS, Some(board_id))?;
    tx.execute(
        "INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, board_id, name, position, now],
    )?;
    tx.commit()?;

    find(conn, &id)
}

pub fn update(conn: &Connection, id: &str, settings: ColumnSettings) -> AppResult<Column> {
    find(conn, id)?;

    let name = validate::required_text("name", &settings.name, validate::COLUMN_NAME_MAX)?;
    let wip_limit = validate_wip_limit(settings.wip_limit)?;

    conn.execute(
        "UPDATE board_columns SET name = ?2, wip_limit = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, name, wip_limit, now_ms()],
    )?;

    find(conn, id)
}

/// A WIP limit is a count of tasks, so zero and negatives are not "no limit" —
/// they are mistakes, and silently coercing them to `NULL` would hide one.
fn validate_wip_limit(value: Option<i64>) -> AppResult<Option<i64>> {
    match value {
        Some(limit) if limit < 1 => Err(AppError::validation(
            "wipLimit",
            "A work-in-progress limit has to be at least 1. Leave it empty for no limit.",
        )),
        other => Ok(other),
    }
}

pub fn reorder(
    conn: &mut Connection,
    board_id: &str,
    ordered_ids: &[String],
) -> AppResult<Vec<Column>> {
    let tx = conn.transaction()?;
    ordering::apply_order(&tx, ordering::BOARD_COLUMNS, Some(board_id), ordered_ids)?;
    ordering::assert_dense(&tx, ordering::BOARD_COLUMNS, Some(board_id))?;
    tx.commit()?;

    list(conn, board_id)
}

/// How many live tasks a column holds. Used to decide which confirmation the
/// user is owed before it is deleted.
pub fn live_task_count(conn: &Connection, column_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE column_id = ?1 AND archived_at IS NULL",
        [column_id],
        |row| row.get(0),
    )?)
}

/// Deletes a column, doing something explicit with the work that was in it.
///
/// Returns the snapshot needed to put everything back. The whole operation —
/// moving or deleting the tasks, removing the column, closing the gap it left
/// in the ordering — is one transaction, so there is no state in which the
/// column is gone but its tasks are not.
pub fn delete(
    conn: &mut Connection,
    id: &str,
    disposition: &ColumnDisposition,
) -> AppResult<DeletedColumn> {
    let column = find(conn, id)?;

    if count_for_board(conn, &column.board_id)? <= 1 {
        return Err(AppError::Conflict {
            message: "A board needs at least one column, so this one can't be deleted. \
                      Add another column first."
                .to_owned(),
        });
    }

    // Checked before the transaction opens so the error names the real problem
    // rather than surfacing as a foreign-key failure halfway through.
    if let ColumnDisposition::MoveTo { column_id } = disposition {
        if column_id == id {
            return Err(AppError::Conflict {
                message: "Tasks can't be moved to the column being deleted.".to_owned(),
            });
        }
        let target = find(conn, column_id)?;
        if target.board_id != column.board_id {
            return Err(AppError::Conflict {
                message: "Tasks can only be moved to a column on the same board.".to_owned(),
            });
        }
    }

    let tx = conn.transaction()?;

    let moved_tasks;
    let deleted_tasks;

    match disposition {
        ColumnDisposition::MoveTo { column_id } => {
            let ids = ordering::ids_in_order(&tx, ordering::TASKS, Some(id))?;
            let first_free = ordering::next_position(&tx, ordering::TASKS, Some(column_id))?;
            let now = now_ms();

            // Appended in their existing order, so a column's worth of work
            // arrives in the target looking the way it did before the move.
            for (offset, task_id) in ids.iter().enumerate() {
                let position = first_free + i64::try_from(offset).unwrap_or(i64::MAX);
                tx.execute(
                    "UPDATE tasks SET column_id = ?2, position = ?3, updated_at = ?4 \
                     WHERE id = ?1",
                    rusqlite::params![task_id, column_id, position, now],
                )?;
            }

            // Archived tasks are outside the ordering sequence, so the loop
            // above does not see them — and `ON DELETE CASCADE` would take them
            // with the column. The user asked for the work to be kept, so their
            // archive moves too. Their position stays -1; they are not part of
            // any sequence until they are restored.
            tx.execute(
                "UPDATE tasks SET column_id = ?2, updated_at = ?3 \
                 WHERE column_id = ?1 AND archived_at IS NOT NULL",
                rusqlite::params![id, column_id, now],
            )?;

            moved_tasks = ids;
            deleted_tasks = Vec::new();
        }
        ColumnDisposition::DeleteTasks => {
            // Captured before the delete, because `ON DELETE CASCADE` takes the
            // subtasks, label links and file references with it. An undo that
            // restored the task rows alone would silently discard those, which
            // is exactly the incompleteness ADR-0009 exists to avoid.
            deleted_tasks = tasks::snapshot_for_column(&tx, id)?;
            moved_tasks = Vec::new();
            tx.execute("DELETE FROM tasks WHERE column_id = ?1", [id])?;
        }
    }

    tx.execute("DELETE FROM board_columns WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::BOARD_COLUMNS, Some(&column.board_id))?;
    tx.commit()?;

    Ok(DeletedColumn {
        column: column.into(),
        moved_task_ids: moved_tasks,
        deleted_tasks,
    })
}

/// Everything needed to reverse a column deletion.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "DeletedColumn.ts")]
pub struct DeletedColumn {
    pub column: ColumnRow,
    /// Tasks that were moved elsewhere, in their original order in this column.
    pub moved_task_ids: Vec<String>,
    /// Tasks that were deleted with the column, with their children.
    pub deleted_tasks: Vec<tasks::TaskSnapshot>,
}

/// The stored shape of a column, for round-tripping through an undo token.
///
/// Distinct from [`Column`] because that one is a read model for the UI and may
/// grow derived fields; this one must stay exactly the set of stored values.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ColumnRow.ts")]
pub struct ColumnRow {
    pub id: String,
    pub board_id: String,
    pub name: String,
    #[ts(type = "number | null")]
    pub wip_limit: Option<i64>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

impl From<Column> for ColumnRow {
    fn from(column: Column) -> Self {
        Self {
            id: column.id,
            board_id: column.board_id,
            name: column.name,
            wip_limit: column.wip_limit,
            position: column.position,
            created_at: column.created_at,
            updated_at: column.updated_at,
        }
    }
}

/// Re-inserts a column that was deleted, at the position it used to hold.
pub fn reinsert(tx: &rusqlite::Transaction<'_>, column: &ColumnRow) -> AppResult<()> {
    // Appended first, then moved. Writing it straight back into its old slot
    // would need every column to its right to shift along, and that shift
    // collides with the unique index on `(board_id, position)` — see
    // `ordering::place_at`, which does it in the two phases that work.
    let free = ordering::next_position(tx, ordering::BOARD_COLUMNS, Some(&column.board_id))?;

    tx.execute(
        "INSERT INTO board_columns \
         (id, board_id, name, wip_limit, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            column.id,
            column.board_id,
            column.name,
            column.wip_limit,
            free,
            column.created_at,
            column.updated_at
        ],
    )?;

    ordering::place_at(
        tx,
        ordering::BOARD_COLUMNS,
        Some(&column.board_id),
        &column.id,
        column.position,
    )
}
