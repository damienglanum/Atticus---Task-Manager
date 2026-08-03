//! The board read model.
//!
//! One command, a fixed number of queries, whatever the board holds. The target
//! it exists to meet is "no database query per rendered card" (product-spec §9),
//! and the way to meet that is structurally — by not offering a per-card read at
//! all — rather than by remembering not to call one.

use rmcp::schemars::JsonSchema;
use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use std::collections::HashMap;

use crate::db::columns::{self, Column};
use crate::db::tasks::Task;
use crate::error::AppResult;

#[derive(Debug, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "BoardSnapshot.ts")]
pub struct BoardSnapshot {
    pub board_id: String,
    pub columns: Vec<Column>,
    /// Live tasks only, ordered by column then position. The frontend groups
    /// them; the database does not need to send the same column id repeatedly
    /// in a nested shape.
    pub tasks: Vec<BoardTask>,
    /// Every label in the project, so a card can render its own without a
    /// lookup per label.
    pub labels: Vec<crate::db::labels::Label>,
    /// Archived tasks are not sent — the board does not show them — but the
    /// count is, so the UI can offer a way in without a second round trip.
    #[ts(type = "number")]
    pub archived_count: i64,
}

/// A task plus exactly what a card draws.
///
/// Subtask counts arrive as scalar subqueries on the task row rather than as a
/// second pass, and label ids as one grouped query for the whole board. Between
/// them that is what keeps a full board load at a fixed number of queries
/// however many cards it holds.
#[derive(Debug, Serialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "BoardTask.ts")]
pub struct BoardTask {
    #[serde(flatten)]
    #[ts(flatten)]
    pub task: Task,
    #[ts(type = "number")]
    pub subtask_count: i64,
    #[ts(type = "number")]
    pub subtasks_done: i64,
    pub label_ids: Vec<String>,
    /// True when at least one file reference was missing at its last check, so
    /// a card can flag it without touching the disk.
    pub has_missing_file: bool,
}

/// Loads everything the board renders.
///
/// Six reads, none of which depends on how many tasks or labels there are: the
/// board, its columns, its live tasks (with subtask counts and the missing-file
/// flag as scalar subqueries), every label link on the board in one grouped
/// pass, the project's labels, and the archived count. That fixed cost is the
/// property `board_load_issues_the_same_number_of_queries_whatever_the_board_holds`
/// asserts, and it is asserted rather than assumed.
pub fn load(conn: &Connection, board_id: &str) -> AppResult<BoardSnapshot> {
    let board = crate::db::boards::find(conn, board_id)?;

    let columns = columns::list(conn, board_id)?;

    let mut statement = conn.prepare(
        "SELECT t.id, t.project_id, t.board_id, t.column_id, t.number, t.title, t.description, \
                t.priority, t.due_date, t.estimate_minutes, t.position, t.archived_at, \
                t.created_at, t.updated_at, \
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_count, \
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) \
                    AS subtasks_done, \
                EXISTS (SELECT 1 FROM file_refs f WHERE f.task_id = t.id AND f.found = 0) \
                    AS has_missing_file \
         FROM tasks t \
         WHERE t.board_id = ?1 AND t.archived_at IS NULL \
         ORDER BY t.column_id, t.position",
    )?;
    let rows = statement
        .query_map([board_id], |row| {
            Ok((
                Task {
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
                },
                row.get::<_, i64>("subtask_count")?,
                row.get::<_, i64>("subtasks_done")?,
                row.get::<_, bool>("has_missing_file")?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // One query for every label link on the board, grouped in memory. The
    // alternative — a query per card — is the exact thing product-spec §9 rules
    // out.
    let mut links = conn.prepare(
        "SELECT tl.task_id, tl.label_id FROM task_labels tl \
         JOIN tasks t ON t.id = tl.task_id \
         WHERE t.board_id = ?1 AND t.archived_at IS NULL",
    )?;
    let mut by_task: HashMap<String, Vec<String>> = HashMap::new();
    for link in links.query_map([board_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (task_id, label_id) = link?;
        by_task.entry(task_id).or_default().push(label_id);
    }
    drop(links);

    let tasks = rows
        .into_iter()
        .map(|(task, subtask_count, subtasks_done, has_missing_file)| {
            let label_ids = by_task.remove(&task.id).unwrap_or_default();
            BoardTask {
                task,
                subtask_count,
                subtasks_done,
                label_ids,
                has_missing_file,
            }
        })
        .collect();

    // The project id comes from the board we already fetched, not a second
    // lookup — this read is measured, and a redundant query here is one the
    // counter would have to be told to expect.
    let labels = crate::db::labels::list(conn, &board.project_id)?;

    let archived_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE board_id = ?1 AND archived_at IS NOT NULL",
        [board_id],
        |row| row.get(0),
    )?;

    Ok(BoardSnapshot {
        board_id: board_id.to_owned(),
        columns,
        tasks,
        labels,
        archived_count,
    })
}

/// Archived tasks for a board, most recently archived first.
///
/// A separate command rather than part of the snapshot: the board never renders
/// these, and loading a year of archive on every board open to satisfy a panel
/// most people open rarely is the wrong trade.
pub fn archived(conn: &Connection, board_id: &str) -> AppResult<Vec<Task>> {
    let mut statement = conn.prepare(
        "SELECT id, project_id, board_id, column_id, number, title, description, priority, \
                due_date, estimate_minutes, position, archived_at, created_at, updated_at \
         FROM tasks \
         WHERE board_id = ?1 AND archived_at IS NOT NULL \
         ORDER BY archived_at DESC",
    )?;
    let tasks = statement
        .query_map([board_id], |row| {
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
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(tasks)
}
