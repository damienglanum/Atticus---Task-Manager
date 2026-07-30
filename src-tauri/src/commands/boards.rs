use tauri::State;

use crate::db::boards::{self, Board, BoardPatch};
use crate::db::workspace::{self, Workspace};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn boards_list(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<Board>> {
    let database = state.database()?;
    boards::list(database.connection(), &project_id)
}

#[tauri::command]
pub fn board_create(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
) -> AppResult<Board> {
    let mut database = state.database()?;
    boards::create(database.connection_mut(), &project_id, &name)
}

#[tauri::command]
pub fn board_update(state: State<'_, AppState>, id: String, patch: BoardPatch) -> AppResult<Board> {
    let database = state.database()?;
    boards::update(database.connection(), &id, patch)
}

#[tauri::command]
pub fn board_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut database = state.database()?;
    boards::delete(database.connection_mut(), &id)
}

#[tauri::command]
pub fn boards_reorder(
    state: State<'_, AppState>,
    project_id: String,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<Board>> {
    let mut database = state.database()?;
    boards::reorder(database.connection_mut(), &project_id, &ordered_ids)
}

#[tauri::command]
pub fn workspace_get(state: State<'_, AppState>) -> AppResult<Workspace> {
    let database = state.database()?;
    workspace::resolve(database.connection())
}

#[tauri::command]
pub fn workspace_set(state: State<'_, AppState>, workspace: Workspace) -> AppResult<Workspace> {
    let database = state.database()?;
    workspace::set(database.connection(), &workspace)?;
    workspace::resolve(database.connection())
}

#[cfg(test)]
mod tests {
    use crate::db::boards::{self, BoardPatch};
    use crate::db::projects::{self, NewProject};
    use crate::db::Database;
    use crate::error::AppError;

    fn project(db: &mut Database) -> String {
        projects::create(
            db.connection_mut(),
            NewProject {
                name: "Takenkanban".to_owned(),
                description: String::new(),
                color: "indigo".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("create")
        .0
        .id
    }

    #[test]
    fn a_new_board_gets_the_default_columns_and_goes_last() {
        let mut db = Database::open_in_memory().expect("database");
        let project_id = project(&mut db);

        let board = boards::create(db.connection_mut(), &project_id, "Ideas").expect("create");

        assert_eq!(board.name, "Ideas");
        assert_eq!(
            board.position, 1,
            "the first board already holds position 0"
        );

        let columns: i64 = db
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM board_columns WHERE board_id = ?1",
                [&board.id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(columns as usize, projects::DEFAULT_COLUMNS.len());
    }

    #[test]
    fn the_last_board_cannot_be_deleted() {
        let mut db = Database::open_in_memory().expect("database");
        let project_id = project(&mut db);
        let only = boards::list(db.connection(), &project_id).expect("list")[0]
            .id
            .clone();

        let error = boards::delete(db.connection_mut(), &only).expect_err("should refuse");

        match error {
            AppError::Conflict { message } => {
                assert!(
                    message.contains("only board"),
                    "message should explain: {message}"
                );
            }
            other => panic!("expected Conflict, got {other:?}"),
        }
        assert_eq!(
            boards::list(db.connection(), &project_id)
                .expect("list")
                .len(),
            1
        );
    }

    #[test]
    fn deleting_a_board_closes_the_gap_in_the_ordering() {
        let mut db = Database::open_in_memory().expect("database");
        let project_id = project(&mut db);
        boards::create(db.connection_mut(), &project_id, "Second").expect("second");
        boards::create(db.connection_mut(), &project_id, "Third").expect("third");
        let all = boards::list(db.connection(), &project_id).expect("list");

        boards::delete(db.connection_mut(), &all[1].id).expect("delete");

        let remaining = boards::list(db.connection(), &project_id).expect("list");
        assert_eq!(
            remaining.iter().map(|b| b.position).collect::<Vec<_>>(),
            vec![0, 1],
        );
    }

    #[test]
    fn deleting_a_board_takes_its_columns_with_it() {
        let mut db = Database::open_in_memory().expect("database");
        let project_id = project(&mut db);
        let extra = boards::create(db.connection_mut(), &project_id, "Second").expect("second");

        boards::delete(db.connection_mut(), &extra.id).expect("delete");

        let orphans: i64 = db
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM board_columns WHERE board_id = ?1",
                [&extra.id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(orphans, 0);
    }

    #[test]
    fn renaming_rejects_an_empty_name() {
        let mut db = Database::open_in_memory().expect("database");
        let project_id = project(&mut db);
        let board = boards::list(db.connection(), &project_id).expect("list")[0].clone();

        let error = boards::update(
            db.connection(),
            &board.id,
            BoardPatch {
                name: Some("   ".to_owned()),
            },
        )
        .expect_err("should be rejected");

        assert!(matches!(error, AppError::Validation { .. }));
        assert_eq!(
            boards::find(db.connection(), &board.id).expect("find").name,
            board.name,
            "a rejected rename must not change anything",
        );
    }

    #[test]
    fn reordering_boards_persists() {
        let mut db = Database::open_in_memory().expect("database");
        let project_id = project(&mut db);
        boards::create(db.connection_mut(), &project_id, "Second").expect("second");
        boards::create(db.connection_mut(), &project_id, "Third").expect("third");

        let mut ids: Vec<String> = boards::list(db.connection(), &project_id)
            .expect("list")
            .into_iter()
            .map(|board| board.id)
            .collect();
        ids.reverse();

        boards::reorder(db.connection_mut(), &project_id, &ids).expect("reorder");

        let after: Vec<String> = boards::list(db.connection(), &project_id)
            .expect("list")
            .into_iter()
            .map(|board| board.id)
            .collect();
        assert_eq!(after, ids);
    }
}
