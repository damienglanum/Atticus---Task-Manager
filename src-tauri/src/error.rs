//! The single error type crossing the IPC boundary.
//!
//! Commands never return `String` errors: the frontend needs to distinguish a
//! validation failure it can attach to a form field from a database failure it
//! can only report. See `docs/architecture.md` §9.

use serde::Serialize;
use ts_rs::TS;

// `Clone` exists so a startup failure can be stored once and returned from every
// subsequent command, rather than being reported only to whoever asked first.
#[derive(Debug, Clone, Serialize, TS, thiserror::Error)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "AppError.ts")]
pub enum AppError {
    #[error("{field}: {message}")]
    Validation { field: String, message: String },

    #[error("{entity} {id} not found")]
    NotFound { entity: String, id: String },

    #[error("{message}")]
    Conflict { message: String },

    #[error("database error: {message}")]
    Database { message: String },

    #[error("filesystem error: {message}")]
    Io { message: String },

    #[error("migration failed: {message}")]
    Migration {
        message: String,
        backup_path: Option<String>,
    },

    #[error("internal error: {message}")]
    Internal { message: String },
}

impl AppError {
    pub fn validation(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Validation {
            field: field.into(),
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_with_a_discriminating_kind_tag() {
        let json = serde_json::to_value(AppError::validation("title", "must not be empty"))
            .expect("error should serialise");

        assert_eq!(json["kind"], "validation");
        assert_eq!(json["field"], "title");
        assert_eq!(json["message"], "must not be empty");
    }

    #[test]
    fn io_errors_convert_without_losing_their_message() {
        let source = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let error: AppError = source.into();

        match error {
            AppError::Io { message } => assert!(message.contains("denied")),
            other => panic!("expected Io, got {other:?}"),
        }
    }
}
