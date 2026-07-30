//! Applying a validated import document, in one transaction.
//!
//! Two modes (ADR-0006):
//!
//! - **merge** allocates a fresh id for every record and overwrites nothing, so
//!   importing into a populated database can never disturb what is already
//!   there. It deliberately does **not** de-duplicate: names are explicitly not
//!   unique in this product, so matching on them would silently collapse
//!   distinct records. Importing the same file twice creates two copies, and the
//!   dialog says so rather than guessing.
//! - **replace** deletes existing data first, requires typed confirmation at the
//!   call site, and takes a backup before touching anything.
//!
//! Either way the whole import is one transaction: a failure part-way through
//! leaves the database exactly as it was.

use std::collections::HashMap;

use rusqlite::{Connection, Transaction};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::projects::new_id;
use crate::domain::export_format::ExportDocument;
use crate::domain::import_validate::{validate_document, ImportPlan};
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ImportMode.ts")]
pub enum ImportMode {
    Merge,
    Replace,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ImportResult.ts")]
pub struct ImportResult {
    pub created: ImportPlan,
    pub mode: String,
}

/// Remaps every id in the document so nothing collides with what is already
/// stored. Held as one table per record kind because a task id and a label id
/// could otherwise shadow each other.
#[derive(Default)]
struct IdMap {
    projects: HashMap<String, String>,
    boards: HashMap<String, String>,
    columns: HashMap<String, String>,
    tasks: HashMap<String, String>,
    labels: HashMap<String, String>,
}

impl IdMap {
    /// Looks a mapped id up. The document has already been validated, so an
    /// unmapped reference here would be a defect in *this* module rather than in
    /// the file, and is reported as such rather than silently inserting a
    /// dangling row.
    fn get<'a>(table: &'a HashMap<String, String>, id: &str, kind: &str) -> AppResult<&'a String> {
        table.get(id).ok_or_else(|| {
            crate::error::AppError::internal(format!(
                "import: {kind} {id} was referenced but never remapped"
            ))
        })
    }
}

/// Validates, then writes. Validation runs again here even when the caller has
/// already previewed the document: the preview and the apply are two separate
/// commands, and nothing guarantees the file has not changed between them.
pub fn apply(
    conn: &mut Connection,
    document: &ExportDocument,
    mode: ImportMode,
) -> AppResult<ImportResult> {
    let plan = validate_document(document)?;

    let tx = conn.transaction()?;

    if mode == ImportMode::Replace {
        // Order matters only for readability: every one of these cascades, so
        // deleting the projects would be enough. Being explicit means a future
        // table that is *not* reachable by cascade cannot be forgotten silently.
        for table in [
            "task_labels",
            "file_refs",
            "subtasks",
            "saved_filters",
            "labels",
            "tasks",
            "board_columns",
            "boards",
            "projects",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
    }

    let mut ids = IdMap::default();
    write_projects(&tx, document, &mut ids)?;
    write_boards(&tx, document, &mut ids)?;
    write_columns(&tx, document, &mut ids)?;
    write_tasks(&tx, document, &mut ids)?;
    write_children(&tx, document, &mut ids)?;

    tx.commit()?;

    Ok(ImportResult {
        created: plan,
        mode: match mode {
            ImportMode::Merge => "merge".to_owned(),
            ImportMode::Replace => "replace".to_owned(),
        },
    })
}

fn write_projects(
    tx: &Transaction<'_>,
    document: &ExportDocument,
    ids: &mut IdMap,
) -> AppResult<()> {
    // Positions are reallocated from the end of what is already stored, so a
    // merge cannot collide with the unique index on `projects.position`.
    let first_position: i64 = tx.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM projects",
        [],
        |row| row.get(0),
    )?;

    for (offset, project) in document.data.projects.iter().enumerate() {
        let next_position = first_position + i64::try_from(offset).unwrap_or(i64::MAX);
        let id = new_id();
        ids.projects.insert(project.id.clone(), id.clone());

        tx.execute(
            "INSERT INTO projects (id, name, description, color, key_prefix, next_task_number, \
             directory_path, position, archived_at, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                id,
                project.name,
                project.description,
                project.color,
                project.key_prefix,
                project.next_task_number,
                project.directory_path,
                next_position,
                project.archived_at,
                project.created_at,
                project.updated_at,
            ],
        )?;
    }

    Ok(())
}

fn write_boards(tx: &Transaction<'_>, document: &ExportDocument, ids: &mut IdMap) -> AppResult<()> {
    for board in &document.data.boards {
        let id = new_id();
        ids.boards.insert(board.id.clone(), id.clone());
        let project_id = IdMap::get(&ids.projects, &board.project_id, "project")?;

        // Board positions are scoped to their project, and every project in the
        // document is brand new, so the document's own positions carry over.
        tx.execute(
            "INSERT INTO boards (id, project_id, name, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                id,
                project_id,
                board.name,
                board.position,
                board.created_at,
                board.updated_at,
            ],
        )?;
    }

    Ok(())
}

fn write_columns(
    tx: &Transaction<'_>,
    document: &ExportDocument,
    ids: &mut IdMap,
) -> AppResult<()> {
    for column in &document.data.columns {
        let id = new_id();
        ids.columns.insert(column.id.clone(), id.clone());
        let board_id = IdMap::get(&ids.boards, &column.board_id, "board")?;

        tx.execute(
            "INSERT INTO board_columns (id, board_id, name, wip_limit, position, created_at, \
             updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                id,
                board_id,
                column.name,
                column.wip_limit,
                column.position,
                column.created_at,
                column.updated_at,
            ],
        )?;
    }

    Ok(())
}

fn write_tasks(tx: &Transaction<'_>, document: &ExportDocument, ids: &mut IdMap) -> AppResult<()> {
    for task in &document.data.tasks {
        let id = new_id();
        ids.tasks.insert(task.id.clone(), id.clone());

        tx.execute(
            "INSERT INTO tasks (id, project_id, board_id, column_id, number, title, description, \
             priority, due_date, estimate_minutes, position, archived_at, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                id,
                IdMap::get(&ids.projects, &task.project_id, "project")?,
                IdMap::get(&ids.boards, &task.board_id, "board")?,
                IdMap::get(&ids.columns, &task.column_id, "column")?,
                task.number,
                task.title,
                task.description,
                task.priority,
                task.due_date,
                task.estimate_minutes,
                task.position,
                task.archived_at,
                task.created_at,
                task.updated_at,
            ],
        )?;
    }

    Ok(())
}

/// Labels first, because `task_labels` needs both sides remapped before it can
/// be written at all.
fn write_children(
    tx: &Transaction<'_>,
    document: &ExportDocument,
    ids: &mut IdMap,
) -> AppResult<()> {
    let data = &document.data;

    for subtask in &data.subtasks {
        tx.execute(
            "INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                new_id(),
                IdMap::get(&ids.tasks, &subtask.task_id, "task")?,
                subtask.title,
                i64::from(subtask.done),
                subtask.position,
                subtask.created_at,
                subtask.updated_at,
            ],
        )?;
    }

    for label in &data.labels {
        let id = new_id();
        ids.labels.insert(label.id.clone(), id.clone());

        tx.execute(
            "INSERT INTO labels (id, project_id, name, color, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                id,
                IdMap::get(&ids.projects, &label.project_id, "project")?,
                label.name,
                label.color,
                label.created_at,
                label.updated_at,
            ],
        )?;
    }

    for link in &data.task_labels {
        tx.execute(
            "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
            rusqlite::params![
                IdMap::get(&ids.tasks, &link.task_id, "task")?,
                IdMap::get(&ids.labels, &link.label_id, "label")?,
            ],
        )?;
    }

    for file_ref in &data.file_refs {
        // `found` and `last_verified_at` are left at their defaults rather than
        // carried: the file has never been checked *on this machine*, and
        // claiming otherwise is how a missing file gets shown as present.
        tx.execute(
            "INSERT INTO file_refs (id, task_id, path, display_name, position, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                new_id(),
                IdMap::get(&ids.tasks, &file_ref.task_id, "task")?,
                file_ref.path,
                file_ref.display_name,
                file_ref.position,
                file_ref.created_at,
            ],
        )?;
    }

    for filter in &data.saved_filters {
        tx.execute(
            "INSERT INTO saved_filters (id, project_id, name, filter, position, created_at, \
             updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                new_id(),
                IdMap::get(&ids.projects, &filter.project_id, "project")?,
                filter.name,
                filter.filter,
                filter.position,
                filter.created_at,
                filter.updated_at,
            ],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::export::{export, ExportScope};
    use crate::db::labels::LabelInput;
    use crate::db::projects::{self, NewProject};
    use crate::db::tasks::{self, NewTask};
    use crate::db::{columns, labels, subtasks, Database};

    fn count(db: &Database, table: &str) -> i64 {
        db.connection()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("counts")
    }

    /// A database with one populated project, and the document exported from it.
    fn populated() -> (Database, ExportDocument) {
        let mut db = Database::open_in_memory().expect("database");

        let (project, board) = projects::create(
            db.connection_mut(),
            NewProject {
                name: "Source".to_owned(),
                description: "Exported from here".to_owned(),
                color: "indigo".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("project");

        let column = columns::list(db.connection(), &board).expect("columns")[0]
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

        let label = labels::create(
            db.connection(),
            &project.id,
            LabelInput {
                name: "api".to_owned(),
                color: "blue".to_owned(),
            },
        )
        .expect("label");
        labels::set_for_task(
            db.connection_mut(),
            &task.id,
            std::slice::from_ref(&label.id),
        )
        .expect("label applied");

        let document = export(db.connection(), &ExportScope::Everything, "0.1.0").expect("export");

        (db, document)
    }

    #[test]
    fn a_merge_into_an_empty_database_recreates_everything() {
        let (_source, document) = populated();
        let mut target = Database::open_in_memory().expect("target");

        let result = apply(target.connection_mut(), &document, ImportMode::Merge).expect("imports");

        assert_eq!(result.created.projects, 1);
        assert_eq!(count(&target, "projects"), 1);
        assert_eq!(count(&target, "boards"), 1);
        assert_eq!(count(&target, "board_columns"), 5);
        assert_eq!(count(&target, "tasks"), 1);
        assert_eq!(count(&target, "subtasks"), 1);
        assert_eq!(count(&target, "labels"), 1);
        assert_eq!(
            count(&target, "task_labels"),
            1,
            "the link survives remapping"
        );
    }

    #[test]
    fn a_merge_allocates_fresh_ids_rather_than_the_documents_own() {
        // The property that lets a merge run into a populated database at all.
        let (_source, document) = populated();
        let mut target = Database::open_in_memory().expect("target");

        apply(target.connection_mut(), &document, ImportMode::Merge).expect("imports");

        let stored: String = target
            .connection()
            .query_row("SELECT id FROM projects", [], |row| row.get(0))
            .expect("the project");

        assert_ne!(stored, document.data.projects[0].id);
    }

    #[test]
    fn a_merge_leaves_existing_data_alone_and_adds_alongside_it() {
        let (mut target, document) = populated();

        apply(target.connection_mut(), &document, ImportMode::Merge).expect("imports");

        assert_eq!(
            count(&target, "projects"),
            2,
            "the original plus the import"
        );
        assert_eq!(count(&target, "tasks"), 2);
    }

    #[test]
    fn importing_the_same_file_twice_creates_two_copies_rather_than_de_duplicating() {
        // ADR-0006 decided this explicitly: names are not unique in this product,
        // so matching on them would silently collapse distinct records. The
        // dialog states it instead of guessing.
        let (_source, document) = populated();
        let mut target = Database::open_in_memory().expect("target");

        apply(target.connection_mut(), &document, ImportMode::Merge).expect("first");
        apply(target.connection_mut(), &document, ImportMode::Merge).expect("second");

        assert_eq!(count(&target, "projects"), 2);
        assert_eq!(count(&target, "tasks"), 2);
    }

    #[test]
    fn replace_deletes_what_was_there_first() {
        let (mut target, document) = populated();
        assert_eq!(count(&target, "projects"), 1);

        apply(target.connection_mut(), &document, ImportMode::Replace).expect("imports");

        assert_eq!(
            count(&target, "projects"),
            1,
            "the import, not the original"
        );
        assert_eq!(count(&target, "tasks"), 1);
    }

    #[test]
    fn an_invalid_document_writes_nothing_at_all() {
        // The ordering the whole data-safety story rests on. The target already
        // holds data, and a rejected import must leave every row of it.
        let (mut target, mut document) = populated();
        document.data.tasks[0].column_id = "nope".into();

        let error = apply(target.connection_mut(), &document, ImportMode::Replace)
            .expect_err("an invalid document is refused");

        assert!(matches!(
            error,
            crate::error::AppError::ImportInvalid { .. }
        ));
        // Replace mode deletes before writing, so this is also the assertion
        // that validation ran *before* the delete rather than after it.
        assert_eq!(count(&target, "projects"), 1);
        assert_eq!(count(&target, "tasks"), 1);
    }

    #[test]
    fn a_failure_part_way_through_rolls_the_whole_import_back() {
        // Two projects, the second of which collides on the unique task number
        // index once its own task is rewritten to share the first's project.
        // The import must leave nothing behind, not half of it.
        let (_source, mut document) = populated();
        let mut target = Database::open_in_memory().expect("target");

        let mut second = document.data.tasks[0].clone();
        second.id = "duplicate-number".into();
        document.data.tasks.push(second);

        let error = apply(target.connection_mut(), &document, ImportMode::Merge)
            .expect_err("a duplicate task number is refused by the index");

        println!("  rolled back with: {error}");
        assert_eq!(
            count(&target, "projects"),
            0,
            "nothing survived the failure"
        );
        assert_eq!(count(&target, "tasks"), 0);
        assert_eq!(count(&target, "board_columns"), 0);
    }

    #[test]
    fn file_references_arrive_unverified_rather_than_claiming_to_be_present() {
        let (mut source, _) = populated();
        let task: String = source
            .connection()
            .query_row("SELECT id FROM tasks", [], |row| row.get(0))
            .expect("task");
        crate::db::file_refs::add(source.connection_mut(), &task, "/tmp/nowhere.txt", None)
            .expect("file ref");

        let document =
            export(source.connection(), &ExportScope::Everything, "0.1.0").expect("export");
        let mut target = Database::open_in_memory().expect("target");
        apply(target.connection_mut(), &document, ImportMode::Merge).expect("imports");

        let verified: Option<i64> = target
            .connection()
            .query_row("SELECT last_verified_at FROM file_refs", [], |row| {
                row.get(0)
            })
            .expect("the file ref");

        assert_eq!(
            verified, None,
            "a path from another machine has never been checked on this one"
        );
    }
}

/// Reading the checked-in fixtures.
///
/// ADR-0006 keeps a fixture for **every released export version, forever**, so
/// that a file written by any past build still imports. There is only one
/// released version today, and pinning it now is the whole point: the moment a
/// second one exists, this fixture is what proves version 1 is still readable.
#[cfg(test)]
mod fixtures {
    use super::*;
    use crate::db::Database;
    use crate::domain::export_format::upgrade;

    fn read(name: &str) -> ExportDocument {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/exports")
            .join(name);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("could not read {}: {error}", path.display()));
        let value: serde_json::Value = serde_json::from_str(&text).expect("the fixture is JSON");

        upgrade(value).expect("the fixture upgrades to the current version")
    }

    #[test]
    fn version_1_still_imports_in_full() {
        let document = read("v1.json");
        let mut target = Database::open_in_memory().expect("database");

        let result = apply(target.connection_mut(), &document, ImportMode::Merge).expect("imports");

        assert_eq!(result.created.projects, 1);
        assert_eq!(result.created.boards, 1);
        assert_eq!(result.created.columns, 2);
        assert_eq!(result.created.tasks, 2);
        assert_eq!(result.created.subtasks, 1);
        assert_eq!(result.created.labels, 1);
        assert_eq!(result.created.file_refs, 1);
        assert_eq!(result.created.saved_filters, 1);
    }

    #[test]
    fn version_1_keeps_the_values_that_are_easy_to_lose_in_a_format_change() {
        // Not a count: the fields that a careless upgrade function would drop or
        // coerce — a due date, an estimate, a WIP limit, a done flag, and an
        // archived timestamp that must survive the round trip as a timestamp.
        let document = read("v1.json");
        let mut target = Database::open_in_memory().expect("database");
        apply(target.connection_mut(), &document, ImportMode::Merge).expect("imports");

        let (due, estimate, priority): (Option<String>, Option<i64>, i64) = target
            .connection()
            .query_row(
                "SELECT due_date, estimate_minutes, priority FROM tasks WHERE number = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("the task");
        assert_eq!(due.as_deref(), Some("2026-08-14"));
        assert_eq!(estimate, Some(90));
        assert_eq!(priority, 3);

        let archived: Option<i64> = target
            .connection()
            .query_row(
                "SELECT archived_at FROM tasks WHERE number = 2",
                [],
                |row| row.get(0),
            )
            .expect("the archived task");
        assert_eq!(archived, Some(1_753_822_500_000));

        let wip: Option<i64> = target
            .connection()
            .query_row(
                "SELECT wip_limit FROM board_columns WHERE name = 'Done'",
                [],
                |row| row.get(0),
            )
            .expect("the column");
        assert_eq!(wip, Some(2));

        let done: i64 = target
            .connection()
            .query_row("SELECT done FROM subtasks", [], |row| row.get(0))
            .expect("the subtask");
        assert_eq!(done, 1);

        let filter: String = target
            .connection()
            .query_row("SELECT filter FROM saved_filters", [], |row| row.get(0))
            .expect("the saved filter");
        assert_eq!(filter, r#"{"priorities":[3,4]}"#);
    }

    #[test]
    fn a_fixture_exists_for_every_version_this_build_can_write() {
        // The guard that makes the promise real: adding CURRENT_EXPORT_VERSION 2
        // without checking in `v2.json` fails here rather than silently leaving
        // the new format unpinned.
        use crate::domain::export_format::CURRENT_EXPORT_VERSION;

        for version in 1..=CURRENT_EXPORT_VERSION {
            let name = format!("v{version}.json");
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/exports")
                .join(&name);

            assert!(
                path.exists(),
                "export version {version} has no fixture at {}. ADR-0006 keeps one \
                 for every released version, forever.",
                path.display()
            );
        }
    }
}
