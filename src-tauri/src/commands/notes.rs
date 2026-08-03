//! Notes, scoped to a project.

use tauri::State;

use crate::db::notes::{self, Note, NoteIndexItem, NotePatch};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn notes_list(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<Note>> {
    let database = state.database()?;
    notes::list(database.connection(), &project_id)
}

#[tauri::command]
pub fn notes_list_all(state: State<'_, AppState>) -> AppResult<Vec<NoteIndexItem>> {
    let database = state.database()?;
    notes::list_all(database.connection())
}

#[tauri::command]
pub fn note_create(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
) -> AppResult<Note> {
    let mut database = state.database()?;
    notes::create(database.connection_mut(), &project_id, &title, "", &[])
}

#[tauri::command]
pub fn note_update(
    state: State<'_, AppState>,
    id: String,
    expected_updated_at: i64,
    patch: NotePatch,
) -> AppResult<Note> {
    let mut database = state.database()?;
    notes::update_if_current(database.connection_mut(), &id, expected_updated_at, &patch)
}

#[tauri::command]
pub fn note_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut database = state.database()?;
    notes::delete(database.connection_mut(), &id)
}
