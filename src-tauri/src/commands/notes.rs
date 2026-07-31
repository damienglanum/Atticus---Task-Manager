//! Notes, scoped to a project.

use tauri::State;

use crate::db::notes::{self, Note, NotePatch};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn notes_list(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<Note>> {
    let database = state.database()?;
    notes::list(database.connection(), &project_id)
}

#[tauri::command]
pub fn note_create(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
) -> AppResult<Note> {
    let mut database = state.database()?;
    notes::create(database.connection_mut(), &project_id, &title)
}

#[tauri::command]
pub fn note_update(state: State<'_, AppState>, id: String, patch: NotePatch) -> AppResult<Note> {
    let mut database = state.database()?;
    notes::update(database.connection_mut(), &id, &patch)
}

#[tauri::command]
pub fn note_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut database = state.database()?;
    notes::delete(database.connection_mut(), &id)
}
