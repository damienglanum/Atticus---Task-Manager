//! Columns, tasks, and the board read model.
//!
//! Every command that removes something returns an [`UndoRecord`] rather than
//! `()`. The token is pushed onto the session's stack here, in one place, so no
//! command can quietly be undoable in the backend but not offered in the UI, or
//! the reverse.

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::board_view::{self, BoardSnapshot};
use crate::db::columns::{self, Column, ColumnDisposition, ColumnSettings};
use crate::db::tasks::{self, MoveResult, NewTask, Task, TaskPatch};
use crate::db::undo::UndoToken;
use crate::error::AppResult;
use crate::state::AppState;

/// The result of an undoable operation: what it did, and how to take it back.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "UndoRecord.ts")]
pub struct UndoRecord {
    /// What the toast says was done. Produced by the token itself so the
    /// sentence and the operation cannot drift apart.
    pub description: String,
    pub token: UndoToken,
}

impl UndoRecord {
    pub(crate) fn new(token: UndoToken) -> Self {
        Self {
            description: token.description(),
            token,
        }
    }
}

// --- Read ------------------------------------------------------------------

#[tauri::command]
pub fn board_load(state: State<'_, AppState>, board_id: String) -> AppResult<BoardSnapshot> {
    let database = state.database()?;
    board_view::load(database.connection(), &board_id)
}

#[tauri::command]
pub fn board_archived_tasks(state: State<'_, AppState>, board_id: String) -> AppResult<Vec<Task>> {
    let database = state.database()?;
    board_view::archived(database.connection(), &board_id)
}

// --- Columns ---------------------------------------------------------------

#[tauri::command]
pub fn column_create(
    state: State<'_, AppState>,
    board_id: String,
    name: String,
) -> AppResult<Column> {
    let mut database = state.database()?;
    columns::create(database.connection_mut(), &board_id, &name)
}

#[tauri::command]
pub fn column_update(
    state: State<'_, AppState>,
    id: String,
    settings: ColumnSettings,
) -> AppResult<Column> {
    let database = state.database()?;
    columns::update(database.connection(), &id, settings)
}

/// How many live tasks a column holds, so the delete dialog can say so before
/// the user commits to anything.
#[tauri::command]
pub fn column_task_count(state: State<'_, AppState>, id: String) -> AppResult<i64> {
    let database = state.database()?;
    columns::live_task_count(database.connection(), &id)
}

#[tauri::command]
pub fn column_delete(
    state: State<'_, AppState>,
    id: String,
    disposition: ColumnDisposition,
) -> AppResult<UndoRecord> {
    let mut database = state.database()?;
    let deleted = columns::delete(database.connection_mut(), &id, &disposition)?;
    drop(database);

    Ok(state.remember_undo(UndoToken::ColumnDeleted(Box::new(deleted))))
}

#[tauri::command]
pub fn columns_reorder(
    state: State<'_, AppState>,
    board_id: String,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<Column>> {
    let mut database = state.database()?;
    columns::reorder(database.connection_mut(), &board_id, &ordered_ids)
}

// --- Tasks -----------------------------------------------------------------

#[tauri::command]
pub fn task_create(state: State<'_, AppState>, input: NewTask) -> AppResult<Task> {
    let mut database = state.database()?;
    tasks::create(database.connection_mut(), input)
}

#[tauri::command]
pub fn task_update(state: State<'_, AppState>, id: String, patch: TaskPatch) -> AppResult<Task> {
    let database = state.database()?;
    tasks::update(database.connection(), &id, patch)
}

#[tauri::command]
pub fn task_duplicate(state: State<'_, AppState>, id: String) -> AppResult<Task> {
    let mut database = state.database()?;
    tasks::duplicate(database.connection_mut(), &id)
}

#[tauri::command]
pub fn task_set_archived(
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> AppResult<ArchiveResult> {
    let mut database = state.database()?;
    let task = tasks::set_archived(database.connection_mut(), &id, archived)?;
    drop(database);

    let undo = state.remember_undo(UndoToken::TaskArchiveChanged {
        task_id: id,
        was_archived: !archived,
    });

    Ok(ArchiveResult { task, undo })
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ArchiveResult.ts")]
pub struct ArchiveResult {
    pub task: Task,
    pub undo: UndoRecord,
}

/// Moves a task, and hands back how to move it back.
///
/// A no-op move returns `changed: false` and **no undo record**: there is
/// nothing to reverse, and offering an Undo for a drag that did nothing would be
/// noise at best and confusing at worst.
#[tauri::command]
pub fn task_move(
    state: State<'_, AppState>,
    id: String,
    to_column_id: String,
    to_index: i64,
) -> AppResult<MoveOutcome> {
    let mut database = state.database()?;
    let before = tasks::find(database.connection(), &id)?;
    let result = tasks::move_to(database.connection_mut(), &id, &to_column_id, to_index)?;
    drop(database);

    let undo = result.changed.then(|| {
        state.remember_undo(UndoToken::TaskMoved {
            task_id: id,
            from_column_id: before.column_id,
            from_index: before.position,
        })
    });

    Ok(MoveOutcome { result, undo })
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "MoveOutcome.ts")]
pub struct MoveOutcome {
    pub result: MoveResult,
    pub undo: Option<UndoRecord>,
}

#[tauri::command]
pub fn task_delete(state: State<'_, AppState>, id: String) -> AppResult<UndoRecord> {
    let mut database = state.database()?;
    let snapshot = tasks::delete(database.connection_mut(), &id)?;
    drop(database);

    Ok(state.remember_undo(UndoToken::TaskDeleted(Box::new(snapshot))))
}

// --- Undo ------------------------------------------------------------------

/// Reverses the most recent undoable operation.
///
/// Takes no token: the stack is the source of truth, so the frontend cannot
/// replay a stale token or apply one twice. The toast's Undo button and `⌘Z`
/// both land here.
#[tauri::command]
pub fn undo_last(state: State<'_, AppState>) -> AppResult<Option<String>> {
    state.undo_last()
}

/// Whether there is anything to undo, so the menu item can be disabled honestly.
#[tauri::command]
pub fn undo_available(state: State<'_, AppState>) -> AppResult<bool> {
    state.undo_available()
}
