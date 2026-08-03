//! Task persistence.

use rmcp::schemars::JsonSchema;
use rusqlite::{Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::projects::{new_id, take_next_task_number};
use crate::db::{now_ms, ordering};
use crate::domain::validate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Task.ts")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub board_id: String,
    pub column_id: String,
    /// Per-project, human-readable, and never reused — see `take_next_task_number`.
    #[ts(type = "number")]
    pub number: i64,
    pub title: String,
    pub description: String,
    #[ts(type = "number")]
    pub priority: i64,
    /// A calendar date, `YYYY-MM-DD`, never an instant. A due date does not move
    /// when the user changes timezone, and has no daylight-saving edge case.
    pub due_date: Option<String>,
    #[ts(type = "number | null")]
    pub estimate_minutes: Option<i64>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// The quick composer's input: a title and where to put it.
///
/// Everything else has a default. Capturing a thought should cost one field.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "NewTask.ts")]
pub struct NewTask {
    pub column_id: String,
    pub title: String,
}

/// Optional fields supplied when a caller creates a fully described task in a
/// single operation. Kept out of the quick-composer IPC type: that interface is
/// intentionally only a title and destination.
#[derive(Debug, Default)]
pub struct NewTaskDetails {
    pub description: Option<String>,
    pub priority: Option<i64>,
    pub due_date: Option<String>,
    pub estimate_minutes: Option<i64>,
}

/// A partial edit of a task.
///
/// Every field is genuinely optional — `#[ts(optional)]` so an absent key is
/// absent in TypeScript too, rather than a `null` the caller has to spell out.
/// An absent field means "leave it alone".
///
/// The two nullable fields need a way to say "clear it", which an absent key
/// cannot express, so each has an explicit `clear_` companion. Verbose, but
/// unambiguous in a way that a `null` travelling through three layers is not.
#[derive(Debug, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "TaskPatch.ts")]
pub struct TaskPatch {
    #[ts(optional)]
    pub title: Option<String>,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional, type = "number")]
    pub priority: Option<i64>,
    #[ts(optional)]
    pub due_date: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub clear_due_date: Option<bool>,
    #[ts(optional, type = "number")]
    pub estimate_minutes: Option<i64>,
    #[serde(default)]
    #[ts(optional)]
    pub clear_estimate: Option<bool>,
}

const SELECT: &str = "SELECT id, project_id, board_id, column_id, number, title, description, \
                      priority, due_date, estimate_minutes, position, archived_at, created_at, \
                      updated_at FROM tasks";

fn row_to_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        board_id: row.get("board_id")?,
        column_id: row.get("column_id")?,
        number: row.get("number")?,
        title: row.get("title")?,
        description: row.get("description")?,
        priority: row.get("priority")?,
        due_date: row.get("due_date")?,
        estimate_minutes: row.get("estimate_minutes")?,
        position: row.get("position")?,
        archived_at: row.get("archived_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn find(conn: &Connection, id: &str) -> AppResult<Task> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_task)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "task".to_owned(),
            id: id.to_owned(),
        })
}

/// Creates a task at the end of its column.
pub fn create(conn: &mut Connection, input: NewTask) -> AppResult<Task> {
    create_with_details(conn, input, NewTaskDetails::default())
}

/// Creates a task and its initial focus-mode fields in one transaction.
///
/// MCP can supply all of these together. Validating and inserting them here
/// prevents a bad due date or priority from leaving a half-created task behind.
pub fn create_with_details(
    conn: &mut Connection,
    input: NewTask,
    details: NewTaskDetails,
) -> AppResult<Task> {
    let column = crate::db::columns::find(conn, &input.column_id)?;
    let board = crate::db::boards::find(conn, &column.board_id)?;
    let title = validate::required_text("title", &input.title, validate::TASK_TITLE_MAX)?;
    let description = validate::optional_text(
        "description",
        details.description.as_deref().unwrap_or_default(),
        validate::TASK_DESCRIPTION_MAX,
    )?;
    let priority = validate::priority(details.priority.unwrap_or(0))?;
    let due_date = validate::due_date(details.due_date.as_deref())?;
    let estimate_minutes = validate::estimate_minutes(details.estimate_minutes)?;

    let id = new_id();
    let now = now_ms();

    let tx = conn.transaction()?;
    let number = take_next_task_number(&tx, &board.project_id)?;
    let position = ordering::next_position(&tx, ordering::TASKS, Some(&column.id))?;

    tx.execute(
        "INSERT INTO tasks \
         (id, project_id, board_id, column_id, number, title, description, priority, due_date, \
          estimate_minutes, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        rusqlite::params![
            id,
            board.project_id,
            board.id,
            column.id,
            number,
            title,
            description,
            priority,
            due_date,
            estimate_minutes,
            position,
            now
        ],
    )?;
    tx.commit()?;

    find(conn, &id)
}

pub fn update(conn: &Connection, id: &str, patch: TaskPatch) -> AppResult<Task> {
    update_with_expected_timestamp(conn, id, patch, None)
}

/// Updates a task only when the caller's last-read timestamp is still current.
///
/// MCP uses this compare-and-set variant for replacement-capable edits so a
/// desktop edit made between `get_task` and `update_task` is never overwritten.
pub fn update_if_current(
    conn: &Connection,
    id: &str,
    patch: TaskPatch,
    expected_updated_at: i64,
) -> AppResult<Task> {
    update_with_expected_timestamp(conn, id, patch, Some(expected_updated_at))
}

fn update_with_expected_timestamp(
    conn: &Connection,
    id: &str,
    patch: TaskPatch,
    expected_updated_at: Option<i64>,
) -> AppResult<Task> {
    let existing = find(conn, id)?;

    if expected_updated_at.is_some_and(|expected| expected != existing.updated_at) {
        return Err(stale_task_error(
            id,
            expected_updated_at.unwrap(),
            existing.updated_at,
        ));
    }

    let title = match patch.title {
        Some(value) => validate::required_text("title", &value, validate::TASK_TITLE_MAX)?,
        None => existing.title,
    };

    let description = match patch.description {
        Some(value) => {
            validate::optional_text("description", &value, validate::TASK_DESCRIPTION_MAX)?
        }
        None => existing.description,
    };

    let priority = match patch.priority {
        Some(value) => validate::priority(value)?,
        None => existing.priority,
    };

    let due_date = if patch.clear_due_date.unwrap_or(false) {
        None
    } else {
        match patch.due_date {
            Some(ref value) => validate::due_date(Some(value))?,
            None => existing.due_date,
        }
    };

    let estimate_minutes = if patch.clear_estimate.unwrap_or(false) {
        None
    } else {
        match patch.estimate_minutes {
            Some(value) => validate::estimate_minutes(Some(value))?,
            None => existing.estimate_minutes,
        }
    };

    let updated_at = now_ms().max(existing.updated_at.saturating_add(1));
    let changed = if let Some(expected) = expected_updated_at {
        conn.execute(
            "UPDATE tasks SET title = ?2, description = ?3, priority = ?4, due_date = ?5, \
             estimate_minutes = ?6, updated_at = ?7 WHERE id = ?1 AND updated_at = ?8",
            rusqlite::params![
                id,
                title,
                description,
                priority,
                due_date,
                estimate_minutes,
                updated_at,
                expected
            ],
        )?
    } else {
        conn.execute(
            "UPDATE tasks SET title = ?2, description = ?3, priority = ?4, due_date = ?5, \
             estimate_minutes = ?6, updated_at = ?7 WHERE id = ?1",
            rusqlite::params![
                id,
                title,
                description,
                priority,
                due_date,
                estimate_minutes,
                updated_at
            ],
        )?
    };

    if changed == 0 {
        let current = find(conn, id)?;
        return Err(stale_task_error(
            id,
            expected_updated_at.unwrap_or(existing.updated_at),
            current.updated_at,
        ));
    }

    find(conn, id)
}

fn stale_task_error(id: &str, expected_updated_at: i64, current_updated_at: i64) -> AppError {
    AppError::Conflict {
        message: format!(
            "Task {id} changed after it was read (expected updatedAt {expected_updated_at}, current {current_updated_at}). Call atticus_get_task, merge with current state, and retry using the new updatedAt."
        ),
    }
}

/// Copies a task and places the copy directly below the original (US-11 AC3).
///
/// The copy gets its own task number and its own timestamps, and is never
/// archived even if the original is: it is a new piece of work, not a restored
/// one.
pub fn duplicate(conn: &mut Connection, id: &str) -> AppResult<Task> {
    let original = find(conn, id)?;

    if original.archived_at.is_some() {
        return Err(AppError::Conflict {
            message: "Restore this task before duplicating it.".to_owned(),
        });
    }

    let new_task_id = new_id();
    let now = now_ms();

    let tx = conn.transaction()?;
    let number = take_next_task_number(&tx, &original.project_id)?;

    // Inserted at the end and then moved into place. Writing it straight into
    // `original.position + 1` would need every task below to shift down first,
    // and that shift cannot be expressed as one statement without colliding
    // with the unique index — see `ordering::place_at`.
    let position = ordering::next_position(&tx, ordering::TASKS, Some(&original.column_id))?;

    tx.execute(
        "INSERT INTO tasks \
         (id, project_id, board_id, column_id, number, title, description, priority, due_date, \
          estimate_minutes, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        rusqlite::params![
            new_task_id,
            original.project_id,
            original.board_id,
            original.column_id,
            number,
            copy_title(&original.title),
            original.description,
            original.priority,
            original.due_date,
            original.estimate_minutes,
            position,
            now
        ],
    )?;

    ordering::place_at(
        &tx,
        ordering::TASKS,
        Some(&original.column_id),
        &new_task_id,
        original.position + 1,
    )?;

    copy_children(&tx, &original.id, &new_task_id)?;
    ordering::assert_dense(&tx, ordering::TASKS, Some(&original.column_id))?;
    tx.commit()?;

    find(conn, &new_task_id)
}

/// Appends " (copy)" without letting the result exceed the title limit.
///
/// Truncating the original text is better than refusing to duplicate a task
/// whose title happens to be at the limit.
fn copy_title(title: &str) -> String {
    const SUFFIX: &str = " (copy)";
    let room = validate::TASK_TITLE_MAX - SUFFIX.chars().count();

    let base: String = title.chars().take(room).collect();
    format!("{base}{SUFFIX}")
}

fn copy_children(tx: &Transaction<'_>, from_task: &str, to_task: &str) -> AppResult<()> {
    // Ids are generated per row rather than copied, so the duplicate's children
    // are genuinely its own and editing one does not touch the other.
    let subtasks = load_subtasks(tx, from_task)?;
    for subtask in &subtasks {
        tx.execute(
            "INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                new_id(),
                to_task,
                subtask.title,
                subtask.done,
                subtask.position,
                subtask.created_at,
                subtask.updated_at
            ],
        )?;
    }

    tx.execute(
        "INSERT INTO task_labels (task_id, label_id) \
         SELECT ?2, label_id FROM task_labels WHERE task_id = ?1",
        rusqlite::params![from_task, to_task],
    )?;

    tx.execute(
        "INSERT INTO file_refs \
         (id, task_id, path, display_name, last_verified_at, found, position, created_at) \
         SELECT lower(hex(randomblob(16))), ?2, path, display_name, last_verified_at, found, \
                position, created_at \
         FROM file_refs WHERE task_id = ?1",
        rusqlite::params![from_task, to_task],
    )?;

    tx.execute(
        "INSERT INTO link_refs (id, task_id, url, position, created_at) \
         SELECT lower(hex(randomblob(16))), ?2, url, position, created_at \
         FROM link_refs WHERE task_id = ?1",
        rusqlite::params![from_task, to_task],
    )?;

    Ok(())
}

/// Archives or restores a task.
///
/// Archiving takes the task out of the position sequence entirely (the unique
/// index on live positions is partial), so the column closes up behind it.
/// Restoring appends it to the end of its column.
///
/// The product spec's US-12 AC2 anticipated a task outliving its column and
/// needing a fallback. It cannot: `tasks.column_id` is a foreign key, deleting a
/// column either deletes its tasks or moves them — archived ones included — and
/// foreign keys are enforced on every connection. Code for that branch would be
/// unreachable and untestable, so there is none. See `docs/decision-log.md`.
pub fn set_archived(conn: &mut Connection, id: &str, archived: bool) -> AppResult<Task> {
    let task = find(conn, id)?;
    let now = now_ms();

    if archived {
        if task.archived_at.is_some() {
            return Ok(task);
        }

        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE tasks SET archived_at = ?2, position = -1, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![id, now],
        )?;
        ordering::compact(&tx, ordering::TASKS, Some(&task.column_id))?;
        tx.commit()?;

        return find(conn, id);
    }

    if task.archived_at.is_none() {
        return Ok(task);
    }

    let tx = conn.transaction()?;
    let position = ordering::next_position(&tx, ordering::TASKS, Some(&task.column_id))?;
    tx.execute(
        "UPDATE tasks SET archived_at = NULL, position = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, position, now],
    )?;
    ordering::assert_dense(&tx, ordering::TASKS, Some(&task.column_id))?;
    tx.commit()?;

    find(conn, id)
}

/// Where a task ended up, and the authoritative order of every column the move
/// touched.
///
/// Both columns are returned rather than just the destination: the source has
/// closed up behind the task, and a frontend that only heard about the
/// destination would keep showing a gap until the next full load.
#[derive(Debug, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "MoveResult.ts")]
pub struct MoveResult {
    pub task: Task,
    /// Whether anything was actually written.
    pub changed: bool,
    pub columns: Vec<ColumnOrder>,
}

#[derive(Debug, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ColumnOrder.ts")]
pub struct ColumnOrder {
    pub column_id: String,
    /// Live task ids, in order, position 0 first.
    pub task_ids: Vec<String>,
}

/// Moves a task to an index within a column, in one transaction.
///
/// **Idempotent for a no-op** (ADR-0005): moving a task to the position it
/// already holds writes nothing at all, and in particular does not touch
/// `updated_at` — a drag that ends where it started should not make the task
/// look edited.
///
/// An index past the end of the destination appends, which is what a drop below
/// the last card means.
pub fn move_to(
    conn: &mut Connection,
    id: &str,
    to_column_id: &str,
    to_index: i64,
) -> AppResult<MoveResult> {
    let task = find(conn, id)?;

    if task.archived_at.is_some() {
        return Err(AppError::Conflict {
            message: "Restore this task before moving it.".to_owned(),
        });
    }

    let destination = crate::db::columns::find(conn, to_column_id)?;
    if destination.board_id != task.board_id {
        return Err(AppError::Conflict {
            message: "A task can only move between columns on its own board.".to_owned(),
        });
    }

    let from_column = task.column_id.clone();
    let same_column = from_column == to_column_id;

    // Clamp before comparing, so "drop at the end" and "already at the end"
    // are recognised as the same place rather than writing a redundant move.
    let live_in_destination = live_count(conn, to_column_id)?;
    let last_index = if same_column {
        live_in_destination - 1
    } else {
        live_in_destination
    };
    let target_index = to_index.clamp(0, last_index.max(0));

    if same_column && target_index == task.position {
        return Ok(MoveResult {
            changed: false,
            columns: column_orders(conn, &[from_column])?,
            task,
        });
    }

    let tx = conn.transaction()?;

    if !same_column {
        // Parked at a free slot first; `place_at` then puts it where it belongs.
        // Writing straight to `target_index` would need the rows below it to
        // shift, which cannot be done in one statement without colliding with
        // the unique index — see `ordering::place_at`.
        let parking = ordering::next_position(&tx, ordering::TASKS, Some(to_column_id))?;
        tx.execute(
            "UPDATE tasks SET column_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1",
            rusqlite::params![id, to_column_id, parking, now_ms()],
        )?;
        ordering::compact(&tx, ordering::TASKS, Some(&from_column))?;
    } else {
        tx.execute(
            "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
            rusqlite::params![id, now_ms()],
        )?;
    }

    ordering::place_at(&tx, ordering::TASKS, Some(to_column_id), id, target_index)?;

    ordering::assert_dense(&tx, ordering::TASKS, Some(to_column_id))?;
    if !same_column {
        ordering::assert_dense(&tx, ordering::TASKS, Some(&from_column))?;
    }

    tx.commit()?;

    let touched = if same_column {
        vec![from_column]
    } else {
        vec![from_column, to_column_id.to_owned()]
    };

    Ok(MoveResult {
        changed: true,
        columns: column_orders(conn, &touched)?,
        task: find(conn, id)?,
    })
}

fn live_count(conn: &Connection, column_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE column_id = ?1 AND archived_at IS NULL",
        [column_id],
        |row| row.get(0),
    )?)
}

fn column_orders(conn: &Connection, column_ids: &[String]) -> AppResult<Vec<ColumnOrder>> {
    let mut statement = conn.prepare(
        "SELECT id FROM tasks WHERE column_id = ?1 AND archived_at IS NULL ORDER BY position",
    )?;

    column_ids
        .iter()
        .map(|column_id| {
            let task_ids = statement
                .query_map([column_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ColumnOrder {
                column_id: column_id.clone(),
                task_ids,
            })
        })
        .collect()
}

/// Deletes a task, returning everything needed to put it back.
pub fn delete(conn: &mut Connection, id: &str) -> AppResult<TaskSnapshot> {
    let task = find(conn, id)?;

    let tx = conn.transaction()?;
    let snapshot = snapshot_one(&tx, &task)?;
    tx.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::TASKS, Some(&task.column_id))?;
    tx.commit()?;

    Ok(snapshot)
}

/// A task and every row that `ON DELETE CASCADE` would take with it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "TaskSnapshot.ts")]
pub struct TaskSnapshot {
    pub task: Task,
    pub subtasks: Vec<SubtaskRow>,
    pub label_ids: Vec<String>,
    pub file_refs: Vec<FileRefRow>,
    pub link_refs: Vec<LinkRefRow>,
    #[ts(inline)]
    pub note_task_links: Vec<NoteTaskLinkRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "SubtaskRow.ts")]
pub struct SubtaskRow {
    pub id: String,
    pub title: String,
    pub done: bool,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "FileRefRow.ts")]
pub struct FileRefRow {
    pub id: String,
    pub path: String,
    pub display_name: String,
    #[ts(type = "number | null")]
    pub last_verified_at: Option<i64>,
    /// Whether the path resolved the last time it was checked. Stored rather
    /// than recomputed so the board can show a missing file without touching
    /// the filesystem on every render.
    pub found: bool,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "LinkRefRow.ts")]
pub struct LinkRefRow {
    pub id: String,
    pub url: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
}

/// The note-owned association row a task deletion would cascade away. The note
/// itself is not part of the task snapshot and remains stored independently.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteTaskLinkRow {
    pub note_id: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
}

fn load_subtasks(conn: &Connection, task_id: &str) -> AppResult<Vec<SubtaskRow>> {
    let mut statement = conn.prepare(
        "SELECT id, title, done, position, created_at, updated_at \
         FROM subtasks WHERE task_id = ?1 ORDER BY position",
    )?;
    let rows = statement.query_map([task_id], |row| {
        Ok(SubtaskRow {
            id: row.get("id")?,
            title: row.get("title")?,
            done: row.get("done")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn snapshot_one(conn: &Connection, task: &Task) -> AppResult<TaskSnapshot> {
    let mut labels = conn.prepare("SELECT label_id FROM task_labels WHERE task_id = ?1")?;
    let label_ids = labels
        .query_map([&task.id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut files = conn.prepare(
        "SELECT id, path, display_name, last_verified_at, found, position, created_at \
         FROM file_refs WHERE task_id = ?1 ORDER BY position",
    )?;
    let file_refs = files
        .query_map([&task.id], |row| {
            Ok(FileRefRow {
                id: row.get("id")?,
                path: row.get("path")?,
                display_name: row.get("display_name")?,
                last_verified_at: row.get("last_verified_at")?,
                found: row.get("found")?,
                position: row.get("position")?,
                created_at: row.get("created_at")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut links = conn.prepare(
        "SELECT id, url, position, created_at \
         FROM link_refs WHERE task_id = ?1 ORDER BY position",
    )?;
    let link_refs = links
        .query_map([&task.id], |row| {
            Ok(LinkRefRow {
                id: row.get("id")?,
                url: row.get("url")?,
                position: row.get("position")?,
                created_at: row.get("created_at")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut note_links = conn.prepare(
        "SELECT note_id, position, created_at \
         FROM note_task_links WHERE task_id = ?1 ORDER BY note_id, position",
    )?;
    let note_task_links = note_links
        .query_map([&task.id], |row| {
            Ok(NoteTaskLinkRow {
                note_id: row.get("note_id")?,
                position: row.get("position")?,
                created_at: row.get("created_at")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(TaskSnapshot {
        task: task.clone(),
        subtasks: load_subtasks(conn, &task.id)?,
        label_ids,
        file_refs,
        link_refs,
        note_task_links,
    })
}

/// Snapshots every task in a column, live and archived alike.
///
/// Archived ones are included deliberately: deleting the column deletes them
/// too, and an undo that quietly dropped the archive would be a lie.
pub fn snapshot_for_column(tx: &Transaction<'_>, column_id: &str) -> AppResult<Vec<TaskSnapshot>> {
    let mut statement = tx.prepare(&format!(
        "{SELECT} WHERE column_id = ?1 ORDER BY archived_at IS NOT NULL, position"
    ))?;
    let tasks = statement
        .query_map([column_id], row_to_task)?
        .collect::<Result<Vec<_>, _>>()?;

    tasks.iter().map(|task| snapshot_one(tx, task)).collect()
}

/// Re-inserts a task and its children exactly as they were.
pub fn reinsert(tx: &Transaction<'_>, snapshot: &TaskSnapshot) -> AppResult<()> {
    let position = snapshot.task.position;
    reinsert_at(tx, snapshot, position)
}

/// Re-inserts a task at a stated position rather than its recorded one.
///
/// Restoring into a column that has moved on needs a free slot first; the
/// caller then moves the row into place with `ordering::place_at`.
fn reinsert_at(tx: &Transaction<'_>, snapshot: &TaskSnapshot, position: i64) -> AppResult<()> {
    let task = &snapshot.task;

    tx.execute(
        "INSERT INTO tasks \
         (id, project_id, board_id, column_id, number, title, description, priority, due_date, \
          estimate_minutes, position, archived_at, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            task.id,
            task.project_id,
            task.board_id,
            task.column_id,
            task.number,
            task.title,
            task.description,
            task.priority,
            task.due_date,
            task.estimate_minutes,
            position,
            task.archived_at,
            task.created_at,
            task.updated_at
        ],
    )?;

    for subtask in &snapshot.subtasks {
        tx.execute(
            "INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                subtask.id,
                task.id,
                subtask.title,
                subtask.done,
                subtask.position,
                subtask.created_at,
                subtask.updated_at
            ],
        )?;
    }

    for label_id in &snapshot.label_ids {
        // A label deleted in the meantime is not a reason to refuse the whole
        // undo; the task matters more than one of its tags.
        tx.execute(
            "INSERT OR IGNORE INTO task_labels (task_id, label_id) \
             SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM labels WHERE id = ?2)",
            rusqlite::params![task.id, label_id],
        )?;
    }

    for file_ref in &snapshot.file_refs {
        tx.execute(
            "INSERT INTO file_refs \
             (id, task_id, path, display_name, last_verified_at, found, position, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                file_ref.id,
                task.id,
                file_ref.path,
                file_ref.display_name,
                file_ref.last_verified_at,
                file_ref.found,
                file_ref.position,
                file_ref.created_at
            ],
        )?;
    }

    for link_ref in &snapshot.link_refs {
        tx.execute(
            "INSERT INTO link_refs (id, task_id, url, position, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                link_ref.id,
                task.id,
                link_ref.url,
                link_ref.position,
                link_ref.created_at
            ],
        )?;
    }

    for note_link in &snapshot.note_task_links {
        // The note is independently owned and may have been deleted between
        // task deletion and undo. Its absence should not block restoring the
        // task; when it still exists, restore the exact ordered association.
        tx.execute(
            "INSERT INTO note_task_links (note_id, task_id, position, created_at) \
             SELECT ?1, ?2, ?3, ?4 \
             WHERE EXISTS ( \
               SELECT 1 FROM notes WHERE id = ?1 AND project_id = ?5 \
             )",
            rusqlite::params![
                note_link.note_id,
                task.id,
                note_link.position,
                note_link.created_at,
                task.project_id,
            ],
        )?;
    }

    Ok(())
}

/// Re-inserts a task into a column that has moved on since it was deleted.
///
/// Its old position may now be taken, so the rows at or after it shift right
/// and the sequence is compacted afterwards. The task lands where the user last
/// saw it, and the column stays dense.
pub fn reinsert_making_room(tx: &Transaction<'_>, snapshot: &TaskSnapshot) -> AppResult<()> {
    let task = &snapshot.task;

    if task.archived_at.is_some() {
        // Archived tasks are outside the position sequence entirely, so there
        // is no slot to make room for.
        return reinsert(tx, snapshot);
    }

    let free = ordering::next_position(tx, ordering::TASKS, Some(&task.column_id))?;
    reinsert_at(tx, snapshot, free)?;
    ordering::place_at(
        tx,
        ordering::TASKS,
        Some(&task.column_id),
        &task.id,
        task.position,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_copied_title_stays_within_the_limit() {
        let long = "x".repeat(validate::TASK_TITLE_MAX);
        let copied = copy_title(&long);

        assert!(copied.chars().count() <= validate::TASK_TITLE_MAX);
        assert!(copied.ends_with(" (copy)"));
    }

    #[test]
    fn a_short_title_is_copied_whole() {
        assert_eq!(copy_title("Write the spec"), "Write the spec (copy)");
    }
}
