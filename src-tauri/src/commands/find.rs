//! Search and saved filters.

use tauri::State;

use crate::db::saved_filters::{self, SavedFilter};
use crate::db::search::{self, SearchHit};
use crate::error::AppResult;
use crate::state::AppState;

/// The most results worth returning to a palette.
///
/// A list nobody scrolls past 50 entries of is a list that should have been
/// narrowed by typing more, and an unbounded limit turns a one-letter query into
/// a full table read.
const SEARCH_LIMIT: i64 = 50;

#[tauri::command]
pub fn tasks_search(state: State<'_, AppState>, query: String) -> AppResult<Vec<SearchHit>> {
    let database = state.database()?;
    search::search(database.connection(), &query, SEARCH_LIMIT)
}

#[tauri::command]
pub fn saved_filters_list(
    state: State<'_, AppState>,
    project_id: String,
) -> AppResult<Vec<SavedFilter>> {
    let database = state.database()?;
    saved_filters::list(database.connection(), &project_id)
}

#[tauri::command]
pub fn saved_filter_create(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    filter: String,
) -> AppResult<SavedFilter> {
    let mut database = state.database()?;
    saved_filters::create(database.connection_mut(), &project_id, &name, &filter)
}

#[tauri::command]
pub fn saved_filter_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut database = state.database()?;
    saved_filters::delete(database.connection_mut(), &id)
}
