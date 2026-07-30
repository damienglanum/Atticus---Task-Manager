//! Full-text search across every live project.
//!
//! Backed by the FTS5 index declared in migration 1, which is an
//! external-content table over `tasks` kept in step by triggers — so there is no
//! second copy of a title or description to drift.

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::error::AppResult;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "SearchHit.ts")]
pub struct SearchHit {
    pub task_id: String,
    pub board_id: String,
    pub project_id: String,
    #[ts(type = "number")]
    pub number: i64,
    pub title: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub board_name: String,
    pub column_name: String,
    pub archived: bool,
    /// A fragment of the description with the match in it, or empty when the
    /// match was in the title alone.
    pub excerpt: String,
}

/// Turns what the user typed into an FTS5 query.
///
/// FTS5 has its own syntax — quotes, `*`, `NEAR`, `AND`/`OR`, column filters —
/// and a stray `"` in ordinary typing is a syntax error, not a search for a
/// quote. So the input is never passed through: each run of word characters
/// becomes one quoted term, and the last one gets a `*` so results appear while
/// the user is still typing.
pub fn to_fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|term| !term.is_empty())
        .map(|term| term.replace('"', ""))
        .filter(|term| !term.is_empty())
        .collect();

    if terms.is_empty() {
        return None;
    }

    let last = terms.len() - 1;
    let query = terms
        .iter()
        .enumerate()
        .map(|(index, term)| {
            if index == last {
                format!("\"{term}\"*")
            } else {
                format!("\"{term}\"")
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    Some(query)
}

/// Searches titles and descriptions, best match first.
///
/// Archived tasks are included but rank below live ones: someone searching for
/// something they finished last month still wants to find it, and someone
/// searching for current work does not want the archive in their way.
pub fn search(conn: &Connection, input: &str, limit: i64) -> AppResult<Vec<SearchHit>> {
    let Some(query) = to_fts_query(input) else {
        return Ok(Vec::new());
    };

    let mut statement = conn.prepare(
        "SELECT t.id, t.board_id, t.project_id, t.number, t.title, \
                p.name AS project_name, p.key_prefix, \
                b.name AS board_name, c.name AS column_name, \
                t.archived_at IS NOT NULL AS archived, \
                snippet(tasks_fts, 1, '', '', '…', 12) AS excerpt \
         FROM tasks_fts \
         JOIN tasks t ON t.rowid = tasks_fts.rowid \
         JOIN projects p ON p.id = t.project_id \
         JOIN boards b ON b.id = t.board_id \
         JOIN board_columns c ON c.id = t.column_id \
         WHERE tasks_fts MATCH ?1 AND p.archived_at IS NULL \
         ORDER BY (t.archived_at IS NOT NULL), bm25(tasks_fts, 10.0, 1.0) \
         LIMIT ?2",
    )?;

    let hits = statement
        .query_map(rusqlite::params![query, limit], |row| {
            Ok(SearchHit {
                task_id: row.get("id")?,
                board_id: row.get("board_id")?,
                project_id: row.get("project_id")?,
                number: row.get("number")?,
                title: row.get("title")?,
                project_name: row.get("project_name")?,
                project_key_prefix: row.get("key_prefix")?,
                board_name: row.get("board_name")?,
                column_name: row.get("column_name")?,
                archived: row.get("archived")?,
                excerpt: row.get("excerpt")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_words_become_quoted_terms_with_a_prefix_on_the_last() {
        assert_eq!(
            to_fts_query("release notes"),
            Some(r#""release" "notes"*"#.to_owned())
        );
    }

    #[test]
    fn punctuation_a_user_types_is_not_treated_as_syntax() {
        // Each of these is an FTS5 syntax error if passed through unchanged.
        for input in ["\"", "foo\"bar", "a*b", "NEAR(a b)", "a AND", "-", "()"] {
            let query = to_fts_query(input);
            if let Some(ref built) = query {
                assert!(
                    !built.contains("NEAR(") && !built.contains(" AND ") && !built.contains('('),
                    "{input} produced {built}"
                );
            }
        }
    }

    #[test]
    fn an_empty_or_punctuation_only_query_searches_for_nothing() {
        for input in ["", "   ", "!!!", "-- ??"] {
            assert_eq!(to_fts_query(input), None, "{input}");
        }
    }

    #[test]
    fn underscores_are_kept_because_identifiers_contain_them() {
        assert_eq!(
            to_fts_query("board_load"),
            Some(r#""board_load"*"#.to_owned())
        );
    }
}
