//! Small key/value store for settings that must survive a restart.
//!
//! Values are JSON so a key can grow from a string to a struct without a schema
//! migration. Reads are **total**: a missing or unparseable value falls back to
//! the default rather than failing to start the application, because a corrupt
//! preference should never be the reason a user cannot see their tasks. The
//! fallback is logged, not swallowed silently.

use rusqlite::{Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};

use crate::error::{AppError, AppResult};

pub fn set<T: Serialize>(conn: &Connection, key: &str, value: &T) -> AppResult<()> {
    let encoded = serde_json::to_string(value).map_err(|error| AppError::Internal {
        message: format!("could not encode app_state value for '{key}': {error}"),
    })?;

    conn.execute(
        "INSERT INTO app_state (key, value) VALUES (?1, ?2) \
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, encoded],
    )?;

    Ok(())
}

/// Reads `key`, falling back to `default` when it is absent or unreadable.
pub fn get_or<T: DeserializeOwned>(conn: &Connection, key: &str, default: T) -> AppResult<T> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM app_state WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?;

    let Some(raw) = raw else { return Ok(default) };

    match serde_json::from_str(&raw) {
        Ok(value) => Ok(value),
        Err(error) => {
            eprintln!("app_state: ignoring unreadable value for '{key}': {error}");
            Ok(default)
        }
    }
}

/// Stores a value that is already a string, without a second JSON encoding.
///
/// The typed [`set`] wraps its argument in JSON; for a value the caller has
/// already serialised — an interface preference the frontend owns the shape of —
/// that would produce a JSON string containing JSON.
pub fn set_raw(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO app_state (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// Reads a raw value, or `None` when the key has never been written.
pub fn get_raw(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM app_state WHERE key = ?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn a_value_round_trips() {
        let db = Database::open_in_memory().expect("database opens");

        set(db.connection(), "theme", &"dark").expect("set should succeed");

        let value: String =
            get_or(db.connection(), "theme", "system".to_owned()).expect("get should succeed");
        assert_eq!(value, "dark");
    }

    #[test]
    fn writing_the_same_key_twice_replaces_rather_than_conflicts() {
        let db = Database::open_in_memory().expect("database opens");

        set(db.connection(), "theme", &"dark").expect("first write");
        set(db.connection(), "theme", &"light").expect("second write");

        let value: String =
            get_or(db.connection(), "theme", "system".to_owned()).expect("get should succeed");
        assert_eq!(value, "light");
    }

    #[test]
    fn a_missing_key_yields_the_default() {
        let db = Database::open_in_memory().expect("database opens");

        let value: String = get_or(db.connection(), "never-written", "system".to_owned())
            .expect("get should succeed");

        assert_eq!(value, "system");
    }

    #[test]
    fn a_corrupt_value_yields_the_default_rather_than_failing_to_start() {
        let db = Database::open_in_memory().expect("database opens");
        db.connection()
            .execute(
                "INSERT INTO app_state (key, value) VALUES ('theme', 'not valid json')",
                [],
            )
            .expect("insert should succeed");

        let value: String =
            get_or(db.connection(), "theme", "system".to_owned()).expect("get should succeed");

        assert_eq!(value, "system");
    }
}
