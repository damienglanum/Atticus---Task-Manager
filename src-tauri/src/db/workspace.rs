//! What the user was last looking at.
//!
//! Restoring the last project and board is the difference between opening the
//! app and *resuming* work. Both ids are validated on read: a project deleted
//! since last launch must not produce an error dialog on startup, it should
//! quietly fall back. See `docs/product-spec.md` US-4.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::{app_state, boards, projects};
use crate::error::AppResult;

const KEY: &str = "workspace";

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "Workspace.ts")]
pub struct Workspace {
    pub project_id: Option<String>,
    pub board_id: Option<String>,
}

pub fn set(conn: &Connection, workspace: &Workspace) -> AppResult<()> {
    app_state::set(conn, KEY, workspace)
}

/// The stored workspace, with anything that no longer exists replaced by a
/// sensible fallback rather than reported as an error.
pub fn resolve(conn: &Connection) -> AppResult<Workspace> {
    let stored: Workspace = app_state::get_or(conn, KEY, Workspace::default())?;

    let project_id = match stored.project_id {
        Some(id) if projects::find(conn, &id).is_ok() => Some(id),
        _ => first_active_project(conn)?,
    };

    let Some(project_id) = project_id else {
        return Ok(Workspace::default());
    };

    let available = boards::list(conn, &project_id)?;
    let board_id = stored
        .board_id
        .filter(|id| available.iter().any(|board| &board.id == id))
        .or_else(|| available.first().map(|board| board.id.clone()));

    Ok(Workspace {
        project_id: Some(project_id),
        board_id,
    })
}

fn first_active_project(conn: &Connection) -> AppResult<Option<String>> {
    Ok(projects::list(conn, false)?
        .first()
        .map(|project| project.id.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::projects::NewProject;
    use crate::db::Database;

    fn make_project(db: &mut Database, name: &str) -> (String, String) {
        let (project, board_id) = projects::create(
            db.connection_mut(),
            NewProject {
                name: name.to_owned(),
                description: String::new(),
                color: "indigo".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("project should be created");
        (project.id, board_id)
    }

    #[test]
    fn an_empty_workspace_resolves_to_nothing_when_there_are_no_projects() {
        let db = Database::open_in_memory().expect("database");

        let workspace = resolve(db.connection()).expect("resolve");

        assert!(workspace.project_id.is_none());
        assert!(workspace.board_id.is_none());
    }

    #[test]
    fn a_stored_workspace_round_trips() {
        let mut db = Database::open_in_memory().expect("database");
        let (project_id, board_id) = make_project(&mut db, "Takenkanban");

        set(
            db.connection(),
            &Workspace {
                project_id: Some(project_id.clone()),
                board_id: Some(board_id.clone()),
            },
        )
        .expect("set");

        let resolved = resolve(db.connection()).expect("resolve");
        assert_eq!(resolved.project_id, Some(project_id));
        assert_eq!(resolved.board_id, Some(board_id));
    }

    #[test]
    fn a_deleted_project_falls_back_without_an_error() {
        let mut db = Database::open_in_memory().expect("database");
        let (first_id, _) = make_project(&mut db, "First");
        let (doomed_id, doomed_board) = make_project(&mut db, "Doomed");

        set(
            db.connection(),
            &Workspace {
                project_id: Some(doomed_id.clone()),
                board_id: Some(doomed_board),
            },
        )
        .expect("set");
        projects::delete(db.connection_mut(), &doomed_id, "Doomed").expect("delete");

        let resolved = resolve(db.connection()).expect("resolve should not fail");

        assert_eq!(
            resolved.project_id,
            Some(first_id),
            "should fall back to the first active project",
        );
        assert!(
            resolved.board_id.is_some(),
            "and to that project's first board"
        );
    }

    #[test]
    fn a_board_belonging_to_another_project_is_not_restored() {
        let mut db = Database::open_in_memory().expect("database");
        let (project_id, own_board) = make_project(&mut db, "Mine");
        let (_, other_board) = make_project(&mut db, "Theirs");

        set(
            db.connection(),
            &Workspace {
                project_id: Some(project_id),
                board_id: Some(other_board),
            },
        )
        .expect("set");

        let resolved = resolve(db.connection()).expect("resolve");

        assert_eq!(
            resolved.board_id,
            Some(own_board),
            "a board from a different project must not be restored",
        );
    }
}
