//! Reading the whole database out as an export document.
//!
//! Scope is all projects or exactly one (product-spec §7.1). Archived records
//! are always included — an export that quietly dropped them would be a lossy
//! backup wearing the word "export".

use rusqlite::{Connection, Row};
use serde::Deserialize;
use ts_rs::TS;

use crate::domain::export_format::{
    ExportBoard, ExportColumn, ExportData, ExportDocument, ExportFileRef, ExportLabel,
    ExportLinkRef, ExportNote, ExportNoteTaskLink, ExportProject, ExportSavedFilter, ExportSubtask,
    ExportTask, ExportTaskLabel, CURRENT_EXPORT_VERSION, EXPORT_APP,
};
use crate::error::AppResult;

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "projectId")]
#[ts(export, export_to = "ExportScope.ts")]
pub enum ExportScope {
    Everything,
    Project(String),
}

/// Reads the document. One statement per table, each filtered by the scope
/// through the same join, so a single-project export cannot pick up a row that
/// belongs to another one.
pub fn export(
    conn: &Connection,
    scope: &ExportScope,
    app_version: &str,
) -> AppResult<ExportDocument> {
    let project_id = match scope {
        ExportScope::Everything => None,
        ExportScope::Project(id) => Some(id.as_str()),
    };

    Ok(ExportDocument {
        export_version: CURRENT_EXPORT_VERSION,
        generated_at: iso8601_now(),
        app: EXPORT_APP.into(),
        app_version: app_version.to_owned(),
        data: ExportData {
            projects: projects(conn, project_id)?,
            boards: boards(conn, project_id)?,
            columns: columns(conn, project_id)?,
            tasks: tasks(conn, project_id)?,
            subtasks: subtasks(conn, project_id)?,
            labels: labels(conn, project_id)?,
            task_labels: task_labels(conn, project_id)?,
            file_refs: file_refs(conn, project_id)?,
            link_refs: link_refs(conn, project_id)?,
            saved_filters: saved_filters(conn, project_id)?,
            notes: notes(conn, project_id)?,
            note_task_links: note_task_links(conn, project_id)?,
        },
    })
}

/// `generatedAt` is the one timestamp in the format that is an instant rather
/// than a calendar date, so it is written as ISO 8601 UTC.
fn iso8601_now() -> String {
    let ms = super::now_ms();
    let seconds = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);

    // Hand-rolled rather than pulling in a date crate for one line of output.
    // Days from the Unix epoch, converted through the civil-from-days algorithm.
    let days = seconds.div_euclid(86_400);
    let time = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        time / 3600,
        (time % 3600) / 60,
        time % 60,
    )
}

/// Howard Hinnant's `civil_from_days`, which is exact for every date this
/// application can produce and needs no table.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };

    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

/// Every reader below takes the same shape: a `WHERE` clause that is either
/// empty or scopes to one project, and the same parameter either way. Writing it
/// once keeps the nine statements honest with each other.
fn query<T>(
    conn: &Connection,
    sql: &str,
    scoped_sql: &str,
    project_id: Option<&str>,
    map: impl Fn(&Row<'_>) -> rusqlite::Result<T>,
) -> AppResult<Vec<T>> {
    let mut rows = Vec::new();

    match project_id {
        None => {
            let mut statement = conn.prepare(sql)?;
            for row in statement.query_map([], |row| map(row))? {
                rows.push(row?);
            }
        }
        Some(id) => {
            let mut statement = conn.prepare(scoped_sql)?;
            for row in statement.query_map([id], |row| map(row))? {
                rows.push(row?);
            }
        }
    }

    Ok(rows)
}

fn projects(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportProject>> {
    const COLUMNS: &str = "id, name, description, color, key_prefix, next_task_number, \
                           directory_path, position, archived_at, created_at, updated_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM projects ORDER BY position"),
        &format!("SELECT {COLUMNS} FROM projects WHERE id = ?1"),
        project_id,
        |row| {
            Ok(ExportProject {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                key_prefix: row.get(4)?,
                next_task_number: row.get(5)?,
                directory_path: row.get(6)?,
                position: row.get(7)?,
                archived_at: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )
}

fn boards(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportBoard>> {
    const COLUMNS: &str = "id, project_id, name, position, created_at, updated_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM boards ORDER BY project_id, position"),
        &format!("SELECT {COLUMNS} FROM boards WHERE project_id = ?1 ORDER BY position"),
        project_id,
        |row| {
            Ok(ExportBoard {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                position: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
}

fn columns(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportColumn>> {
    const COLUMNS: &str = "c.id, c.board_id, c.name, c.wip_limit, c.position, c.created_at, \
                           c.updated_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM board_columns c ORDER BY c.board_id, c.position"),
        &format!(
            "SELECT {COLUMNS} FROM board_columns c \
             JOIN boards b ON b.id = c.board_id \
             WHERE b.project_id = ?1 ORDER BY c.board_id, c.position"
        ),
        project_id,
        |row| {
            Ok(ExportColumn {
                id: row.get(0)?,
                board_id: row.get(1)?,
                name: row.get(2)?,
                wip_limit: row.get(3)?,
                position: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
}

fn tasks(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportTask>> {
    const COLUMNS: &str = "id, project_id, board_id, column_id, number, title, description, \
                           priority, due_date, estimate_minutes, position, archived_at, \
                           created_at, updated_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM tasks ORDER BY project_id, number"),
        &format!("SELECT {COLUMNS} FROM tasks WHERE project_id = ?1 ORDER BY number"),
        project_id,
        |row| {
            Ok(ExportTask {
                id: row.get(0)?,
                project_id: row.get(1)?,
                board_id: row.get(2)?,
                column_id: row.get(3)?,
                number: row.get(4)?,
                title: row.get(5)?,
                description: row.get(6)?,
                priority: row.get(7)?,
                due_date: row.get(8)?,
                estimate_minutes: row.get(9)?,
                position: row.get(10)?,
                archived_at: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        },
    )
}

fn subtasks(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportSubtask>> {
    const COLUMNS: &str =
        "s.id, s.task_id, s.title, s.done, s.position, s.created_at, s.updated_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM subtasks s ORDER BY s.task_id, s.position"),
        &format!(
            "SELECT {COLUMNS} FROM subtasks s \
             JOIN tasks t ON t.id = s.task_id \
             WHERE t.project_id = ?1 ORDER BY s.task_id, s.position"
        ),
        project_id,
        |row| {
            Ok(ExportSubtask {
                id: row.get(0)?,
                task_id: row.get(1)?,
                title: row.get(2)?,
                done: row.get::<_, i64>(3)? != 0,
                position: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
}

fn labels(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportLabel>> {
    const COLUMNS: &str = "id, project_id, name, color, created_at, updated_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM labels ORDER BY project_id, name"),
        &format!("SELECT {COLUMNS} FROM labels WHERE project_id = ?1 ORDER BY name"),
        project_id,
        |row| {
            Ok(ExportLabel {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
}

fn task_labels(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportTaskLabel>> {
    query(
        conn,
        "SELECT task_id, label_id FROM task_labels ORDER BY task_id, label_id",
        "SELECT tl.task_id, tl.label_id FROM task_labels tl \
         JOIN tasks t ON t.id = tl.task_id \
         WHERE t.project_id = ?1 ORDER BY tl.task_id, tl.label_id",
        project_id,
        |row| {
            Ok(ExportTaskLabel {
                task_id: row.get(0)?,
                label_id: row.get(1)?,
            })
        },
    )
}

fn file_refs(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportFileRef>> {
    // `found` and `last_verified_at` are deliberately not exported: they are
    // facts about *this* machine's filesystem at some past moment, and carrying
    // them to another machine would assert something the file has never checked.
    const COLUMNS: &str = "f.id, f.task_id, f.path, f.display_name, f.position, f.created_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM file_refs f ORDER BY f.task_id, f.position"),
        &format!(
            "SELECT {COLUMNS} FROM file_refs f \
             JOIN tasks t ON t.id = f.task_id \
             WHERE t.project_id = ?1 ORDER BY f.task_id, f.position"
        ),
        project_id,
        |row| {
            Ok(ExportFileRef {
                id: row.get(0)?,
                task_id: row.get(1)?,
                path: row.get(2)?,
                display_name: row.get(3)?,
                position: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
}

fn link_refs(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportLinkRef>> {
    const COLUMNS: &str = "l.id, l.task_id, l.url, l.position, l.created_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM link_refs l ORDER BY l.task_id, l.position"),
        &format!(
            "SELECT {COLUMNS} FROM link_refs l \
             JOIN tasks t ON t.id = l.task_id \
             WHERE t.project_id = ?1 ORDER BY l.task_id, l.position"
        ),
        project_id,
        |row| {
            Ok(ExportLinkRef {
                id: row.get(0)?,
                task_id: row.get(1)?,
                url: row.get(2)?,
                position: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )
}

fn notes(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportNote>> {
    const COLUMNS: &str = "id, project_id, title, body, position, created_at, updated_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM notes ORDER BY project_id, position"),
        &format!("SELECT {COLUMNS} FROM notes WHERE project_id = ?1 ORDER BY position"),
        project_id,
        |row| {
            Ok(ExportNote {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                position: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
}

fn note_task_links(
    conn: &Connection,
    project_id: Option<&str>,
) -> AppResult<Vec<ExportNoteTaskLink>> {
    const COLUMNS: &str = "ntl.note_id, ntl.task_id, ntl.position, ntl.created_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM note_task_links ntl ORDER BY ntl.note_id, ntl.position"),
        &format!(
            "SELECT {COLUMNS} FROM note_task_links ntl \
             JOIN notes note ON note.id = ntl.note_id \
             JOIN tasks task ON task.id = ntl.task_id \
             WHERE note.project_id = ?1 AND task.project_id = ?1 \
             ORDER BY ntl.note_id, ntl.position"
        ),
        project_id,
        |row| {
            Ok(ExportNoteTaskLink {
                note_id: row.get(0)?,
                task_id: row.get(1)?,
                position: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
}

fn saved_filters(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<ExportSavedFilter>> {
    const COLUMNS: &str = "id, project_id, name, filter, position, created_at, updated_at";

    query(
        conn,
        &format!("SELECT {COLUMNS} FROM saved_filters ORDER BY project_id, position"),
        &format!("SELECT {COLUMNS} FROM saved_filters WHERE project_id = ?1 ORDER BY position"),
        project_id,
        |row| {
            Ok(ExportSavedFilter {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                filter: row.get(3)?,
                position: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::labels::LabelInput;
    use crate::db::projects::{self, NewProject};
    use crate::db::tasks::{self, NewTask};
    use crate::db::{columns, labels, link_refs, subtasks, Database};

    struct Fixture {
        db: Database,
        first: String,
        second: String,
    }

    /// Two projects, so every scoped query has something it must *not* return.
    /// A single-project fixture cannot fail a scoping bug.
    fn fixture() -> Fixture {
        let mut db = Database::open_in_memory().expect("database");

        let (first, first_board) = projects::create(
            db.connection_mut(),
            NewProject {
                name: "First".to_owned(),
                description: "The one being exported".to_owned(),
                color: "indigo".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("first project");

        let (second, second_board) = projects::create(
            db.connection_mut(),
            NewProject {
                name: "Second".to_owned(),
                description: String::new(),
                color: "grass".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("second project");

        for board in [&first_board, &second_board] {
            let column = columns::list(db.connection(), board).expect("columns")[0]
                .id
                .clone();
            let task = tasks::create(
                db.connection_mut(),
                NewTask {
                    column_id: column,
                    title: "A task".to_owned(),
                },
            )
            .expect("task");

            subtasks::create(db.connection_mut(), &task.id, "A subtask").expect("subtask");
            let note_id = crate::db::projects::new_id();
            db.connection()
                .execute(
                    "INSERT INTO notes \
                       (id, project_id, title, body, position, created_at, updated_at) \
                     VALUES (?1, ?2, 'A linked note', '', 0, 1, 1)",
                    [&note_id, &task.project_id],
                )
                .expect("note");
            db.connection()
                .execute(
                    "INSERT INTO note_task_links (note_id, task_id, position, created_at) \
                     VALUES (?1, ?2, 0, 1)",
                    [&note_id, &task.id],
                )
                .expect("note/task link");
            if task.project_id == first.id {
                link_refs::add(db.connection_mut(), &task.id, "https://example.com/spec")
                    .expect("link");
            }
        }

        labels::create(
            db.connection(),
            &first.id,
            LabelInput {
                name: "api".to_owned(),
                color: "blue".to_owned(),
            },
        )
        .expect("label");

        Fixture {
            db,
            first: first.id,
            second: second.id,
        }
    }

    #[test]
    fn everything_exports_both_projects_and_all_their_records() {
        let fixture = fixture();

        let document =
            export(fixture.db.connection(), &ExportScope::Everything, "0.1.0").expect("exports");

        assert_eq!(document.data.projects.len(), 2);
        assert_eq!(document.data.boards.len(), 2);
        assert_eq!(document.data.columns.len(), 10, "five per board");
        assert_eq!(document.data.tasks.len(), 2);
        assert_eq!(document.data.subtasks.len(), 2);
        assert_eq!(document.data.labels.len(), 1);
        assert_eq!(document.data.link_refs.len(), 1);
        assert_eq!(document.data.note_task_links.len(), 2);
        assert!(document
            .data
            .note_task_links
            .iter()
            .all(|link| link.position == 0 && link.created_at == 1));
    }

    #[test]
    fn one_project_exports_nothing_belonging_to_the_other() {
        let fixture = fixture();

        let document = export(
            fixture.db.connection(),
            &ExportScope::Project(fixture.first.clone()),
            "0.1.0",
        )
        .expect("exports");

        assert_eq!(document.data.projects.len(), 1);
        assert_eq!(document.data.projects[0].id, fixture.first);
        assert_eq!(document.data.boards.len(), 1);
        assert_eq!(document.data.columns.len(), 5);
        assert_eq!(document.data.tasks.len(), 1);
        assert_eq!(document.data.subtasks.len(), 1);
        assert_eq!(document.data.labels.len(), 1);
        assert_eq!(document.data.link_refs.len(), 1);
        assert_eq!(document.data.note_task_links.len(), 1);

        // The scoping assertion that actually bites: every row that carries a
        // project must carry *this* one, checked rather than counted.
        assert!(document
            .data
            .tasks
            .iter()
            .all(|task| task.project_id == fixture.first));
        assert!(document
            .data
            .labels
            .iter()
            .all(|label| label.project_id == fixture.first));
        let exported_note_ids: std::collections::HashSet<&str> = document
            .data
            .notes
            .iter()
            .map(|note| note.id.as_str())
            .collect();
        let exported_task_ids: std::collections::HashSet<&str> = document
            .data
            .tasks
            .iter()
            .map(|task| task.id.as_str())
            .collect();
        assert!(document
            .data
            .note_task_links
            .iter()
            .all(|link| exported_note_ids.contains(link.note_id.as_str())
                && exported_task_ids.contains(link.task_id.as_str())));
        assert_ne!(fixture.first, fixture.second);
    }

    #[test]
    fn an_archived_project_is_still_exported() {
        // An export that quietly dropped archived records would be a lossy
        // backup wearing the word "export" (product-spec §7.1: "excludes
        // nothing").
        let mut fixture = fixture();
        projects::set_archived(fixture.db.connection_mut(), &fixture.second, true)
            .expect("archives");

        let document =
            export(fixture.db.connection(), &ExportScope::Everything, "0.1.0").expect("exports");

        assert_eq!(document.data.projects.len(), 2);
        assert!(document
            .data
            .projects
            .iter()
            .any(|project| project.archived_at.is_some()));
    }

    #[test]
    fn the_envelope_names_the_format_and_the_build() {
        let fixture = fixture();

        let document =
            export(fixture.db.connection(), &ExportScope::Everything, "9.9.9").expect("exports");

        assert_eq!(document.export_version, CURRENT_EXPORT_VERSION);
        assert_eq!(document.app, EXPORT_APP);
        assert_eq!(document.app_version, "9.9.9");
    }

    #[test]
    fn generated_at_is_iso_8601_utc() {
        // Printed as well as asserted: a timestamp format is exactly the kind of
        // thing that is easier to eyeball once than to reason about.
        let stamp = iso8601_now();
        println!("  generatedAt = {stamp}");

        assert_eq!(stamp.len(), 24, "YYYY-MM-DDTHH:MM:SS.mmmZ");
        assert!(stamp.ends_with('Z'));
        assert_eq!(stamp.as_bytes()[4], b'-');
        assert_eq!(stamp.as_bytes()[10], b'T');
    }

    #[test]
    fn the_civil_calendar_conversion_is_right_at_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // A leap day, which is where a hand-rolled conversion goes wrong.
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(20_664), (2026, 7, 30));
    }
}
