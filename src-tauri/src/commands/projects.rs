use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::projects::{self, DeletedCounts, NewProject, Project, ProjectPatch};
use crate::error::AppResult;
use crate::state::AppState;

/// A project is never created without a board, so creation returns both.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ProjectCreated.ts")]
pub struct ProjectCreated {
    pub project: Project,
    pub board_id: String,
}

#[tauri::command]
pub fn projects_list(
    state: State<'_, AppState>,
    include_archived: bool,
) -> AppResult<Vec<Project>> {
    let database = state.database()?;
    projects::list(database.connection(), include_archived)
}

#[tauri::command]
pub fn project_create(state: State<'_, AppState>, input: NewProject) -> AppResult<ProjectCreated> {
    let mut database = state.database()?;
    let (project, board_id) = projects::create(database.connection_mut(), input)?;
    Ok(ProjectCreated { project, board_id })
}

#[tauri::command]
pub fn project_update(
    state: State<'_, AppState>,
    id: String,
    patch: ProjectPatch,
) -> AppResult<Project> {
    let mut database = state.database()?;
    projects::update(database.connection_mut(), &id, patch)
}

#[tauri::command]
pub fn project_set_archived(
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> AppResult<Project> {
    let mut database = state.database()?;
    projects::set_archived(database.connection_mut(), &id, archived)
}

/// What a delete *would* remove. The dialog states real numbers rather than a
/// vague warning, so this runs before the user is asked to confirm.
#[tauri::command]
pub fn project_delete_preview(state: State<'_, AppState>, id: String) -> AppResult<DeletedCounts> {
    let database = state.database()?;
    projects::deletion_counts(database.connection(), &id)
}

#[tauri::command]
pub fn project_delete(
    state: State<'_, AppState>,
    id: String,
    confirm_name: String,
) -> AppResult<DeletedCounts> {
    let mut database = state.database()?;

    // Project deletion is the one destructive action that is deliberately *not*
    // undoable (ADR-0009), so it gets a snapshot instead. Taken only once the
    // project is known to exist, so a stale id does not litter the backup
    // folder with copies of a deletion that never happened.
    projects::find(database.connection(), &id)?;
    if let Some(directory) = database
        .path()
        .and_then(std::path::Path::parent)
        .map(|parent| parent.join(crate::db::BACKUP_DIR_NAME))
    {
        crate::db::backup::write_snapshot(database.connection(), &directory, "pre-delete")?;
        crate::db::backup::prune(&directory)?;
    }

    projects::delete(database.connection_mut(), &id, &confirm_name)
}

#[tauri::command]
pub fn projects_reorder(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<Project>> {
    let mut database = state.database()?;
    projects::reorder(database.connection_mut(), &ordered_ids)
}

#[cfg(test)]
mod tests {
    use crate::db::projects::{self, NewProject, ProjectPatch};
    use crate::db::{boards, Database};
    use crate::error::AppError;

    fn valid_input(name: &str) -> NewProject {
        NewProject {
            name: name.to_owned(),
            description: String::new(),
            color: "indigo".to_owned(),
            key_prefix: None,
            directory_path: None,
        }
    }

    #[test]
    fn creating_a_project_also_creates_a_board_with_the_default_columns() {
        let mut db = Database::open_in_memory().expect("database");

        let (project, board_id) =
            projects::create(db.connection_mut(), valid_input("Takenkanban")).expect("create");

        assert_eq!(project.name, "Takenkanban");
        assert_eq!(project.key_prefix, "TAK");
        assert_eq!(project.next_task_number, 1);

        let columns: i64 = db
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM board_columns WHERE board_id = ?1",
                [&board_id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(columns as usize, projects::DEFAULT_COLUMNS.len());
    }

    #[test]
    fn two_projects_may_share_a_name() {
        let mut db = Database::open_in_memory().expect("database");

        projects::create(db.connection_mut(), valid_input("Same")).expect("first");
        let second = projects::create(db.connection_mut(), valid_input("Same"));

        assert!(second.is_ok(), "names are not keys: {second:?}");
    }

    #[test]
    fn an_invalid_project_creates_nothing_at_all() {
        let mut db = Database::open_in_memory().expect("database");

        let mut bad = valid_input("Fine");
        bad.color = "chartreuse".to_owned();
        let error = projects::create(db.connection_mut(), bad).expect_err("should be rejected");

        assert!(matches!(error, AppError::Validation { .. }));
        let projects_count: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .expect("count");
        let boards_count: i64 = db
            .connection()
            .query_row("SELECT COUNT(*) FROM boards", [], |row| row.get(0))
            .expect("count");
        assert_eq!(projects_count, 0);
        assert_eq!(boards_count, 0, "no orphan board should be left behind");
    }

    #[test]
    fn archiving_hides_a_project_from_the_active_list_and_restoring_brings_it_back() {
        let mut db = Database::open_in_memory().expect("database");
        let (project, _) =
            projects::create(db.connection_mut(), valid_input("Later")).expect("create");

        projects::set_archived(db.connection_mut(), &project.id, true).expect("archive");
        assert!(projects::list(db.connection(), false)
            .expect("list")
            .is_empty());
        assert_eq!(
            projects::list(db.connection(), true).expect("list").len(),
            1
        );

        let restored =
            projects::set_archived(db.connection_mut(), &project.id, false).expect("restore");
        assert!(restored.archived_at.is_none());
        assert_eq!(
            projects::list(db.connection(), false).expect("list").len(),
            1
        );
    }

    #[test]
    fn archiving_keeps_the_boards_and_their_columns() {
        let mut db = Database::open_in_memory().expect("database");
        let (project, board_id) =
            projects::create(db.connection_mut(), valid_input("Later")).expect("create");

        projects::set_archived(db.connection_mut(), &project.id, true).expect("archive");

        let columns: i64 = db
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM board_columns WHERE board_id = ?1",
                [&board_id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(columns as usize, projects::DEFAULT_COLUMNS.len());
    }

    #[test]
    fn deleting_requires_the_name_typed_exactly() {
        let mut db = Database::open_in_memory().expect("database");
        let (project, _) =
            projects::create(db.connection_mut(), valid_input("Precious")).expect("create");

        let wrong = projects::delete(db.connection_mut(), &project.id, "precious")
            .expect_err("case must matter");
        assert!(matches!(wrong, AppError::Conflict { .. }));

        assert_eq!(
            projects::list(db.connection(), true).expect("list").len(),
            1,
            "a failed confirmation must delete nothing",
        );

        let counts =
            projects::delete(db.connection_mut(), &project.id, "  Precious  ").expect("delete");
        assert_eq!(counts.boards, 1);
        assert_eq!(counts.columns as usize, projects::DEFAULT_COLUMNS.len());
        assert!(projects::list(db.connection(), true)
            .expect("list")
            .is_empty());
    }

    #[test]
    fn the_delete_preview_counts_match_what_is_actually_removed() {
        let mut db = Database::open_in_memory().expect("database");
        let (project, _) =
            projects::create(db.connection_mut(), valid_input("Counted")).expect("create");
        boards::create(db.connection_mut(), &project.id, "Second").expect("second board");

        let preview = projects::deletion_counts(db.connection(), &project.id).expect("preview");
        let actual = projects::delete(db.connection_mut(), &project.id, "Counted").expect("delete");

        assert_eq!(preview.boards, actual.boards);
        assert_eq!(preview.columns, actual.columns);
        assert_eq!(preview.boards, 2);
    }

    #[test]
    fn deleting_a_project_closes_the_gap_in_the_ordering() {
        let mut db = Database::open_in_memory().expect("database");
        for name in ["A", "B", "C"] {
            projects::create(db.connection_mut(), valid_input(name)).expect("create");
        }
        let all = projects::list(db.connection(), true).expect("list");

        projects::delete(db.connection_mut(), &all[1].id, "B").expect("delete");

        let remaining = projects::list(db.connection(), true).expect("list");
        assert_eq!(
            remaining.iter().map(|p| p.position).collect::<Vec<_>>(),
            vec![0, 1],
            "positions must stay dense after a deletion",
        );
    }

    #[test]
    fn updating_leaves_absent_fields_alone() {
        let mut db = Database::open_in_memory().expect("database");
        let (project, _) =
            projects::create(db.connection_mut(), valid_input("Original")).expect("create");

        let updated = projects::update(
            db.connection_mut(),
            &project.id,
            ProjectPatch {
                name: Some("Renamed".to_owned()),
                ..Default::default()
            },
        )
        .expect("update");

        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.color, project.color, "colour should be untouched");
        assert_eq!(updated.key_prefix, project.key_prefix);
        assert_eq!(updated.created_at, project.created_at);
    }

    #[test]
    fn a_missing_directory_is_reported_but_does_not_block_creation() {
        let mut db = Database::open_in_memory().expect("database");

        let mut input = valid_input("Detached");
        input.directory_path = Some("/definitely/not/here".to_owned());
        let (project, _) =
            projects::create(db.connection_mut(), input).expect("create should succeed");

        assert_eq!(
            project.directory_path.as_deref(),
            Some("/definitely/not/here")
        );
        assert!(
            project.directory_missing,
            "the UI needs to know it is missing"
        );
    }

    #[test]
    fn task_numbers_are_never_reused() {
        let mut db = Database::open_in_memory().expect("database");
        let (project, _) =
            projects::create(db.connection_mut(), valid_input("Numbered")).expect("create");

        let tx = db.connection_mut().transaction().expect("transaction");
        let first = projects::take_next_task_number(&tx, &project.id).expect("first");
        let second = projects::take_next_task_number(&tx, &project.id).expect("second");
        tx.commit().expect("commit");

        assert_eq!((first, second), (1, 2));
        assert_eq!(
            projects::find(db.connection(), &project.id)
                .expect("find")
                .next_task_number,
            3,
        );
    }
}
