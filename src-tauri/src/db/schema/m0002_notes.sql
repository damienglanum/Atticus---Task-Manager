-- Notes: long-form writing that belongs to a project but not to any one task.
--
-- Deliberately not a task without a column. A note has no status, no position on
-- a board and nothing to drag; giving it those would make every board query
-- filter them out forever after. Ordered within its project like everything else
-- the user can reorder.
CREATE TABLE notes (
  id         TEXT    PRIMARY KEY,
  project_id TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX ux_notes_project_position ON notes (project_id, position);

-- Notes join the same full-text index the command palette already reads, so
-- searching finds writing as well as work. A separate external-content table
-- rather than rows in `tasks_fts`: that one is bound to the `tasks` rowid by
-- `content_rowid`, and two sources cannot share it.
CREATE VIRTUAL TABLE notes_fts USING fts5 (
  title,
  body,
  content = 'notes',
  content_rowid = 'rowid',
  tokenize = 'unicode61'
);

CREATE TRIGGER notes_fts_after_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER notes_fts_after_delete AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER notes_fts_after_update AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO notes_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
