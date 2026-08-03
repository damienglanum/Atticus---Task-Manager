-- Migration 4 — isolate AI-managed work.
--
-- A project in this table is the hard write boundary for the MCP server. Existing
-- projects are deliberately absent and therefore user-managed. Cascading the row
-- keeps deletion ordinary and makes it impossible to leave a stale permission.

CREATE TABLE mcp_managed_projects (
  project_id TEXT    PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
