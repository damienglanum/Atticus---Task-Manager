-- A note remains project-owned, but can point at any number of tasks in that
-- project. The relation is ordered from the note's perspective so callers can
-- replace `taskIds` without losing the order they supplied.
CREATE TABLE note_task_links (
  note_id    TEXT    NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  task_id    TEXT    NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL CHECK (position >= 0),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, task_id)
);

CREATE UNIQUE INDEX ux_note_task_links_note_position
  ON note_task_links (note_id, position);

-- The primary key begins with note_id. This reverse index keeps task deletion,
-- task snapshots, and task-to-note lookups from scanning the whole relation.
CREATE INDEX ix_note_task_links_task
  ON note_task_links (task_id);

-- Foreign keys prove that both parents exist; these triggers prove the part a
-- pair of independent foreign keys cannot express: both belong to one project.
CREATE TRIGGER note_task_links_same_project_before_insert
BEFORE INSERT ON note_task_links
WHEN NOT EXISTS (
  SELECT 1
  FROM notes note
  JOIN tasks task ON task.project_id = note.project_id
  WHERE note.id = new.note_id AND task.id = new.task_id
)
BEGIN
  SELECT RAISE(ABORT, 'a note can only link to a task in the same project');
END;

CREATE TRIGGER note_task_links_same_project_before_update
BEFORE UPDATE OF note_id, task_id ON note_task_links
WHEN NOT EXISTS (
  SELECT 1
  FROM notes note
  JOIN tasks task ON task.project_id = note.project_id
  WHERE note.id = new.note_id AND task.id = new.task_id
)
BEGIN
  SELECT RAISE(ABORT, 'a note can only link to a task in the same project');
END;
