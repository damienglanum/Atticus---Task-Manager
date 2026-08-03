//! Project notes and their optional ordered task associations.

use std::collections::{HashMap, HashSet};

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
#[ts(export, export_to = "Note.ts")]
pub struct Note {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub body: String,
    /// Complete ordered task association set. Every task belongs to this
    /// note's project.
    pub task_ids: Vec<String>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// Lightweight workspace-index row. Full Markdown bodies and task IDs stay on
/// the project-scoped note read path and are loaded only when an editor opens.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "NoteIndexItem.ts")]
pub struct NoteIndexItem {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub excerpt: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    #[ts(type = "number")]
    pub task_count: i64,
}

/// A partial update. An absent field means "leave it alone", which is what lets
/// the editor save a title without having to send the whole body back.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "NotePatch.ts")]
pub struct NotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    /// When present, replaces the complete ordered association set. An empty
    /// list deliberately clears it; absence leaves it unchanged.
    pub task_ids: Option<Vec<String>>,
}

/// A deliberately bounded search read model: a matching note body can be
/// 200,000 characters, so search returns an excerpt rather than the full note.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchHit {
    pub note_id: String,
    pub project_id: String,
    pub title: String,
    pub excerpt: String,
    pub updated_at: i64,
    pub task_ids: Vec<String>,
}

const SELECT: &str =
    "SELECT id, project_id, title, body, position, created_at, updated_at FROM notes";

fn row_to_note(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        body: row.get("body")?,
        task_ids: Vec::new(),
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list(conn: &Connection, project_id: &str) -> AppResult<Vec<Note>> {
    let mut statement =
        conn.prepare(&format!("{SELECT} WHERE project_id = ?1 ORDER BY position"))?;
    let rows = statement.query_map([project_id], row_to_note)?;
    let mut notes = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    hydrate_notes(conn, &mut notes)?;
    Ok(notes)
}

const NOTE_INDEX_EXCERPT_CHARS: i64 = 240;

/// Lists notes for the workspace-wide All Notes view.
///
/// The view follows the same visibility boundary as the active project list:
/// archived projects are excluded, while active MCP-managed projects remain
/// visible. The flat result is grouped deterministically by project display
/// order and then note display order so the frontend does not have to recreate
/// database ordering rules.
pub fn list_all(conn: &Connection) -> AppResult<Vec<NoteIndexItem>> {
    let mut statement = conn.prepare(
        "SELECT notes.id, notes.project_id, notes.title, \
                substr(notes.body, 1, ?1) AS excerpt, notes.position, notes.updated_at, \
                (SELECT COUNT(*) FROM note_task_links link \
                 WHERE link.note_id = notes.id) AS task_count \
         FROM notes \
         JOIN projects project ON project.id = notes.project_id \
         WHERE project.archived_at IS NULL \
         ORDER BY project.position, project.id, notes.position, notes.id",
    )?;
    let rows = statement.query_map([NOTE_INDEX_EXCERPT_CHARS], |row| {
        Ok(NoteIndexItem {
            id: row.get("id")?,
            project_id: row.get("project_id")?,
            title: row.get("title")?,
            excerpt: row.get("excerpt")?,
            position: row.get("position")?,
            updated_at: row.get("updated_at")?,
            task_count: row.get("task_count")?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<Note> {
    let mut note = conn
        .query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_note)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "note".to_owned(),
            id: id.to_owned(),
        })?;
    note.task_ids = load_task_ids(conn, id)?;
    Ok(note)
}

fn hydrate_notes(conn: &Connection, notes: &mut [Note]) -> AppResult<()> {
    let mut statement =
        conn.prepare("SELECT task_id FROM note_task_links WHERE note_id = ?1 ORDER BY position")?;
    for note in notes {
        let rows = statement.query_map([&note.id], |row| row.get::<_, String>(0))?;
        note.task_ids = rows.collect::<Result<Vec<_>, _>>()?;
    }
    Ok(())
}

fn load_task_ids(conn: &Connection, note_id: &str) -> AppResult<Vec<String>> {
    let mut statement =
        conn.prepare("SELECT task_id FROM note_task_links WHERE note_id = ?1 ORDER BY position")?;
    let rows = statement.query_map([note_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Validates the caller-supplied complete association set while the write
/// transaction is holding its lock, avoiding a task-delete race between the
/// ownership check and link insertion.
fn validate_task_ids(conn: &Connection, project_id: &str, task_ids: &[String]) -> AppResult<()> {
    let mut seen = HashSet::with_capacity(task_ids.len());

    for task_id in task_ids {
        if !seen.insert(task_id.as_str()) {
            return Err(AppError::validation(
                "taskIds",
                format!("Task {task_id} is listed more than once."),
            ));
        }

        let owner = conn
            .query_row(
                "SELECT project_id FROM tasks WHERE id = ?1",
                [task_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        let Some(owner) = owner else {
            return Err(AppError::NotFound {
                entity: "task".to_owned(),
                id: task_id.clone(),
            });
        };
        if owner != project_id {
            return Err(AppError::Conflict {
                message: format!(
                    "Task {task_id} belongs to another project. A note can only link to tasks in its own project."
                ),
            });
        }
    }

    Ok(())
}

fn insert_task_links(
    conn: &Connection,
    note_id: &str,
    task_ids: &[String],
    existing_created_at: &HashMap<String, i64>,
    created_at: i64,
) -> AppResult<()> {
    let mut insert = conn.prepare(
        "INSERT INTO note_task_links (note_id, task_id, position, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
    )?;
    for (position, task_id) in task_ids.iter().enumerate() {
        let position = i64::try_from(position)
            .map_err(|_| AppError::validation("taskIds", "There are too many linked tasks."))?;
        let linked_at = existing_created_at
            .get(task_id)
            .copied()
            .unwrap_or(created_at);
        insert.execute(rusqlite::params![note_id, task_id, position, linked_at])?;
    }
    Ok(())
}

fn replace_task_links(
    conn: &Connection,
    note_id: &str,
    task_ids: &[String],
    created_at: i64,
) -> AppResult<()> {
    let existing_created_at = {
        let mut statement =
            conn.prepare("SELECT task_id, created_at FROM note_task_links WHERE note_id = ?1")?;
        let rows = statement.query_map([note_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        rows.collect::<Result<HashMap<_, _>, _>>()?
    };

    conn.execute("DELETE FROM note_task_links WHERE note_id = ?1", [note_id])?;
    insert_task_links(conn, note_id, task_ids, &existing_created_at, created_at)
}

pub fn create(
    conn: &mut Connection,
    project_id: &str,
    title: &str,
    body: &str,
    task_ids: &[String],
) -> AppResult<Note> {
    let title = validate::required_text("title", title, validate::NOTE_TITLE_MAX)?;
    let body = validate::optional_text("body", body, validate::NOTE_BODY_MAX)?;

    let id = new_id();
    let now = now_ms();

    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    crate::db::projects::find(&tx, project_id)?;
    validate_task_ids(&tx, project_id, task_ids)?;
    let position = ordering::next_position(&tx, ordering::NOTES, Some(project_id))?;
    tx.execute(
        "INSERT INTO notes (id, project_id, title, body, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        rusqlite::params![id, project_id, title, body, position, now],
    )?;
    insert_task_links(&tx, &id, task_ids, &HashMap::new(), now)?;
    tx.commit()?;

    find(conn, &id)
}

pub fn update_if_current(
    conn: &mut Connection,
    id: &str,
    expected_updated_at: i64,
    patch: &NotePatch,
) -> AppResult<Note> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing = find(&tx, id)?;
    if existing.updated_at != expected_updated_at {
        return Err(stale_note_error(
            id,
            expected_updated_at,
            existing.updated_at,
        ));
    }

    // Validated before anything is written, so a rejected title cannot leave a
    // saved body or partially replaced task list behind it.
    let title = match patch.title.as_deref() {
        Some(value) => validate::required_text("title", value, validate::NOTE_TITLE_MAX)?,
        None => existing.title,
    };
    let body = match patch.body.as_deref() {
        Some(value) => validate::optional_text("body", value, validate::NOTE_BODY_MAX)?,
        None => existing.body,
    };
    if let Some(task_ids) = patch.task_ids.as_deref() {
        validate_task_ids(&tx, &existing.project_id, task_ids)?;
    }

    let minimum_updated_at =
        existing
            .updated_at
            .checked_add(1)
            .ok_or_else(|| AppError::Conflict {
                message: format!("Note {id} has exhausted its timestamp version range."),
            })?;
    let updated_at = now_ms().max(minimum_updated_at);

    let changed = tx.execute(
        "UPDATE notes SET title = ?2, body = ?3, updated_at = ?4 \
         WHERE id = ?1 AND updated_at = ?5",
        rusqlite::params![id, title, body, updated_at, expected_updated_at],
    )?;
    if changed == 0 {
        let current = find(&tx, id)?;
        return Err(stale_note_error(
            id,
            expected_updated_at,
            current.updated_at,
        ));
    }

    if let Some(task_ids) = patch.task_ids.as_deref() {
        replace_task_links(&tx, id, task_ids, updated_at)?;
    }

    tx.commit()?;

    find(conn, id)
}

fn stale_note_error(id: &str, expected_updated_at: i64, current_updated_at: i64) -> AppError {
    AppError::Conflict {
        message: format!(
            "Note {id} changed after it was read (expected updatedAt {expected_updated_at}, current {current_updated_at}). Read it again, merge with the current state, and retry using the new updatedAt."
        ),
    }
}

const MAX_SEARCH_RESULTS: i64 = 100;

fn row_to_search_hit(row: &Row<'_>) -> rusqlite::Result<NoteSearchHit> {
    Ok(NoteSearchHit {
        note_id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        excerpt: row.get("excerpt")?,
        updated_at: row.get("updated_at")?,
        task_ids: Vec::new(),
    })
}

/// Searches project-note titles and bodies, returning at most 100 bounded hits.
/// Empty or punctuation-only queries return no matches rather than exposing
/// FTS5's query language or producing a syntax error.
pub fn search(
    conn: &Connection,
    query: &str,
    project_id: Option<&str>,
    limit: i64,
) -> AppResult<Vec<NoteSearchHit>> {
    let limit = limit.clamp(0, MAX_SEARCH_RESULTS);
    if limit == 0 {
        return Ok(Vec::new());
    }
    let Some(query) = crate::db::search::to_fts_query(query) else {
        return Ok(Vec::new());
    };

    const COLUMNS: &str = "note.id, note.project_id, note.title, note.updated_at, \
         substr(snippet(notes_fts, 1, '', '', '…', 24), 1, 500) AS excerpt";

    let mut hits = if let Some(project_id) = project_id {
        let mut statement = conn.prepare(&format!(
            "SELECT {COLUMNS} \
             FROM notes_fts \
             JOIN notes note ON note.rowid = notes_fts.rowid \
             WHERE notes_fts MATCH ?1 AND note.project_id = ?2 \
             ORDER BY bm25(notes_fts, 10.0, 1.0), note.updated_at DESC, note.id \
             LIMIT ?3"
        ))?;
        let rows = statement.query_map(
            rusqlite::params![query, project_id, limit],
            row_to_search_hit,
        )?;
        rows.collect::<Result<Vec<_>, _>>()?
    } else {
        let mut statement = conn.prepare(&format!(
            "SELECT {COLUMNS} \
             FROM notes_fts \
             JOIN notes note ON note.rowid = notes_fts.rowid \
             WHERE notes_fts MATCH ?1 \
             ORDER BY bm25(notes_fts, 10.0, 1.0), note.updated_at DESC, note.id \
             LIMIT ?2"
        ))?;
        let rows = statement.query_map(rusqlite::params![query, limit], row_to_search_hit)?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for hit in &mut hits {
        hit.task_ids = load_task_ids(conn, &hit.note_id)?;
    }
    Ok(hits)
}

pub fn delete(conn: &mut Connection, id: &str) -> AppResult<()> {
    let existing = find(conn, id)?;

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    ordering::compact(&tx, ordering::NOTES, Some(&existing.project_id))?;
    tx.commit()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::projects::NewProject;
    use crate::db::tasks::{self, NewTask};
    use crate::db::Database;

    /// A real database with foreign keys on, and one project to hang notes off.
    fn fixture() -> (Database, String) {
        let mut db = Database::open_in_memory().expect("database");
        let (project, _board_id) = crate::db::projects::create(
            db.connection_mut(),
            NewProject {
                name: "Atticus".to_owned(),
                description: String::new(),
                color: "cyan".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("project");
        let id = project.id.clone();
        (db, id)
    }

    fn add_task(database: &mut Database, project_id: &str, title: &str) -> String {
        let column_id = database
            .connection()
            .query_row(
                "SELECT column.id FROM board_columns column \
                 JOIN boards board ON board.id = column.board_id \
                 WHERE board.project_id = ?1 ORDER BY board.position, column.position LIMIT 1",
                [project_id],
                |row| row.get::<_, String>(0),
            )
            .expect("project's first column");
        tasks::create(
            database.connection_mut(),
            NewTask {
                column_id,
                title: title.to_owned(),
            },
        )
        .expect("task")
        .id
    }

    fn add_project(database: &mut Database, name: &str) -> String {
        crate::db::projects::create(
            database.connection_mut(),
            NewProject {
                name: name.to_owned(),
                description: String::new(),
                color: "blue".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("project")
        .0
        .id
    }

    fn add_mcp_project(database: &mut Database, name: &str) -> String {
        crate::db::projects::create_mcp(
            database.connection_mut(),
            NewProject {
                name: name.to_owned(),
                description: String::new(),
                color: "cyan".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("MCP-managed project")
        .0
        .id
    }

    #[test]
    fn list_all_returns_a_bounded_active_workspace_index_in_display_order() {
        let (mut database, first_project) = fixture();
        let second_project = add_project(&mut database, "Second");
        let mcp_project = add_mcp_project(&mut database, "AI workspace");
        let archived_project = add_project(&mut database, "Archived");

        let linked_task = add_task(&mut database, &first_project, "Linked task");
        let first_note = create(
            database.connection_mut(),
            &first_project,
            "First note",
            "",
            &[],
        )
        .expect("first note");
        let linked_body = format!("Project context {}", "x".repeat(400));
        let linked_note = create(
            database.connection_mut(),
            &first_project,
            "Linked note",
            &linked_body,
            std::slice::from_ref(&linked_task),
        )
        .expect("linked note");
        let second_note = create(
            database.connection_mut(),
            &second_project,
            "Second project note",
            "",
            &[],
        )
        .expect("second project note");
        let mcp_note = create(
            database.connection_mut(),
            &mcp_project,
            "AI project note",
            "",
            &[],
        )
        .expect("MCP-managed note");
        let archived_note = create(
            database.connection_mut(),
            &archived_project,
            "Archived note",
            "",
            &[],
        )
        .expect("archived note");

        crate::db::projects::reorder(
            database.connection_mut(),
            &[
                mcp_project,
                archived_project.clone(),
                second_project,
                first_project,
            ],
        )
        .expect("reorders projects");
        crate::db::projects::set_archived(database.connection_mut(), &archived_project, true)
            .expect("archives project");

        let notes = list_all(database.connection()).expect("lists all active notes");

        assert_eq!(
            notes
                .iter()
                .map(|note| note.id.as_str())
                .collect::<Vec<_>>(),
            [
                mcp_note.id.as_str(),
                second_note.id.as_str(),
                first_note.id.as_str(),
                linked_note.id.as_str(),
            ]
        );
        assert_eq!(notes[3].task_count, 1);
        assert_eq!(
            notes[3].excerpt,
            linked_body
                .chars()
                .take(NOTE_INDEX_EXCERPT_CHARS as usize)
                .collect::<String>()
        );
        assert_eq!(notes[3].excerpt.chars().count(), 240);
        let serialized = serde_json::to_value(&notes[3]).expect("serializes index item");
        assert!(serialized.get("body").is_none());
        assert!(serialized.get("taskIds").is_none());
        assert!(notes.iter().all(|note| note.id != archived_note.id));
    }

    #[test]
    fn a_new_note_starts_with_an_empty_body_rather_than_a_placeholder() {
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();

        let note = create(conn, &project_id, "Release plan", "", &[]).expect("creates");

        assert_eq!(note.title, "Release plan");
        assert_eq!(note.body, "");
        assert!(note.task_ids.is_empty());
    }

    #[test]
    fn create_saves_body_and_ordered_task_associations() {
        let (mut database, project_id) = fixture();
        let first = add_task(&mut database, &project_id, "First task");
        let second = add_task(&mut database, &project_id, "Second task");

        let note = create(
            database.connection_mut(),
            &project_id,
            "Release plan",
            "Long-form context",
            &[second.clone(), first.clone()],
        )
        .expect("creates");

        assert_eq!(note.body, "Long-form context");
        assert_eq!(note.task_ids, [second, first]);
        let stored_positions: Vec<i64> = {
            let mut statement = database
                .connection()
                .prepare(
                    "SELECT position FROM note_task_links WHERE note_id = ?1 ORDER BY position",
                )
                .expect("statement");
            statement
                .query_map([&note.id], |row| row.get(0))
                .expect("query")
                .collect::<Result<_, _>>()
                .expect("positions")
        };
        assert_eq!(stored_positions, [0, 1]);
    }

    #[test]
    fn an_absent_field_leaves_the_stored_value_alone() {
        // The property the editor depends on: saving a title must not blank the
        // body, and a patch is the only thing standing between them.
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();

        let note = create(conn, &project_id, "Release plan", "", &[]).expect("creates");
        let with_body = update_if_current(
            conn,
            &note.id,
            note.updated_at,
            &NotePatch {
                body: Some("The body".to_owned()),
                ..NotePatch::default()
            },
        )
        .expect("writes the body");

        let after = update_if_current(
            conn,
            &note.id,
            with_body.updated_at,
            &NotePatch {
                title: Some("Renamed".to_owned()),
                ..NotePatch::default()
            },
        )
        .expect("writes the title");

        assert_eq!(after.title, "Renamed");
        assert_eq!(after.body, "The body");
    }

    #[test]
    fn replacement_task_ids_are_complete_ordered_and_preserve_existing_link_age() {
        let (mut database, project_id) = fixture();
        let first = add_task(&mut database, &project_id, "First");
        let second = add_task(&mut database, &project_id, "Second");
        let third = add_task(&mut database, &project_id, "Third");
        let note = create(
            database.connection_mut(),
            &project_id,
            "Plan",
            "",
            &[first.clone(), second.clone()],
        )
        .expect("note");
        let first_linked_at: i64 = database
            .connection()
            .query_row(
                "SELECT created_at FROM note_task_links WHERE note_id = ?1 AND task_id = ?2",
                rusqlite::params![note.id, first],
                |row| row.get(0),
            )
            .expect("created at");

        let replaced = update_if_current(
            database.connection_mut(),
            &note.id,
            note.updated_at,
            &NotePatch {
                task_ids: Some(vec![third.clone(), first.clone()]),
                ..NotePatch::default()
            },
        )
        .expect("replace");

        assert_eq!(replaced.task_ids, [third, first.clone()]);
        let preserved: i64 = database
            .connection()
            .query_row(
                "SELECT created_at FROM note_task_links WHERE note_id = ?1 AND task_id = ?2",
                rusqlite::params![note.id, first],
                |row| row.get(0),
            )
            .expect("created at");
        assert_eq!(preserved, first_linked_at);

        let cleared = update_if_current(
            database.connection_mut(),
            &note.id,
            replaced.updated_at,
            &NotePatch {
                task_ids: Some(Vec::new()),
                ..NotePatch::default()
            },
        )
        .expect("clear");
        assert!(cleared.task_ids.is_empty());
    }

    #[test]
    fn stale_updates_change_neither_fields_nor_task_links() {
        let (mut database, project_id) = fixture();
        let first = add_task(&mut database, &project_id, "First");
        let second = add_task(&mut database, &project_id, "Second");
        let note = create(
            database.connection_mut(),
            &project_id,
            "Plan",
            "old body",
            &[first],
        )
        .expect("note");

        let fresh = update_if_current(
            database.connection_mut(),
            &note.id,
            note.updated_at,
            &NotePatch {
                body: Some("fresh body".to_owned()),
                task_ids: Some(vec![second.clone()]),
                ..NotePatch::default()
            },
        )
        .expect("fresh update");
        assert!(fresh.updated_at > note.updated_at);

        let stale = update_if_current(
            database.connection_mut(),
            &note.id,
            note.updated_at,
            &NotePatch {
                body: Some("stale body".to_owned()),
                task_ids: Some(Vec::new()),
                ..NotePatch::default()
            },
        )
        .expect_err("stale update");
        assert!(matches!(stale, AppError::Conflict { .. }));

        let stored = find(database.connection(), &note.id).expect("note remains");
        assert_eq!(stored.body, "fresh body");
        assert_eq!(stored.task_ids, [second]);
        assert_eq!(stored.updated_at, fresh.updated_at);
    }

    #[test]
    fn rapid_updates_always_advance_the_timestamp() {
        let (mut database, project_id) = fixture();
        let note = create(database.connection_mut(), &project_id, "Plan", "", &[]).expect("note");

        let first = update_if_current(
            database.connection_mut(),
            &note.id,
            note.updated_at,
            &NotePatch {
                body: Some("one".to_owned()),
                ..NotePatch::default()
            },
        )
        .expect("first");
        let second = update_if_current(
            database.connection_mut(),
            &note.id,
            first.updated_at,
            &NotePatch {
                body: Some("two".to_owned()),
                ..NotePatch::default()
            },
        )
        .expect("second");

        assert!(first.updated_at > note.updated_at);
        assert!(second.updated_at > first.updated_at);
    }

    #[test]
    fn duplicate_missing_and_cross_project_tasks_are_rejected_atomically() {
        let (mut database, project_id) = fixture();
        let task_id = add_task(&mut database, &project_id, "Local");
        let other_project = add_project(&mut database, "Elsewhere");
        let other_task = add_task(&mut database, &other_project, "Foreign");

        for (task_ids, expected_kind) in [
            (vec![task_id.clone(), task_id.clone()], "validation"),
            (vec!["missing-task".to_owned()], "not_found"),
            (vec![other_task], "conflict"),
        ] {
            let error = create(
                database.connection_mut(),
                &project_id,
                "Should roll back",
                "body",
                &task_ids,
            )
            .expect_err("invalid tasks");
            assert!(
                matches!(
                    (&error, expected_kind),
                    (AppError::Validation { .. }, "validation")
                        | (AppError::NotFound { .. }, "not_found")
                        | (AppError::Conflict { .. }, "conflict")
                ),
                "unexpected {error:?}"
            );
        }

        let count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE title = 'Should roll back'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 0);
    }

    #[test]
    fn database_trigger_rejects_a_cross_project_link_from_direct_sql() {
        let (mut database, project_id) = fixture();
        let other_project = add_project(&mut database, "Elsewhere");
        let other_task = add_task(&mut database, &other_project, "Foreign");
        let note = create(
            database.connection_mut(),
            &project_id,
            "Local note",
            "",
            &[],
        )
        .expect("note");

        let error = database
            .connection()
            .execute(
                "INSERT INTO note_task_links (note_id, task_id, position, created_at) \
                 VALUES (?1, ?2, 0, 1)",
                rusqlite::params![note.id, other_task],
            )
            .expect_err("cross-project relation");
        assert!(error.to_string().contains("same project"));
    }

    #[test]
    fn search_is_scoped_ranked_and_bounded() {
        let (mut database, project_id) = fixture();
        let task_id = add_task(&mut database, &project_id, "Linked task");
        let other_project = add_project(&mut database, "Elsewhere");
        create(
            database.connection_mut(),
            &project_id,
            "Needle in the title",
            "short body",
            std::slice::from_ref(&task_id),
        )
        .expect("title match");
        create(
            database.connection_mut(),
            &project_id,
            "Body match",
            &format!("{} needle {}", "before ".repeat(100), "after ".repeat(100)),
            &[],
        )
        .expect("body match");
        create(
            database.connection_mut(),
            &other_project,
            "Needle elsewhere",
            "",
            &[],
        )
        .expect("other project match");

        let scoped =
            search(database.connection(), "NEED", Some(&project_id), 1000).expect("searches");
        assert_eq!(scoped.len(), 2);
        assert_eq!(scoped[0].title, "Needle in the title");
        assert_eq!(scoped[0].task_ids, [task_id]);
        assert!(scoped.iter().all(|hit| hit.project_id == project_id));
        assert!(scoped.iter().all(|hit| hit.excerpt.chars().count() <= 500));

        assert_eq!(
            search(database.connection(), "needle", None, 1000)
                .expect("workspace search")
                .len(),
            3
        );
        assert!(search(database.connection(), "needle", None, 0)
            .expect("zero limit")
            .is_empty());
        assert!(search(database.connection(), "\" --", None, 10)
            .expect("punctuation")
            .is_empty());
    }

    #[test]
    fn an_empty_title_is_refused_rather_than_stored_blank() {
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();

        let error = create(conn, &project_id, "   ", "", &[]).expect_err("refuses");

        assert!(matches!(error, AppError::Validation { .. }));
    }

    #[test]
    fn deleting_a_note_closes_the_gap_it_left_in_the_ordering() {
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();

        let first = create(conn, &project_id, "First", "", &[]).expect("creates");
        create(conn, &project_id, "Second", "", &[]).expect("creates");
        let third = create(conn, &project_id, "Third", "", &[]).expect("creates");

        delete(conn, &first.id).expect("deletes");

        let remaining = list(conn, &project_id).expect("lists");
        assert_eq!(remaining.len(), 2);
        assert_eq!(remaining[0].position, 0);
        assert_eq!(remaining[1].position, 1);
        assert_eq!(remaining[1].id, third.id);
    }

    #[test]
    fn deleting_the_project_takes_its_notes_with_it() {
        // The cascade is declared in SQL, which means it is only real if foreign
        // keys are actually on for this connection.
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();
        let note = create(conn, &project_id, "Release plan", "", &[]).expect("creates");

        crate::db::projects::delete(conn, &project_id, "Atticus").expect("deletes the project");

        assert!(find(conn, &note.id).is_err());
    }
}
