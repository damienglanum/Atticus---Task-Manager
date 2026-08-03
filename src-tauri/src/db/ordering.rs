//! Dense integer positions, transactionally reindexed.
//!
//! Every ordered relation in the schema — projects, boards, columns, tasks,
//! subtasks — uses the same scheme and the same code, so there is one ordering
//! implementation to get right and one to test. See
//! `docs/adr/0004-ordering-strategy.md`.

use rusqlite::Transaction;

use crate::error::{AppError, AppResult};

/// Positions are shifted into this disjoint range before final values are
/// written. **This is a correctness requirement, not an optimisation**: the
/// unique indexes on `(parent, position)` are non-deferrable, so SQLite checks
/// them after every statement and a naive in-place renumber collides mid-flight.
const SCRATCH_OFFSET: i64 = 1_000_000;

/// A table whose rows are ordered within a parent.
///
/// Both names are compile-time constants and are interpolated into SQL. They are
/// never derived from user input; the only values that ever reach a query as
/// parameters are ids.
#[derive(Clone, Copy)]
pub struct Ordered {
    pub table: &'static str,
    /// `None` for a globally ordered table such as `projects`.
    pub parent_column: Option<&'static str>,
    /// Extra predicate restricting which rows take part in the ordering.
    /// Tasks use this so archived rows leave the sequence entirely.
    pub live_predicate: Option<&'static str>,
}

pub const PROJECTS: Ordered = Ordered {
    table: "projects",
    parent_column: None,
    live_predicate: None,
};

pub const BOARDS: Ordered = Ordered {
    table: "boards",
    parent_column: Some("project_id"),
    live_predicate: None,
};

pub const BOARD_COLUMNS: Ordered = Ordered {
    table: "board_columns",
    parent_column: Some("board_id"),
    live_predicate: None,
};

pub const SUBTASKS: Ordered = Ordered {
    table: "subtasks",
    parent_column: Some("task_id"),
    live_predicate: None,
};

pub const FILE_REFS: Ordered = Ordered {
    table: "file_refs",
    parent_column: Some("task_id"),
    live_predicate: None,
};

pub const LINK_REFS: Ordered = Ordered {
    table: "link_refs",
    parent_column: Some("task_id"),
    live_predicate: None,
};

pub const NOTES: Ordered = Ordered {
    table: "notes",
    parent_column: Some("project_id"),
    live_predicate: None,
};

pub const SAVED_FILTERS: Ordered = Ordered {
    table: "saved_filters",
    parent_column: Some("project_id"),
    live_predicate: None,
};

pub const TASKS: Ordered = Ordered {
    table: "tasks",
    parent_column: Some("column_id"),
    live_predicate: Some("archived_at IS NULL"),
};

impl Ordered {
    /// `WHERE` clause selecting the rows in one ordering scope.
    fn scope(&self) -> String {
        let mut clauses = Vec::new();
        if let Some(column) = self.parent_column {
            clauses.push(format!("{column} = ?1"));
        }
        if let Some(predicate) = self.live_predicate {
            clauses.push(predicate.to_owned());
        }
        if clauses.is_empty() {
            "1 = 1".to_owned()
        } else {
            clauses.join(" AND ")
        }
    }

    /// The bound parameters matching [`Ordered::scope`] — at most the parent id.
    fn params<'a>(&self, parent_id: Option<&'a str>) -> Vec<&'a str> {
        match (self.parent_column, parent_id) {
            (Some(_), Some(id)) => vec![id],
            _ => Vec::new(),
        }
    }
}

/// The position a new row should take to land at the end of its scope.
pub fn next_position(
    tx: &Transaction<'_>,
    ordered: Ordered,
    parent_id: Option<&str>,
) -> AppResult<i64> {
    let sql = format!(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM {} WHERE {}",
        ordered.table,
        ordered.scope()
    );

    let next = tx.query_row(
        &sql,
        rusqlite::params_from_iter(ordered.params(parent_id)),
        |row| row.get::<_, i64>(0),
    )?;

    Ok(next)
}

/// The ids in one ordering scope, in their current order.
pub fn ids_in_order(
    tx: &Transaction<'_>,
    ordered: Ordered,
    parent_id: Option<&str>,
) -> AppResult<Vec<String>> {
    let sql = format!(
        "SELECT id FROM {} WHERE {} ORDER BY position",
        ordered.table,
        ordered.scope()
    );

    let mut statement = tx.prepare(&sql)?;
    let rows = statement.query_map(
        rusqlite::params_from_iter(ordered.params(parent_id)),
        |row| row.get::<_, String>(0),
    )?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Rewrites the scope's positions to a dense `0..n-1` sequence matching
/// `ordered_ids`.
///
/// Rejects an id list that is not a permutation of what the scope actually
/// contains: silently ignoring an unknown id, or dropping a missing one, would
/// leave the sequence sparse or duplicated — exactly the corruption this design
/// exists to prevent.
pub fn apply_order(
    tx: &Transaction<'_>,
    ordered: Ordered,
    parent_id: Option<&str>,
    ordered_ids: &[String],
) -> AppResult<()> {
    let existing = ids_in_order(tx, ordered, parent_id)?;

    if existing.len() != ordered_ids.len() {
        return Err(AppError::Conflict {
            message: format!(
                "the requested order lists {} items but {} exist — refusing to reorder",
                ordered_ids.len(),
                existing.len(),
            ),
        });
    }

    let mut sorted_existing = existing.clone();
    let mut sorted_requested = ordered_ids.to_vec();
    sorted_existing.sort();
    sorted_requested.sort();
    if sorted_existing != sorted_requested {
        return Err(AppError::Conflict {
            message: "the requested order does not match the items that exist".to_owned(),
        });
    }

    // Phase one: move every affected row out of the way.
    let shift = format!(
        "UPDATE {} SET position = position + {SCRATCH_OFFSET} WHERE {}",
        ordered.table,
        ordered.scope()
    );
    tx.execute(
        &shift,
        rusqlite::params_from_iter(ordered.params(parent_id)),
    )?;

    // Phase two: write the dense sequence.
    let assign = format!("UPDATE {} SET position = ?1 WHERE id = ?2", ordered.table);
    let mut statement = tx.prepare(&assign)?;
    for (index, id) in ordered_ids.iter().enumerate() {
        statement.execute(rusqlite::params![index as i64, id])?;
    }

    Ok(())
}

/// Moves an existing row to a given index within its scope.
///
/// The row must already be in the scope, at any position — insert it at
/// [`next_position`] first, then place it. Doing it this way rather than with an
/// `UPDATE ... SET position = position + 1 WHERE position >= n` is a correctness
/// requirement, not a preference: that shift walks rows in an order SQLite
/// chooses, and the unique index on `(parent, position)` is checked after every
/// statement, so it collides with itself the moment more than one row has to
/// move. Everything that opens a slot — restoring a deleted row, duplicating a
/// task — goes through here so there is one implementation to get right.
///
/// An index past the end appends.
pub fn place_at(
    tx: &Transaction<'_>,
    ordered: Ordered,
    parent_id: Option<&str>,
    id: &str,
    index: i64,
) -> AppResult<()> {
    let mut ids = ids_in_order(tx, ordered, parent_id)?;
    ids.retain(|existing| existing != id);

    let index = usize::try_from(index.max(0))
        .unwrap_or(usize::MAX)
        .min(ids.len());
    ids.insert(index, id.to_owned());

    apply_order(tx, ordered, parent_id, &ids)
}

/// Closes gaps left by a removal, without changing relative order.
pub fn compact(tx: &Transaction<'_>, ordered: Ordered, parent_id: Option<&str>) -> AppResult<()> {
    let ids = ids_in_order(tx, ordered, parent_id)?;
    apply_order(tx, ordered, parent_id, &ids)
}

/// Debug-only invariant check: positions in a scope are exactly `0..n-1`.
pub fn assert_dense(
    tx: &Transaction<'_>,
    ordered: Ordered,
    parent_id: Option<&str>,
) -> AppResult<()> {
    let sql = format!(
        "SELECT position FROM {} WHERE {} ORDER BY position",
        ordered.table,
        ordered.scope()
    );
    let mut statement = tx.prepare(&sql)?;
    let positions: Vec<i64> = statement
        .query_map(
            rusqlite::params_from_iter(ordered.params(parent_id)),
            |row| row.get::<_, i64>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;

    let expected: Vec<i64> = (0..positions.len() as i64).collect();
    if positions == expected {
        Ok(())
    } else {
        Err(AppError::Internal {
            message: format!(
                "ordering invariant broken in {}: expected {expected:?}, found {positions:?}",
                ordered.table
            ),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn seed_boards(db: &mut Database, count: usize) -> Vec<String> {
        let tx = db.connection_mut().transaction().expect("transaction");
        tx.execute(
            "INSERT INTO projects (id, name, color, key_prefix, position, created_at, updated_at) \
             VALUES ('p1', 'Project', 'indigo', 'PRJ', 0, 0, 0)",
            [],
        )
        .expect("project insert");

        let mut ids = Vec::new();
        for index in 0..count {
            let id = format!("b{index}");
            tx.execute(
                "INSERT INTO boards (id, project_id, name, position, created_at, updated_at) \
                 VALUES (?1, 'p1', ?2, ?3, 0, 0)",
                rusqlite::params![id, format!("Board {index}"), index as i64],
            )
            .expect("board insert");
            ids.push(id);
        }
        tx.commit().expect("commit");
        ids
    }

    #[test]
    fn next_position_appends_to_the_end() {
        let mut db = Database::open_in_memory().expect("database");
        seed_boards(&mut db, 3);

        let tx = db.connection_mut().transaction().expect("transaction");
        assert_eq!(next_position(&tx, BOARDS, Some("p1")).expect("next"), 3);
    }

    #[test]
    fn next_position_starts_at_zero_in_an_empty_scope() {
        let mut db = Database::open_in_memory().expect("database");
        seed_boards(&mut db, 0);

        let tx = db.connection_mut().transaction().expect("transaction");
        assert_eq!(next_position(&tx, BOARDS, Some("p1")).expect("next"), 0);
    }

    #[test]
    fn reversing_the_order_works_despite_the_unique_index() {
        // This is the case a single-phase renumber gets wrong: every row's new
        // position is occupied by another row at the moment it is written.
        let mut db = Database::open_in_memory().expect("database");
        let mut ids = seed_boards(&mut db, 5);
        ids.reverse();

        let tx = db.connection_mut().transaction().expect("transaction");
        apply_order(&tx, BOARDS, Some("p1"), &ids).expect("reorder should succeed");
        assert_dense(&tx, BOARDS, Some("p1")).expect("positions should be dense");

        assert_eq!(ids_in_order(&tx, BOARDS, Some("p1")).expect("read"), ids);
    }

    #[test]
    fn many_shuffles_leave_the_sequence_dense() {
        let mut db = Database::open_in_memory().expect("database");
        let ids = seed_boards(&mut db, 12);

        // Deterministic pseudo-shuffle, so a failure is reproducible.
        let mut order = ids.clone();
        let mut seed: u64 = 0x5DEE_CE66_D16B_578F;
        for round in 0..200 {
            for index in (1..order.len()).rev() {
                seed = seed
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                let swap = (seed >> 33) as usize % (index + 1);
                order.swap(index, swap);
            }

            let tx = db.connection_mut().transaction().expect("transaction");
            apply_order(&tx, BOARDS, Some("p1"), &order).expect("reorder should succeed");
            assert_dense(&tx, BOARDS, Some("p1"))
                .unwrap_or_else(|error| panic!("round {round}: {error:?}"));
            assert_eq!(ids_in_order(&tx, BOARDS, Some("p1")).expect("read"), order);
            tx.commit().expect("commit");
        }
    }

    #[test]
    fn an_order_missing_an_item_is_refused() {
        let mut db = Database::open_in_memory().expect("database");
        let ids = seed_boards(&mut db, 4);

        let tx = db.connection_mut().transaction().expect("transaction");
        let error = apply_order(&tx, BOARDS, Some("p1"), &ids[..3])
            .expect_err("a partial order must be refused");

        assert!(matches!(error, AppError::Conflict { .. }));
    }

    #[test]
    fn an_order_naming_an_unknown_item_is_refused() {
        let mut db = Database::open_in_memory().expect("database");
        let mut ids = seed_boards(&mut db, 3);
        ids[0] = "not-a-board".to_owned();

        let tx = db.connection_mut().transaction().expect("transaction");
        let error =
            apply_order(&tx, BOARDS, Some("p1"), &ids).expect_err("an unknown id must be refused");

        assert!(matches!(error, AppError::Conflict { .. }));
    }

    #[test]
    fn compact_closes_a_gap_left_by_a_deletion() {
        let mut db = Database::open_in_memory().expect("database");
        seed_boards(&mut db, 5);
        db.connection()
            .execute("DELETE FROM boards WHERE id = 'b2'", [])
            .expect("delete");

        let tx = db.connection_mut().transaction().expect("transaction");
        compact(&tx, BOARDS, Some("p1")).expect("compact should succeed");

        assert_dense(&tx, BOARDS, Some("p1")).expect("positions should be dense");
        assert_eq!(
            ids_in_order(&tx, BOARDS, Some("p1")).expect("read"),
            vec!["b0", "b1", "b3", "b4"],
        );
    }

    #[test]
    fn ordering_scopes_do_not_interfere() {
        let mut db = Database::open_in_memory().expect("database");
        seed_boards(&mut db, 3);
        db.connection()
            .execute_batch(
                "INSERT INTO projects (id, name, color, key_prefix, position, created_at, updated_at)
                   VALUES ('p2', 'Other', 'teal', 'OTH', 1, 0, 0);
                 INSERT INTO boards (id, project_id, name, position, created_at, updated_at)
                   VALUES ('x0', 'p2', 'X0', 0, 0, 0), ('x1', 'p2', 'X1', 1, 0, 0);",
            )
            .expect("second project");

        let tx = db.connection_mut().transaction().expect("transaction");
        apply_order(
            &tx,
            BOARDS,
            Some("p1"),
            &["b2".to_owned(), "b1".to_owned(), "b0".to_owned()],
        )
        .expect("reorder p1");

        assert_eq!(
            ids_in_order(&tx, BOARDS, Some("p2")).expect("read p2"),
            vec!["x0", "x1"],
            "reordering one project's boards must not disturb another's",
        );
    }
}
