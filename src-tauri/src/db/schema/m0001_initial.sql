-- Migration 1 — initial schema.
--
-- Released migrations are immutable. A mistake here is corrected by adding
-- migration 2, never by editing this file. See docs/adr/0003-migration-strategy.md.
--
-- Conventions:
--   * ids are UUIDv7 stored as TEXT — sortable by creation, collision-free on import merge
--   * timestamps are UTC epoch milliseconds (INTEGER)
--   * due dates are calendar dates 'YYYY-MM-DD' (TEXT), never instants: with no
--     time-of-day there is no DST transition that can move a due date
--
-- PRAGMAs are deliberately absent: foreign_keys, journal_mode and synchronous are
-- per-connection settings applied on every open in db/mod.rs, not properties of
-- the file that a migration could establish once.

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  description TEXT    NOT NULL,
  applied_at  INTEGER NOT NULL
);

CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE projects (
  id               TEXT    PRIMARY KEY,
  name             TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  color            TEXT    NOT NULL,
  key_prefix       TEXT    NOT NULL,
  next_task_number INTEGER NOT NULL DEFAULT 1,
  directory_path   TEXT,
  position         INTEGER NOT NULL,
  archived_at      INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_projects_position ON projects (position);

CREATE TABLE boards (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_boards_project_position ON boards (project_id, position);

-- Named board_columns rather than columns: 'columns' collides with SQLite's own
-- vocabulary and makes every query harder to read.
CREATE TABLE board_columns (
  id         TEXT    PRIMARY KEY,
  board_id   TEXT    NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  wip_limit  INTEGER CHECK (wip_limit IS NULL OR wip_limit > 0),
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_columns_board_position ON board_columns (board_id, position);

CREATE TABLE tasks (
  id               TEXT    PRIMARY KEY,
  project_id       TEXT    NOT NULL REFERENCES projects (id)      ON DELETE CASCADE,
  board_id         TEXT    NOT NULL REFERENCES boards (id)        ON DELETE CASCADE,
  column_id        TEXT    NOT NULL REFERENCES board_columns (id) ON DELETE CASCADE,
  number           INTEGER NOT NULL,
  title            TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  priority         INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  due_date         TEXT    CHECK (
                     due_date IS NULL
                     OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                   ),
  estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes > 0),
  position         INTEGER NOT NULL,
  archived_at      INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE UNIQUE INDEX ux_tasks_project_number ON tasks (project_id, number);

-- Partial index: archiving removes a task from the ordering sequence entirely,
-- so an archived task can never occupy or collide with a live position. This is
-- what makes duplicate or missing positions impossible rather than merely
-- unlikely. See docs/adr/0004-ordering-strategy.md.
CREATE UNIQUE INDEX ux_tasks_column_position ON tasks (column_id, position)
  WHERE archived_at IS NULL;

CREATE INDEX ix_tasks_board_live ON tasks (board_id) WHERE archived_at IS NULL;
CREATE INDEX ix_tasks_project_archived ON tasks (project_id, archived_at);
CREATE INDEX ix_tasks_due ON tasks (due_date)
  WHERE archived_at IS NULL AND due_date IS NOT NULL;

CREATE TABLE subtasks (
  id         TEXT    PRIMARY KEY,
  task_id    TEXT    NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_subtasks_task_position ON subtasks (task_id, position);

CREATE TABLE labels (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_labels_project ON labels (project_id);

CREATE TABLE task_labels (
  task_id  TEXT NOT NULL REFERENCES tasks (id)  ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX ix_task_labels_label ON task_labels (label_id);

CREATE TABLE file_refs (
  id               TEXT    PRIMARY KEY,
  task_id          TEXT    NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  path             TEXT    NOT NULL,
  display_name     TEXT    NOT NULL,
  last_verified_at INTEGER,
  found            INTEGER NOT NULL DEFAULT 1 CHECK (found IN (0, 1)),
  position         INTEGER NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_file_refs_task_position ON file_refs (task_id, position);

CREATE TABLE saved_filters (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  filter     TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_saved_filters_project_position
  ON saved_filters (project_id, position);

-- Full-text search. An external-content FTS5 table indexes the `tasks` rows in
-- place, so there is no second copy of the title and description to drift.
CREATE VIRTUAL TABLE tasks_fts USING fts5 (
  title,
  description,
  content = 'tasks',
  content_rowid = 'rowid',
  tokenize = 'unicode61'
);

CREATE TRIGGER tasks_fts_after_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts (rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER tasks_fts_after_delete AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts (tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
END;

CREATE TRIGGER tasks_fts_after_update AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts (tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO tasks_fts (rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;
