//! Application-wide state held by Tauri.
//!
//! One connection behind one mutex. That is the concurrency model: a single
//! writer by construction, so no command can interleave with another mid-
//! transaction. See `docs/architecture.md` §8.

use std::sync::{Mutex, MutexGuard};

use crate::commands::board::UndoRecord;
use crate::db::undo::{self, UndoStack, UndoToken};
use crate::db::Database;
use crate::error::{AppError, AppResult};

/// Startup either produced a usable database or a reason it could not.
///
/// A failed start is state, not a panic: the window still opens and renders a
/// recovery screen naming the pre-migration backup, which is far more useful to
/// someone whose data is at stake than a process that refuses to launch.
pub enum AppState {
    Ready {
        database: Mutex<Database>,
        /// The session's undo stack. Separate from the database mutex because
        /// pushing a token must not be able to deadlock against a command that
        /// is still holding the connection.
        undo: Mutex<UndoStack>,
    },
    Failed {
        error: AppError,
    },
}

impl AppState {
    pub fn ready(database: Database) -> Self {
        Self::Ready {
            database: Mutex::new(database),
            undo: Mutex::new(UndoStack::default()),
        }
    }

    pub fn failed(error: AppError) -> Self {
        Self::Failed { error }
    }

    /// Records how to reverse an operation that has already happened.
    ///
    /// Infallible on purpose: the work is committed by the time this is called,
    /// and failing to offer an undo is not a reason to report the operation
    /// itself as failed.
    pub fn remember_undo(&self, token: UndoToken) -> UndoRecord {
        let record = UndoRecord::new(token.clone());

        if let Self::Ready { undo, .. } = self {
            match undo.lock() {
                Ok(mut stack) => stack.push(token),
                Err(poisoned) => poisoned.into_inner().push(token),
            }
        }

        record
    }

    /// Reverses the most recent operation, returning what it undid.
    pub fn undo_last(&self) -> AppResult<Option<String>> {
        let Self::Ready { undo, .. } = self else {
            return Err(self
                .startup_error()
                .cloned()
                .unwrap_or_else(|| AppError::internal("the database is not available")));
        };

        let token = {
            let mut stack = undo.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            stack.pop()
        };

        let Some(token) = token else {
            return Ok(None);
        };

        let description = token.description();
        let mut database = self.database()?;

        // A token whose target is gone is put back nowhere: it cannot succeed
        // later either, and leaving it on the stack would make the next ⌘Z fail
        // the same way.
        undo::apply(database.connection_mut(), &token)?;

        Ok(Some(description))
    }

    pub fn undo_available(&self) -> AppResult<bool> {
        match self {
            Self::Failed { error } => Err(error.clone()),
            Self::Ready { undo, .. } => {
                let stack = undo.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                Ok(!stack.is_empty())
            }
        }
    }

    pub fn startup_error(&self) -> Option<&AppError> {
        match self {
            Self::Ready { .. } => None,
            Self::Failed { error } => Some(error),
        }
    }

    /// Borrows the database, or reports why there isn't one.
    ///
    /// A poisoned mutex means an earlier command panicked mid-transaction.
    /// SQLite will have rolled that transaction back, so the data is intact and
    /// the connection is usable — recovering beats refusing to work for the rest
    /// of the session. The panic is still reported to the log.
    pub fn database(&self) -> AppResult<MutexGuard<'_, Database>> {
        match self {
            Self::Failed { error } => Err(error.clone()),
            Self::Ready { database, .. } => match database.lock() {
                Ok(guard) => Ok(guard),
                Err(poisoned) => {
                    eprintln!(
                        "database mutex was poisoned by an earlier panic; \
                         the interrupted transaction was rolled back by SQLite"
                    );
                    Ok(poisoned.into_inner())
                }
            },
        }
    }
}
