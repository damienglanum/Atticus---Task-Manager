//! Notes: long-form writing that belongs to a project rather than to a task.
//!
//! Structurally the simplest thing in the database — a title, a body, and a
//! position within its project. The interesting decision is what a note is
//! *not*: it is not a task without a column. See `schema/m0002_notes.sql`.

use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::projects::new_id;
use crate::db::{now_ms, ordering};
use crate::domain::validate;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Note.ts")]
pub struct Note {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub body: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// A partial update. An absent field means "leave it alone", which is what lets
/// the editor save a title without having to send the whole body back.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "NotePatch.ts")]
pub struct NotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
}

const SELECT: &str =
    "SELECT id, project_id, title, body, position, created_at, updated_at FROM notes";

fn row_to_note(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        body: row.get("body")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list(conn: &Connection, project_id: &str) -> AppResult<Vec<Note>> {
    let mut statement =
        conn.prepare(&format!("{SELECT} WHERE project_id = ?1 ORDER BY position"))?;
    let rows = statement.query_map([project_id], row_to_note)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(conn: &Connection, id: &str) -> AppResult<Note> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_note)
        .optional()?
        .ok_or_else(|| AppError::NotFound {
            entity: "note".to_owned(),
            id: id.to_owned(),
        })
}

pub fn create(conn: &mut Connection, project_id: &str, title: &str) -> AppResult<Note> {
    crate::db::projects::find(conn, project_id)?;
    let title = validate::required_text("title", title, validate::NOTE_TITLE_MAX)?;

    let id = new_id();
    let now = now_ms();

    let tx = conn.transaction()?;
    let position = ordering::next_position(&tx, ordering::NOTES, Some(project_id))?;
    tx.execute(
        "INSERT INTO notes (id, project_id, title, body, position, created_at, updated_at) \
         VALUES (?1, ?2, ?3, '', ?4, ?5, ?5)",
        rusqlite::params![id, project_id, title, position, now],
    )?;
    tx.commit()?;

    find(conn, &id)
}

pub fn update(conn: &mut Connection, id: &str, patch: &NotePatch) -> AppResult<Note> {
    let existing = find(conn, id)?;

    // Validated before anything is written, so a rejected title cannot leave a
    // saved body behind it.
    let title = match patch.title.as_deref() {
        Some(value) => validate::required_text("title", value, validate::NOTE_TITLE_MAX)?,
        None => existing.title,
    };
    let body = match patch.body.as_deref() {
        Some(value) => validate::optional_text("body", value, validate::NOTE_BODY_MAX)?,
        None => existing.body,
    };

    conn.execute(
        "UPDATE notes SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![id, title, body, now_ms()],
    )?;

    find(conn, id)
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

    #[test]
    fn a_new_note_starts_with_an_empty_body_rather_than_a_placeholder() {
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();

        let note = create(conn, &project_id, "Release plan").expect("creates");

        assert_eq!(note.title, "Release plan");
        assert_eq!(note.body, "");
    }

    #[test]
    fn an_absent_field_leaves_the_stored_value_alone() {
        // The property the editor depends on: saving a title must not blank the
        // body, and a patch is the only thing standing between them.
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();

        let note = create(conn, &project_id, "Release plan").expect("creates");
        update(
            conn,
            &note.id,
            &NotePatch {
                body: Some("The body".to_owned()),
                ..NotePatch::default()
            },
        )
        .expect("writes the body");

        let after = update(
            conn,
            &note.id,
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
    fn an_empty_title_is_refused_rather_than_stored_blank() {
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();

        let error = create(conn, &project_id, "   ").expect_err("refuses");

        assert!(matches!(error, AppError::Validation { .. }));
    }

    #[test]
    fn deleting_a_note_closes_the_gap_it_left_in_the_ordering() {
        let (mut database, project_id) = fixture();
        let conn = database.connection_mut();

        let first = create(conn, &project_id, "First").expect("creates");
        create(conn, &project_id, "Second").expect("creates");
        let third = create(conn, &project_id, "Third").expect("creates");

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
        let note = create(conn, &project_id, "Release plan").expect("creates");

        crate::db::projects::delete(conn, &project_id, "Atticus").expect("deletes the project");

        assert!(find(conn, &note.id).is_err());
    }
}
