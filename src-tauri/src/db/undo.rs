//! Undo, as explicit inverse operations executed in the backend.
//!
//! See ADR-0009. The short version: a token carries the whole of what was
//! removed, so the inverse is complete by construction rather than complete as
//! far as the frontend happened to have loaded.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::columns::{self, DeletedColumn};
use crate::db::labels::{self, DeletedLabel};
use crate::db::tasks::{self, TaskSnapshot};
use crate::db::{now_ms, ordering};
use crate::error::AppResult;

/// A description of how to reverse one operation.
///
/// Serialisable and handed to the frontend, which stores it against a toast and
/// hands it back. It is never persisted: undo history does not survive a
/// restart, and the interface does not suggest it does.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind",
    content = "value"
)]
#[ts(export, export_to = "UndoToken.ts")]
pub enum UndoToken {
    /// Put a deleted column back, with whatever happened to its tasks.
    ColumnDeleted(Box<DeletedColumn>),
    /// Put a deleted task back where it was.
    TaskDeleted(Box<TaskSnapshot>),
    /// Reverse an archive or a restore.
    TaskArchiveChanged { task_id: String, was_archived: bool },
    /// Put a deleted label back, on every task that carried it.
    LabelDeleted(Box<DeletedLabel>),
    /// Put a moved task back where it came from.
    TaskMoved {
        task_id: String,
        from_column_id: String,
        #[ts(type = "number")]
        from_index: i64,
    },
}

impl UndoToken {
    /// The sentence the toast shows on its undo button's action.
    ///
    /// Built here rather than in the frontend so that what the token does and
    /// what the user is told it does cannot drift apart.
    pub fn description(&self) -> String {
        match self {
            Self::ColumnDeleted(deleted) => {
                let moved = deleted.moved_task_ids.len();
                let removed = deleted.deleted_tasks.len();
                let name = &deleted.column.name;

                if moved > 0 {
                    format!("Deleted “{name}” and moved {} task{}", moved, plural(moved))
                } else if removed > 0 {
                    format!("Deleted “{name}” and {} task{}", removed, plural(removed))
                } else {
                    format!("Deleted “{name}”")
                }
            }
            Self::TaskDeleted(snapshot) => {
                format!("Deleted “{}”", snapshot.task.title)
            }
            Self::TaskArchiveChanged { was_archived, .. } => {
                if *was_archived {
                    "Restored a task".to_owned()
                } else {
                    "Archived a task".to_owned()
                }
            }
            Self::LabelDeleted(deleted) => {
                let count = deleted.task_ids.len();
                if count == 0 {
                    format!("Deleted the label “{}”", deleted.label.name)
                } else {
                    format!(
                        "Deleted the label “{}” from {} task{}",
                        deleted.label.name,
                        count,
                        plural(count)
                    )
                }
            }
            Self::TaskMoved { .. } => "Moved a task".to_owned(),
        }
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}

/// Executes the inverse, in one transaction.
///
/// A token whose target is gone fails rather than half-applying: `AppError` from
/// any step rolls the whole thing back, so undo has the same atomicity as the
/// operation it reverses.
pub fn apply(conn: &mut Connection, token: &UndoToken) -> AppResult<()> {
    let tx = conn.transaction()?;

    match token {
        UndoToken::ColumnDeleted(deleted) => {
            columns::reinsert(&tx, &deleted.column)?;

            // Tasks that were moved elsewhere come home, in the order they were
            // in, appended to the restored column.
            for (index, task_id) in deleted.moved_task_ids.iter().enumerate() {
                tx.execute(
                    "UPDATE tasks SET column_id = ?2, position = ?3, updated_at = ?4 \
                     WHERE id = ?1",
                    rusqlite::params![
                        task_id,
                        deleted.column.id,
                        i64::try_from(index).unwrap_or(i64::MAX),
                        now_ms()
                    ],
                )?;
            }

            for snapshot in &deleted.deleted_tasks {
                tasks::reinsert(&tx, snapshot)?;
            }

            // The columns the tasks were moved *to* have gaps now.
            let mut touched: Vec<String> = deleted
                .deleted_tasks
                .iter()
                .map(|snapshot| snapshot.task.column_id.clone())
                .collect();
            touched.push(deleted.column.id.clone());
            touched.sort();
            touched.dedup();

            for column_id in affected_columns(&tx, &deleted.moved_task_ids, touched)? {
                ordering::compact(&tx, ordering::TASKS, Some(&column_id))?;
            }
        }

        UndoToken::LabelDeleted(deleted) => {
            labels::reinsert(&tx, deleted)?;
        }

        UndoToken::TaskDeleted(snapshot) => {
            columns::find(&tx, &snapshot.task.column_id)?;
            tasks::reinsert_making_room(&tx, snapshot)?;
        }

        UndoToken::TaskMoved {
            task_id,
            from_column_id,
            from_index,
        } => {
            // Same reason as the archive case: one implementation of "put a task
            // at an index", including the clamping and the compaction.
            tx.commit()?;
            tasks::move_to(conn, task_id, from_column_id, *from_index)?;
            return Ok(());
        }

        UndoToken::TaskArchiveChanged {
            task_id,
            was_archived,
        } => {
            // Delegating rather than writing the inverse by hand keeps one
            // implementation of "where does a restored task go", including the
            // compaction the column needs afterwards.
            tx.commit()?;
            tasks::set_archived(conn, task_id, *was_archived)?;
            return Ok(());
        }
    }

    tx.commit()?;
    Ok(())
}

/// Every column that needs its positions closing up, deduplicated.
fn affected_columns(
    conn: &Connection,
    moved_task_ids: &[String],
    mut known: Vec<String>,
) -> AppResult<Vec<String>> {
    for task_id in moved_task_ids {
        if let Ok(task) = tasks::find(conn, task_id) {
            known.push(task.column_id);
        }
    }
    known.sort();
    known.dedup();
    Ok(known)
}

/// The session's undo stack.
///
/// Bounded, in memory, and gone on restart — all three deliberate. Tokens carry
/// whole task subtrees, so an unbounded stack is an unbounded memory leak.
#[derive(Debug, Default)]
pub struct UndoStack {
    entries: Vec<UndoToken>,
}

const MAX_ENTRIES: usize = 20;

impl UndoStack {
    pub fn push(&mut self, token: UndoToken) {
        if self.entries.len() == MAX_ENTRIES {
            self.entries.remove(0);
        }
        self.entries.push(token);
    }

    pub fn pop(&mut self) -> Option<UndoToken> {
        self.entries.pop()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive_token(id: &str) -> UndoToken {
        UndoToken::TaskArchiveChanged {
            task_id: id.to_owned(),
            was_archived: false,
        }
    }

    #[test]
    fn the_stack_drops_its_oldest_entry_rather_than_growing_without_bound() {
        let mut stack = UndoStack::default();

        for index in 0..MAX_ENTRIES + 5 {
            stack.push(archive_token(&format!("task-{index}")));
        }

        assert_eq!(stack.len(), MAX_ENTRIES);

        let newest = stack.pop().expect("a token");
        match newest {
            UndoToken::TaskArchiveChanged { task_id, .. } => {
                assert_eq!(task_id, format!("task-{}", MAX_ENTRIES + 4));
            }
            other => panic!("unexpected token: {other:?}"),
        }
    }

    #[test]
    fn an_empty_stack_yields_nothing() {
        let mut stack = UndoStack::default();
        assert!(stack.is_empty());
        assert!(stack.pop().is_none());
    }
}
