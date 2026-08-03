-- Migration 3 — web links attached to tasks.

CREATE TABLE link_refs (
  id         TEXT    PRIMARY KEY,
  task_id    TEXT    NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  url        TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_link_refs_task_position ON link_refs (task_id, position);
