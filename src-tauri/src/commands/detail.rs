//! Task detail: subtasks, labels, file references, and web links.

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::file_refs::{self, FileRef};
use crate::db::labels::{self, Label, LabelInput};
use crate::db::link_refs::{self, LinkRef};
use crate::db::subtasks::{self, Subtask, SubtaskPatch};
use crate::db::tasks::{self, Task};
use crate::db::undo::UndoToken;
use crate::error::AppResult;
use crate::state::AppState;

use super::board::UndoRecord;

/// Everything the task editor shows, in one command.
///
/// One round trip rather than four, and it is also where file references are
/// re-verified — opening the editor is exactly the moment the user is about to
/// look at them, and the only moment worth touching the disk (ADR-0007).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "TaskDetail.ts")]
pub struct TaskDetail {
    pub task: Task,
    pub subtasks: Vec<Subtask>,
    pub label_ids: Vec<String>,
    pub file_refs: Vec<FileRef>,
    /// The project's labels, so the picker needs no second call.
    pub available_labels: Vec<Label>,
    pub link_refs: Vec<LinkRef>,
}

#[tauri::command]
pub fn task_detail(state: State<'_, AppState>, id: String) -> AppResult<TaskDetail> {
    let database = state.database()?;
    let conn = database.connection();

    let task = tasks::find(conn, &id)?;

    Ok(TaskDetail {
        subtasks: subtasks::list(conn, &id)?,
        label_ids: labels::for_task(conn, &id)?,
        file_refs: file_refs::verify_for_task(conn, &id)?,
        link_refs: link_refs::list(conn, &id)?,
        available_labels: labels::list(conn, &task.project_id)?,
        task,
    })
}

// --- Subtasks --------------------------------------------------------------

#[tauri::command]
pub fn subtask_create(
    state: State<'_, AppState>,
    task_id: String,
    title: String,
) -> AppResult<Subtask> {
    let mut database = state.database()?;
    subtasks::create(database.connection_mut(), &task_id, &title)
}

#[tauri::command]
pub fn subtask_update(
    state: State<'_, AppState>,
    id: String,
    patch: SubtaskPatch,
) -> AppResult<Subtask> {
    let database = state.database()?;
    subtasks::update(database.connection(), &id, patch)
}

#[tauri::command]
pub fn subtask_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut database = state.database()?;
    subtasks::delete(database.connection_mut(), &id)
}

#[tauri::command]
pub fn subtasks_reorder(
    state: State<'_, AppState>,
    task_id: String,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<Subtask>> {
    let mut database = state.database()?;
    subtasks::reorder(database.connection_mut(), &task_id, &ordered_ids)
}

// --- Labels ----------------------------------------------------------------

#[tauri::command]
pub fn labels_list(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<Label>> {
    let database = state.database()?;
    labels::list(database.connection(), &project_id)
}

#[tauri::command]
pub fn label_create(
    state: State<'_, AppState>,
    project_id: String,
    input: LabelInput,
) -> AppResult<Label> {
    let database = state.database()?;
    labels::create(database.connection(), &project_id, input)
}

#[tauri::command]
pub fn label_update(state: State<'_, AppState>, id: String, input: LabelInput) -> AppResult<Label> {
    let database = state.database()?;
    labels::update(database.connection(), &id, input)
}

/// How many tasks carry a label, so its delete confirmation can state a number
/// rather than a warning (US-14 AC3).
#[tauri::command]
pub fn label_usage_count(state: State<'_, AppState>, id: String) -> AppResult<i64> {
    let database = state.database()?;
    labels::usage_count(database.connection(), &id)
}

#[tauri::command]
pub fn label_delete(state: State<'_, AppState>, id: String) -> AppResult<UndoRecord> {
    let mut database = state.database()?;
    let deleted = labels::delete(database.connection_mut(), &id)?;
    drop(database);

    Ok(state.remember_undo(UndoToken::LabelDeleted(Box::new(deleted))))
}

#[tauri::command]
pub fn task_set_labels(
    state: State<'_, AppState>,
    task_id: String,
    label_ids: Vec<String>,
) -> AppResult<Vec<String>> {
    let mut database = state.database()?;
    labels::set_for_task(database.connection_mut(), &task_id, &label_ids)?;
    labels::for_task(database.connection(), &task_id)
}

// --- File references -------------------------------------------------------

#[tauri::command]
pub fn file_ref_add(
    state: State<'_, AppState>,
    task_id: String,
    path: String,
) -> AppResult<FileRef> {
    let mut database = state.database()?;
    file_refs::add(database.connection_mut(), &task_id, &path, None)
}

#[tauri::command]
pub fn file_ref_relocate(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> AppResult<FileRef> {
    let database = state.database()?;
    file_refs::relocate(database.connection(), &id, &path)
}

#[tauri::command]
pub fn file_ref_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut database = state.database()?;
    file_refs::remove(database.connection_mut(), &id)
}

#[tauri::command]
pub fn file_refs_verify(state: State<'_, AppState>, task_id: String) -> AppResult<Vec<FileRef>> {
    let database = state.database()?;
    file_refs::verify_for_task(database.connection(), &task_id)
}

/// Shows a referenced file in Finder.
///
/// The path comes from the database, never from the caller: the frontend passes
/// a reference id, so there is no argument through which the webview could ask
/// for an arbitrary location. The file is revealed, never read (ADR-0007).
#[tauri::command]
pub fn file_ref_reveal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;

    let database = state.database()?;
    let file_ref = file_refs::find(database.connection(), &id)?;
    drop(database);

    if !std::path::Path::new(&file_ref.path).exists() {
        return Err(crate::error::AppError::NotFound {
            entity: "file".to_owned(),
            id: file_ref.path,
        });
    }

    app.opener()
        .reveal_item_in_dir(&file_ref.path)
        .map_err(|error| crate::error::AppError::internal(format!("could not reveal: {error}")))
}

// --- Web links -------------------------------------------------------------

#[tauri::command]
pub fn link_ref_add(
    state: State<'_, AppState>,
    task_id: String,
    url: String,
) -> AppResult<LinkRef> {
    let mut database = state.database()?;
    link_refs::add(database.connection_mut(), &task_id, &url)
}

#[tauri::command]
pub fn link_ref_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut database = state.database()?;
    link_refs::remove(database.connection_mut(), &id)
}
