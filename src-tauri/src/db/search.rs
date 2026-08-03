//! Full-text search across every live project.
//!
//! Backed by the FTS5 index declared in migration 1, which is an
//! external-content table over `tasks` kept in step by triggers — so there is no
//! second copy of a title or description to drift.

use std::collections::HashSet;

use rmcp::schemars::JsonSchema;
use rusqlite::{Connection, Row};
use serde::Serialize;
use ts_rs::TS;

use crate::domain::validate::{KEY_PREFIX_MAX, KEY_PREFIX_MIN};
use crate::error::AppResult;

#[derive(Debug, Serialize, TS, JsonSchema)]
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
    #[schemars(description = "True only when MCP may mutate this live task.")]
    pub writable: bool,
    #[schemars(
        description = "Matching description fragment, or empty for a title/reference match."
    )]
    pub excerpt: String,
}

/// Parses a complete human task reference such as `TES-14`.
///
/// Project keys use ASCII letters and task numbers start at one. Surrounding
/// whitespace is harmless, but any other text makes this an ordinary search
/// query rather than a reference lookup.
fn parse_task_reference(input: &str) -> Option<(&str, i64)> {
    let input = input.trim();
    let (prefix, number) = input.split_once('-')?;

    if !(KEY_PREFIX_MIN..=KEY_PREFIX_MAX).contains(&prefix.len())
        || !prefix
            .bytes()
            .all(|character| character.is_ascii_alphabetic())
        || number.is_empty()
        || !number.bytes().all(|character| character.is_ascii_digit())
    {
        return None;
    }

    let number = number.parse::<i64>().ok()?;
    (number > 0).then_some((prefix, number))
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

fn row_to_search_hit(row: &Row<'_>) -> rusqlite::Result<SearchHit> {
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
        writable: row.get("writable")?,
        excerpt: row.get("excerpt")?,
    })
}

fn exact_reference_hits(
    conn: &Connection,
    prefix: &str,
    number: i64,
    limit: i64,
) -> AppResult<Vec<SearchHit>> {
    let mut statement = conn.prepare(
        "SELECT t.id, t.board_id, t.project_id, t.number, t.title, \
                p.name AS project_name, p.key_prefix, \
                b.name AS board_name, c.name AS column_name, \
                t.archived_at IS NOT NULL AS archived, \
                t.archived_at IS NULL AND EXISTS( \
                    SELECT 1 FROM mcp_managed_projects managed \
                    WHERE managed.project_id = t.project_id \
                ) AS writable, \
                '' AS excerpt \
         FROM tasks t \
         JOIN projects p ON p.id = t.project_id \
         JOIN boards b ON b.id = t.board_id \
         JOIN board_columns c ON c.id = t.column_id \
         WHERE p.key_prefix = ?1 COLLATE NOCASE \
           AND t.number = ?2 \
           AND p.archived_at IS NULL \
         ORDER BY (t.archived_at IS NOT NULL), p.position \
         LIMIT ?3",
    )?;

    let hits = statement
        .query_map(rusqlite::params![prefix, number, limit], row_to_search_hit)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(hits)
}

fn full_text_hits(conn: &Connection, query: &str, limit: i64) -> AppResult<Vec<SearchHit>> {
    let mut statement = conn.prepare(
        "SELECT t.id, t.board_id, t.project_id, t.number, t.title, \
                p.name AS project_name, p.key_prefix, \
                b.name AS board_name, c.name AS column_name, \
                t.archived_at IS NOT NULL AS archived, \
                t.archived_at IS NULL AND EXISTS( \
                    SELECT 1 FROM mcp_managed_projects managed \
                    WHERE managed.project_id = t.project_id \
                ) AS writable, \
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
        .query_map(rusqlite::params![query, limit], row_to_search_hit)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(hits)
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

    let positive_limit = usize::try_from(limit).ok();
    let mut hits = match parse_task_reference(input) {
        Some((prefix, number)) => exact_reference_hits(conn, prefix, number, limit)?,
        None => Vec::new(),
    };

    if positive_limit.is_some_and(|limit| hits.len() >= limit) {
        hits.truncate(positive_limit.unwrap_or_default());
        return Ok(hits);
    }

    // An exact hit can also happen to contain the reference tokens in its
    // title or description. Fetch enough FTS rows to replace any such duplicate
    // after de-duplication while still honoring the caller's limit.
    let fts_limit = if limit >= 0 {
        limit.saturating_add(i64::try_from(hits.len()).unwrap_or(i64::MAX))
    } else {
        limit
    };
    let fts_hits = full_text_hits(conn, &query, fts_limit)?;
    let mut seen: HashSet<String> = hits.iter().map(|hit| hit.task_id.clone()).collect();
    hits.extend(
        fts_hits
            .into_iter()
            .filter(|hit| seen.insert(hit.task_id.clone())),
    );

    if let Some(limit) = positive_limit {
        hits.truncate(limit);
    }

    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn task_references_require_only_a_key_prefix_and_positive_number() {
        assert_eq!(parse_task_reference("TES-14"), Some(("TES", 14)));
        assert_eq!(parse_task_reference(" tes-14 "), Some(("tes", 14)));

        for input in [
            "TES",
            "TES-",
            "TES-0",
            "T-14",
            "TOOLONG-14",
            "TE5-14",
            "TES--14",
            "TES-14 extra",
        ] {
            assert_eq!(parse_task_reference(input), None, "{input}");
        }
    }

    #[test]
    fn exact_reference_lookup_is_case_insensitive_prioritized_and_reports_writability() {
        let db = Database::open_in_memory().expect("database");
        db.connection()
            .execute_batch(
                "INSERT INTO projects
                   (id, name, color, key_prefix, position, created_at, updated_at)
                 VALUES ('managed-project', 'Managed', 'indigo', 'TES', 0, 0, 0);
                 INSERT INTO mcp_managed_projects (project_id, created_at)
                 VALUES ('managed-project', 0);
                 INSERT INTO boards (id, project_id, name, position, created_at, updated_at)
                 VALUES ('managed-board', 'managed-project', 'Work', 0, 0, 0);
                 INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at)
                 VALUES ('managed-column', 'managed-board', 'Todo', 0, 0, 0);
                 INSERT INTO tasks
                   (id, project_id, board_id, column_id, number, title, position,
                    created_at, updated_at)
                 VALUES
                   ('reference-task', 'managed-project', 'managed-board', 'managed-column',
                    14, 'A title absent from the reference', 0, 0, 0);

                 INSERT INTO projects
                   (id, name, color, key_prefix, position, created_at, updated_at)
                 VALUES ('other-project', 'Other', 'blue', 'OTH', 1, 0, 0);
                 INSERT INTO boards (id, project_id, name, position, created_at, updated_at)
                 VALUES ('other-board', 'other-project', 'Board', 0, 0, 0);
                 INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at)
                 VALUES ('other-column', 'other-board', 'Backlog', 0, 0, 0);
                 INSERT INTO tasks
                   (id, project_id, board_id, column_id, number, title, position,
                    created_at, updated_at)
                 VALUES
                   ('fts-task', 'other-project', 'other-board', 'other-column', 1,
                    'TES 14 appears in this title', 0, 0, 0);",
            )
            .expect("seed search graph");

        let hits = search(db.connection(), "tes-14", 20).expect("search exact reference");

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].task_id, "reference-task");
        assert_eq!(hits[0].project_key_prefix, "TES");
        assert_eq!(hits[0].number, 14);
        assert_eq!(hits[0].excerpt, "");
        assert!(hits[0].writable);
        assert_eq!(hits[1].task_id, "fts-task");
        assert!(!hits[1].writable);

        db.connection()
            .execute(
                "UPDATE tasks SET archived_at = 1 WHERE id = 'reference-task'",
                [],
            )
            .expect("archive exact task");
        let archived = search(db.connection(), "TES-14", 20).expect("find archived reference");
        assert_eq!(archived[0].task_id, "reference-task");
        assert!(archived[0].archived);
        assert!(!archived[0].writable);
    }

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
