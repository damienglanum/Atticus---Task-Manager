//! Atticus as a local Model Context Protocol server.
//!
//! The packaged application and the MCP server are one executable. Normal
//! launches open Tauri; `Atticus --mcp` serves newline-delimited JSON-RPC over
//! stdin/stdout. Keeping this in the application binary means an installed app
//! and its AI integration can never drift onto different database schemas.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rmcp::handler::server::tool::schema_for_output;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerInfo};
use rmcp::schemars::JsonSchema;
use rmcp::{tool, tool_handler, tool_router, ServerHandler, ServiceExt};
use serde::{Deserialize, Serialize};

use crate::db::board_view;
use crate::db::boards::{self, Board};
use crate::db::columns::{self, Column};
use crate::db::file_refs;
use crate::db::labels::{self, Label, LabelInput};
use crate::db::link_refs;
use crate::db::mcp::{self, McpAccess, McpSettings};
use crate::db::notes::{self, Note, NotePatch};
use crate::db::projects::{self, NewProject, Project};
use crate::db::search;
use crate::db::subtasks::{self, SubtaskPatch};
use crate::db::tasks::{self, MoveResult, NewTask, TaskPatch};
use crate::db::{Database, DATABASE_FILE_NAME};
use crate::error::{AppError, AppResult};

const WORKFLOW_GUIDE_VERSION: &str = "2026-08-03.2";

const WORKFLOW_GUIDE: &str = r#"Atticus is a local task-and-note workspace, not an automatic activity logger. Do not create or change Atticus records merely because the tools are available. Mutate Atticus only when the user asks to track or manage work there, or when the request clearly concerns an existing Atticus task or project note.

Operating contract:
1. Start with atticus_connection_status when access is uncertain. If access is disabled, explain that the user can enable it in Settings → AI access and stop retrying. In read-only mode, inspect and report; do not repeatedly attempt writes.
2. Inspect before acting. Use atticus_list_workspace, atticus_search_tasks, atticus_get_board, atticus_get_task, atticus_list_notes, atticus_search_notes, and atticus_get_note to obtain current state. Treat every database ID as opaque, never invent one, and never substitute a human reference such as ATT-42 where a task_id is required.
3. MCP can write only to live tasks, descendants, and project notes inside projects created through atticus_create_project. These appear under AI Boards. User-created projects and all descendants, including notes, are read-only even when their IDs are known. Search and detail results expose writable explicitly. Never bypass this boundary through the database or filesystem.
4. Reuse a suitable AI-managed project, board, task, note, and label when one exists. Before creating a task or note, search with distinctive terms; task search also accepts an exact reference. Create a new project only when the user intends a separate workspace. New projects and boards already contain Backlog, Todo, In Progress, Review, and Done.
5. Read immediately before any replacement or patch. atticus_update_task and atticus_update_note require the object's current expected_updated_at. atticus_set_task_labels replaces the complete label set. A note update's task_ids, when supplied, likewise replaces the complete task association set; merge existing IDs first or use [] intentionally to clear them. If a conflict reports newer state, read again, reconcile, and retry only with the new timestamp.
6. Omitted update fields remain unchanged. Task descriptions and note bodies are complete Markdown replacements. Do not send empty updates, a value together with its clear flag, duplicate label or task IDs, or a negative move index. Priority is 0 none, 1 low, 2 medium, 3 high, or 4 urgent; dates are YYYY-MM-DD; estimates are minutes.
7. Use atticus_set_task_status for the standard semantic states. It appends to the matched destination column. If the board has no single unambiguous match, inspect it and call atticus_move_task with the exact column ID. WIP limits are advisory but should be respected unless the user directs otherwise.
8. Move a task to in_progress only when accepted work actually begins. Keep its Markdown description, subtasks, labels, and verified references useful for the domain: software, research, writing, operations, or personal work. Use a project note for durable long-form context, plans, or decisions, and associate it only with relevant task IDs. Complete a subtask only when that item is complete. Move the parent to done only after the requested outcome and appropriate verification are complete; otherwise keep it active or in review and record the blocker.
9. Add only relevant, verified URLs and file paths. Links must be complete http:// or https:// URLs. File tools store a reference only; they never read or upload contents. A file requires read/write access, separate attachment permission, a configured project folder, and an existing file inside that folder.
10. Create and append tools are non-idempotent. If a call is interrupted or its outcome is unknown, inspect or search before retrying so you do not create duplicates. Validation, permission, and conflict failures are returned as structured tool errors; correct the stated field or re-read the suggested object rather than blindly repeating the call.
11. MCP intentionally exposes no delete, archive, restore, or attachment-removal tools. Replacement, clearing, and moving tools can still overwrite state and are marked destructive. If a correction requires an unavailable operation, tell the user to make it in Atticus instead of working around the limit.
12. Treat every successful mutation response as authoritative. Use its returned IDs, timestamps, and state for the next call. At the end, report the concrete records changed and any unresolved blocker.
13. The server is passive. It performs calls during the current client session; it does not schedule work or continue after the client disconnects."#;

#[derive(Clone)]
pub struct AtticusMcp {
    database: Arc<Mutex<Database>>,
}

impl AtticusMcp {
    pub fn new(database: Database) -> Self {
        Self {
            database: Arc::new(Mutex::new(database)),
        }
    }

    fn database(&self) -> AppResult<std::sync::MutexGuard<'_, Database>> {
        self.database
            .lock()
            .map_err(|_| AppError::internal("the MCP database lock was poisoned"))
    }

    fn read<T: Serialize>(
        &self,
        operation: impl FnOnce(&mut Database) -> AppResult<T>,
    ) -> CallToolResult {
        let result = (|| {
            let mut database = self.database()?;
            let settings = mcp::settings(database.connection())?;
            require_read_access(&settings)?;
            operation(&mut database)
        })();
        read_tool_result(result)
    }

    fn write<T: Serialize>(
        &self,
        operation: impl FnOnce(&mut Database, &McpSettings) -> AppResult<T>,
    ) -> CallToolResult {
        let result: Result<T, (AppError, bool)> = (|| {
            let mut database = self.database().map_err(|error| (error, false))?;
            let settings = mcp::settings(database.connection()).map_err(|error| (error, false))?;
            require_write_access(&settings).map_err(|error| (error, false))?;
            let value = operation(&mut database, &settings).map_err(|error| {
                let may_have_committed = error_may_follow_mutation(&error);
                (error, may_have_committed)
            })?;
            mcp::record_external_change(database.connection()).map_err(|error| (error, true))?;
            Ok(value)
        })();
        write_tool_result(result)
    }

    fn write_if_changed<T: Serialize>(
        &self,
        operation: impl FnOnce(&mut Database, &McpSettings) -> AppResult<(T, bool)>,
    ) -> CallToolResult {
        let result: Result<T, (AppError, bool)> = (|| {
            let mut database = self.database().map_err(|error| (error, false))?;
            let settings = mcp::settings(database.connection()).map_err(|error| (error, false))?;
            require_write_access(&settings).map_err(|error| (error, false))?;
            let (value, changed) = operation(&mut database, &settings).map_err(|error| {
                let may_have_committed = error_may_follow_mutation(&error);
                (error, may_have_committed)
            })?;
            if changed {
                mcp::record_external_change(database.connection())
                    .map_err(|error| (error, true))?;
            }
            Ok(value)
        })();
        write_tool_result(result)
    }
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ConnectionStatus {
    access: McpAccess,
    allow_file_attachments: bool,
    workflow_instructions_attached: bool,
    workflow_guide_version: &'static str,
    server_version: &'static str,
    write_scope: &'static str,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct WorkflowGuide {
    version: &'static str,
    instructions: &'static str,
}

/// The advertised output contract covers both successful data and the
/// structured execution-error envelope. Strict MCP clients can therefore
/// validate every `structuredContent` value, including `isError: true` results.
#[allow(dead_code)]
#[derive(Debug, JsonSchema)]
#[serde(untagged)]
enum McpToolOutput<T> {
    Success(T),
    Error(McpToolErrorOutput),
}

#[allow(dead_code)]
#[derive(Debug, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct McpToolErrorOutput {
    error: serde_json::Value,
    message: String,
    retryable_with_same_arguments: bool,
    mutation_may_have_committed: bool,
    recovery: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOverview {
    projects: Vec<ProjectOverview>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ProjectOverview {
    project: Project,
    boards: Vec<BoardOverview>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct BoardOverview {
    board: Board,
    columns: Vec<Column>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CreatedProject {
    project: Project,
    initial_board: Board,
    columns: Vec<Column>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CreatedBoard {
    board: Board,
    columns: Vec<Column>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct BoardDetail {
    project: Project,
    board: Board,
    writable: bool,
    snapshot: board_view::BoardSnapshot,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct TaskDetail {
    task_reference: String,
    project_name: String,
    board_name: String,
    column_name: String,
    mcp_managed: bool,
    writable: bool,
    task: crate::db::tasks::Task,
    subtasks: Vec<crate::db::subtasks::Subtask>,
    label_ids: Vec<String>,
    available_labels: Vec<Label>,
    file_refs: Vec<crate::db::file_refs::FileRef>,
    link_refs: Vec<crate::db::link_refs::LinkRef>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct NoteSummary {
    id: String,
    title: String,
    task_ids: Vec<String>,
    position: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct NoteList {
    project_id: String,
    project_name: String,
    project_key_prefix: String,
    mcp_managed: bool,
    writable: bool,
    notes: Vec<NoteSummary>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct NoteDetail {
    project_name: String,
    project_key_prefix: String,
    mcp_managed: bool,
    writable: bool,
    note: Note,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct NoteSearchResult {
    note_id: String,
    project_id: String,
    project_name: String,
    project_key_prefix: String,
    title: String,
    excerpt: String,
    updated_at: i64,
    task_ids: Vec<String>,
    mcp_managed: bool,
    writable: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct StatusMove {
    requested_status: WorkflowStatus,
    destination: Column,
    result: MoveResult,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct GetBoardArgs {
    /// Board ID returned by atticus_list_workspace or atticus_search_tasks.
    board_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct GetTaskArgs {
    /// Task ID returned by a board, search, or mutation result.
    task_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct SearchTasksArgs {
    /// Exact task reference (for example ATT-42), or words from the title or
    /// description. All words must match and the final word is prefix matched.
    #[schemars(length(min = 1, max = 500))]
    query: String,
    /// Maximum results, from 1 to 100. Defaults to 25.
    #[schemars(range(min = 1, max = 100))]
    limit: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ListNotesArgs {
    /// Project ID returned by atticus_list_workspace or a project mutation.
    project_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct GetNoteArgs {
    /// Note ID returned by note list, search, create, or update output.
    note_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct SearchNotesArgs {
    /// Words from a note title or Markdown body, 1-500 characters.
    #[schemars(length(min = 1, max = 500))]
    query: String,
    /// Optional exact project ID. Omit to search notes across the workspace.
    project_id: Option<String>,
    /// Maximum results, from 1 to 100. Defaults to 50.
    #[schemars(range(min = 1, max = 100))]
    limit: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CreateNoteArgs {
    /// Active MCP-managed project that will own the note.
    project_id: String,
    /// Note title, 1-200 characters.
    #[schemars(length(min = 1, max = 200))]
    title: String,
    /// Optional complete Markdown body, at most 200,000 characters. Defaults to empty.
    #[schemars(length(max = 200000))]
    body: Option<String>,
    /// Complete unique task association set. Every task must belong to project_id;
    /// omit or use [] for no task associations.
    #[serde(default)]
    task_ids: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct UpdateNoteArgs {
    /// Writable note ID returned by note list, search, get, create, or update output.
    note_id: String,
    /// Current note.updatedAt from atticus_get_note. Rejects stale updates.
    #[schemars(range(min = 0))]
    expected_updated_at: i64,
    /// Replacement title, 1-200 characters. Omit to leave unchanged.
    #[schemars(length(min = 1, max = 200))]
    title: Option<String>,
    /// Complete replacement Markdown body, at most 200,000 characters. Omit to leave unchanged.
    #[schemars(length(max = 200000))]
    body: Option<String>,
    /// Complete unique replacement task association set. Omit to preserve current
    /// associations; use [] intentionally to clear them all.
    task_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CreateProjectArgs {
    /// Project name, 1-100 characters.
    #[schemars(length(min = 1, max = 100))]
    name: String,
    /// Optional explanation of what belongs in the project, at most 2,000 characters.
    #[schemars(length(max = 2000))]
    description: Option<String>,
    /// Atticus color token. Defaults to blue when omitted.
    color: Option<ColorToken>,
    /// Optional 2-5 letter task prefix; derived from the name when omitted.
    #[schemars(regex(pattern = r"^[A-Za-z]{2,5}$"))]
    key_prefix: Option<String>,
    /// Optional absolute folder associated with the project. Only provide a
    /// user-confirmed path; file references cannot be added until it is usable.
    directory_path: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CreateBoardArgs {
    /// Writable project ID returned by atticus_list_workspace or atticus_create_project.
    project_id: String,
    /// Board name, 1-100 characters.
    #[schemars(length(min = 1, max = 100))]
    name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CreateColumnArgs {
    /// Writable board ID returned by atticus_list_workspace or atticus_create_board.
    board_id: String,
    /// Column name, 1-60 characters. Standard columns already exist on new boards.
    #[schemars(length(min = 1, max = 60))]
    name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CreateTaskArgs {
    /// Writable destination column ID returned by atticus_get_board or a create result.
    column_id: String,
    /// Task title, 1-500 characters.
    #[schemars(length(min = 1, max = 500))]
    title: String,
    /// Optional Markdown description, at most 100,000 characters.
    #[schemars(length(max = 100000))]
    description: Option<String>,
    /// 0 none, 1 low, 2 medium, 3 high, 4 urgent.
    #[schemars(range(min = 0, max = 4))]
    priority: Option<i64>,
    /// Optional YYYY-MM-DD calendar date.
    #[schemars(regex(pattern = r"^\d{4}-\d{2}-\d{2}$"))]
    due_date: Option<String>,
    /// Optional estimate in minutes, from 1 to 20,160 (two weeks).
    #[schemars(range(min = 1, max = 20160))]
    estimate_minutes: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct UpdateTaskArgs {
    /// Writable task ID returned by search, board, task, or mutation output.
    task_id: String,
    /// Current task.updatedAt from atticus_get_task. The update is rejected if
    /// the task changed after it was read.
    #[schemars(range(min = 0))]
    expected_updated_at: i64,
    /// New title, 1-500 characters. Omit to leave unchanged.
    #[schemars(length(min = 1, max = 500))]
    title: Option<String>,
    /// Complete replacement markdown description. Read the task first so useful
    /// existing context is not accidentally erased.
    #[schemars(length(max = 100000))]
    description: Option<String>,
    /// 0 none, 1 low, 2 medium, 3 high, 4 urgent.
    #[schemars(range(min = 0, max = 4))]
    priority: Option<i64>,
    /// YYYY-MM-DD. Mutually exclusive with clear_due_date.
    #[schemars(regex(pattern = r"^\d{4}-\d{2}-\d{2}$"))]
    due_date: Option<String>,
    /// Set true to remove the due date. Mutually exclusive with due_date.
    #[serde(default)]
    clear_due_date: bool,
    /// Estimate in minutes, from 1 to 20,160. Mutually exclusive with clear_estimate.
    #[schemars(range(min = 1, max = 20160))]
    estimate_minutes: Option<i64>,
    /// Set true to remove the estimate. Mutually exclusive with estimate_minutes.
    #[serde(default)]
    clear_estimate: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct MoveTaskArgs {
    /// Writable live task ID returned by search, board, task, or mutation output.
    task_id: String,
    /// Writable destination column ID on the task's current board.
    column_id: String,
    /// Zero-based position. Omit to append to the column.
    #[schemars(range(min = 0))]
    index: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum WorkflowStatus {
    Backlog,
    Todo,
    InProgress,
    Review,
    Done,
}

impl WorkflowStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Backlog => "backlog",
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Review => "review",
            Self::Done => "done",
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct SetTaskStatusArgs {
    /// Writable live task ID returned by search, board, task, or mutation output.
    task_id: String,
    /// Standard semantic destination. The task is appended to the unique matching column.
    status: WorkflowStatus,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct AddSubtaskArgs {
    /// Writable live task ID returned by atticus_get_task or another task result.
    task_id: String,
    /// Checklist item title, 1-300 characters.
    #[schemars(length(min = 1, max = 300))]
    title: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct UpdateSubtaskArgs {
    /// Subtask ID returned inside atticus_get_task.
    subtask_id: String,
    /// Current subtask.updatedAt from atticus_get_task. Rejects stale updates.
    #[schemars(range(min = 0))]
    expected_updated_at: i64,
    /// Replacement title, 1-300 characters. Omit to leave unchanged.
    #[schemars(length(min = 1, max = 300))]
    title: Option<String>,
    /// Completion state. Omit to leave unchanged.
    done: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CreateLabelArgs {
    /// Writable project ID returned by atticus_list_workspace or a create result.
    project_id: String,
    /// Label name, 1-40 characters. Reuse an existing same-purpose label.
    #[schemars(length(min = 1, max = 40))]
    name: String,
    /// Atticus label color token.
    color: ColorToken,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct SetTaskLabelsArgs {
    /// Writable live task ID returned by atticus_get_task or another task result.
    task_id: String,
    /// Current task.updatedAt from atticus_get_task. Rejects stale replacements.
    #[schemars(range(min = 0))]
    expected_updated_at: i64,
    /// Complete unique replacement list of label IDs from the same project.
    /// Merge with current labelIds first; use [] intentionally to clear all.
    label_ids: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct AddFileArgs {
    /// Writable live task ID returned by atticus_get_task or another task result.
    task_id: String,
    /// User-verified absolute path to an existing regular file inside the task
    /// project's configured folder. The server stores only a reference.
    path: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct AddLinkArgs {
    /// Writable live task ID returned by atticus_get_task or another task result.
    task_id: String,
    /// Complete http:// or https:// URL.
    #[schemars(url, length(min = 1, max = 2048))]
    url: String,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum ColorToken {
    Slate,
    Indigo,
    Blue,
    Cyan,
    Teal,
    Grass,
    Amber,
    Orange,
    Red,
    Plum,
}

impl ColorToken {
    fn as_str(self) -> &'static str {
        match self {
            Self::Slate => "slate",
            Self::Indigo => "indigo",
            Self::Blue => "blue",
            Self::Cyan => "cyan",
            Self::Teal => "teal",
            Self::Grass => "grass",
            Self::Amber => "amber",
            Self::Orange => "orange",
            Self::Red => "red",
            Self::Plum => "plum",
        }
    }
}

impl SearchTasksArgs {
    fn validate(&self) -> AppResult<()> {
        crate::domain::validate::required_text("query", &self.query, 500)?;
        if self.limit.is_some_and(|limit| !(1..=100).contains(&limit)) {
            return Err(AppError::validation(
                "limit",
                "Choose a result limit from 1 to 100.",
            ));
        }
        Ok(())
    }
}

impl SearchNotesArgs {
    fn validate(&self) -> AppResult<()> {
        crate::domain::validate::required_text("query", &self.query, 500)?;
        if self.limit.is_some_and(|limit| !(1..=100).contains(&limit)) {
            return Err(AppError::validation(
                "limit",
                "Choose a result limit from 1 to 100.",
            ));
        }
        Ok(())
    }
}

impl CreateNoteArgs {
    fn validate(&self) -> AppResult<()> {
        validate_unique_ids("task_ids", &self.task_ids)
    }
}

impl UpdateNoteArgs {
    fn validate(&self) -> AppResult<()> {
        if self.title.is_none() && self.body.is_none() && self.task_ids.is_none() {
            return Err(AppError::validation(
                "update",
                "Provide title, body, task_ids, or a combination of those fields.",
            ));
        }
        if let Some(task_ids) = &self.task_ids {
            validate_unique_ids("task_ids", task_ids)?;
        }
        Ok(())
    }
}

impl UpdateTaskArgs {
    fn validate(&self) -> AppResult<()> {
        if self.title.is_none()
            && self.description.is_none()
            && self.priority.is_none()
            && self.due_date.is_none()
            && !self.clear_due_date
            && self.estimate_minutes.is_none()
            && !self.clear_estimate
        {
            return Err(AppError::validation(
                "update",
                "Provide at least one task field to change.",
            ));
        }
        if self.due_date.is_some() && self.clear_due_date {
            return Err(AppError::validation(
                "due_date",
                "Provide due_date or clear_due_date, not both.",
            ));
        }
        if self.estimate_minutes.is_some() && self.clear_estimate {
            return Err(AppError::validation(
                "estimate_minutes",
                "Provide estimate_minutes or clear_estimate, not both.",
            ));
        }
        Ok(())
    }
}

impl MoveTaskArgs {
    fn validate(&self) -> AppResult<()> {
        if self.index.is_some_and(|index| index < 0) {
            return Err(AppError::validation(
                "index",
                "Use a zero-based index or omit index to append.",
            ));
        }
        Ok(())
    }
}

impl UpdateSubtaskArgs {
    fn validate(&self) -> AppResult<()> {
        if self.title.is_none() && self.done.is_none() {
            return Err(AppError::validation(
                "update",
                "Provide title, done, or both.",
            ));
        }
        Ok(())
    }
}

impl SetTaskLabelsArgs {
    fn validate(&self) -> AppResult<()> {
        validate_unique_ids("label_ids", &self.label_ids)
    }
}

fn validate_unique_ids(field: &str, ids: &[String]) -> AppResult<()> {
    let unique: HashSet<&str> = ids.iter().map(String::as_str).collect();
    if unique.len() != ids.len() {
        return Err(AppError::validation(
            field,
            format!("{field} must contain unique IDs; each ID may appear only once."),
        ));
    }
    Ok(())
}

#[tool_router]
impl AtticusMcp {
    #[tool(
        title = "Check Atticus access",
        description = "Read the current MCP access mode, file-reference permission, server version, workflow-guide version, and write boundary. This diagnostic remains callable while access is disabled; call it first when permissions are uncertain.",
        output_schema = schema_for_output::<McpToolOutput<ConnectionStatus>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_connection_status(&self) -> CallToolResult {
        let result = (|| {
            let database = self.database()?;
            let settings = mcp::settings(database.connection())?;
            Ok(ConnectionStatus {
                access: settings.access,
                allow_file_attachments: settings.allow_file_attachments,
                workflow_instructions_attached: true,
                workflow_guide_version: WORKFLOW_GUIDE_VERSION,
                server_version: env!("CARGO_PKG_VERSION"),
                write_scope: "live tasks and their descendants, plus project notes, inside active MCP-created projects only",
            })
        })();
        read_tool_result(result)
    }

    #[tool(
        title = "Read the Atticus workflow guide",
        description = "Return the canonical operating contract for connected models, including authorization, discovery, write scope, update semantics, lifecycle, retry recovery, and unavailable operations. The identical guide is attached during MCP initialization.",
        output_schema = schema_for_output::<McpToolOutput<WorkflowGuide>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_workflow_guide(&self) -> CallToolResult {
        read_tool_result(Ok(WorkflowGuide {
            version: WORKFLOW_GUIDE_VERSION,
            instructions: WORKFLOW_GUIDE,
        }))
    }

    #[tool(
        title = "List the Atticus workspace",
        description = "Read all active projects with their boards and ordered columns. Project.mcpManaged is the ownership boundary: only true projects are MCP-writable. Use returned opaque IDs; new boards already have the five standard columns.",
        output_schema = schema_for_output::<McpToolOutput<WorkspaceOverview>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_list_workspace(&self) -> CallToolResult {
        self.read(|database| workspace_overview(database.connection()))
    }

    #[tool(
        title = "Get an Atticus board",
        description = "Read one board, its project and writable state, ordered columns, live tasks, labels, subtask counts, and archived-task count. Use this before moving work; IDs are opaque and WIP limits are advisory.",
        output_schema = schema_for_output::<McpToolOutput<BoardDetail>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_get_board(&self, Parameters(args): Parameters<GetBoardArgs>) -> CallToolResult {
        self.read(|database| board_detail(database.connection(), &args.board_id))
    }

    #[tool(
        title = "Get an Atticus task",
        description = "Read a task's human reference, location names, writable state, Markdown description, timestamps, subtasks, assigned and available labels, file references, and links. Read immediately before update or label replacement and pass back the current updatedAt value.",
        output_schema = schema_for_output::<McpToolOutput<TaskDetail>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_get_task(&self, Parameters(args): Parameters<GetTaskArgs>) -> CallToolResult {
        self.read(|database| task_detail(database.connection(), &args.task_id))
    }

    #[tool(
        title = "Search Atticus tasks",
        description = "Search active-project tasks globally by an exact human reference such as ATT-42, or by title/description words. All words must match and only the final word is prefix-matched. Results can include archived or user-owned tasks; writable is authoritative. Search before creating work, and never mutate an archived result.",
        output_schema = schema_for_output::<McpToolOutput<Vec<search::SearchHit>>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_search_tasks(
        &self,
        Parameters(args): Parameters<SearchTasksArgs>,
    ) -> CallToolResult {
        self.read(|database| {
            args.validate()?;
            search::search(database.connection(), &args.query, args.limit.unwrap_or(25))
        })
    }

    #[tool(
        title = "List Atticus project notes",
        description = "List note summaries for one project in display order without returning their potentially large Markdown bodies. The project context includes the authoritative MCP ownership and writable state; use atticus_get_note for content before editing.",
        output_schema = schema_for_output::<McpToolOutput<NoteList>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_list_notes(&self, Parameters(args): Parameters<ListNotesArgs>) -> CallToolResult {
        self.read(|database| note_list(database.connection(), &args.project_id))
    }

    #[tool(
        title = "Get an Atticus note",
        description = "Read one project note's complete Markdown body, task associations, timestamps, project context, and authoritative writable state. Read immediately before updating and pass the current note.updatedAt as expected_updated_at.",
        output_schema = schema_for_output::<McpToolOutput<NoteDetail>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_get_note(&self, Parameters(args): Parameters<GetNoteArgs>) -> CallToolResult {
        self.read(|database| note_detail(database.connection(), &args.note_id))
    }

    #[tool(
        title = "Search Atticus project notes",
        description = "Search note titles and Markdown bodies across the workspace, or within one exact project ID. All parsed words must match and the final word is prefix-matched. Results return bounded excerpts plus authoritative ownership and writable state. Search before creating a similar note.",
        output_schema = schema_for_output::<McpToolOutput<Vec<NoteSearchResult>>>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_search_notes(
        &self,
        Parameters(args): Parameters<SearchNotesArgs>,
    ) -> CallToolResult {
        self.read(|database| {
            args.validate()?;
            if let Some(project_id) = &args.project_id {
                projects::find(database.connection(), project_id)?;
            }
            let hits = notes::search(
                database.connection(),
                &args.query,
                args.project_id.as_deref(),
                args.limit.unwrap_or(50),
            )?;
            note_search_results(database.connection(), hits)
        })
    }

    #[tool(
        title = "Create an Atticus project note",
        description = "Create a note in an active MCP-managed project with an optional complete Markdown body and complete unique task association set. Every task ID must belong to that project; omission or [] means no associations. Search first because this call is non-idempotent. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<NoteDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_create_note(&self, Parameters(args): Parameters<CreateNoteArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            args.validate()?;
            mcp::require_active_managed_project(database.connection(), &args.project_id)?;
            let note = notes::create(
                database.connection_mut(),
                &args.project_id,
                &args.title,
                args.body.as_deref().unwrap_or_default(),
                &args.task_ids,
            )?;
            note_detail(database.connection(), &note.id)
        })
    }

    #[tool(
        title = "Update an Atticus project note",
        description = "Patch a note in an active MCP-managed project using optimistic concurrency. Title and body replace their fields; task_ids, when supplied, replaces the complete unique association set and [] clears it. Omitted fields remain unchanged. Read first and pass note.updatedAt as expected_updated_at. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<NoteDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_update_note(&self, Parameters(args): Parameters<UpdateNoteArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            args.validate()?;
            mcp::require_active_managed_note(database.connection(), &args.note_id)?;
            let note = notes::update_if_current(
                database.connection_mut(),
                &args.note_id,
                args.expected_updated_at,
                &NotePatch {
                    title: args.title,
                    body: args.body,
                    task_ids: args.task_ids,
                },
            )?;
            note_detail(database.connection(), &note.id)
        })
    }

    #[tool(
        title = "Create an AI-managed project",
        description = "Create a new MCP-writable project under AI Boards plus one Board containing Backlog, Todo, In Progress, Review, and Done. Use only with user intent after listing the workspace; this non-idempotent call establishes new write scope and MCP cannot delete it. If the outcome is unknown, inspect before retrying. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<CreatedProject>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    fn atticus_create_project(
        &self,
        Parameters(args): Parameters<CreateProjectArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            let (project, board_id) = projects::create_mcp(
                database.connection_mut(),
                NewProject {
                    name: args.name,
                    description: args.description.unwrap_or_default(),
                    color: args
                        .color
                        .map(ColorToken::as_str)
                        .unwrap_or("blue")
                        .to_owned(),
                    key_prefix: args.key_prefix,
                    directory_path: args.directory_path,
                },
            )?;
            let initial_board = boards::find(database.connection(), &board_id)?;
            let columns = columns::list(database.connection(), &board_id)?;
            Ok(CreatedProject {
                project,
                initial_board,
                columns,
            })
        })
    }

    #[tool(
        title = "Create an Atticus board",
        description = "Create a board inside an active MCP-managed project and return its Backlog, Todo, In Progress, Review, and Done columns. This non-idempotent additive call cannot be removed through MCP; inspect the project first and inspect again before retrying an unknown result. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<CreatedBoard>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_create_board(
        &self,
        Parameters(args): Parameters<CreateBoardArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_active_managed_project(database.connection(), &args.project_id)?;
            let board = boards::create(database.connection_mut(), &args.project_id, &args.name)?;
            let columns = columns::list(database.connection(), &board.id)?;
            Ok(CreatedBoard { board, columns })
        })
    }

    #[tool(
        title = "Create an Atticus column",
        description = "Append a custom column to an active MCP-managed board. New boards already contain five standard workflow columns. This non-idempotent addition cannot be removed through MCP; inspect before creating or retrying. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<Column>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_create_column(
        &self,
        Parameters(args): Parameters<CreateColumnArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_active_managed_board(database.connection(), &args.board_id)?;
            columns::create(database.connection_mut(), &args.board_id, &args.name)
        })
    }

    #[tool(
        title = "Create an Atticus task",
        description = "Append a task to a column on an active MCP-managed board, optionally with Markdown description, priority, due date, and estimate. Search first to avoid duplicates. This call is non-idempotent; after an unknown result, search or inspect before retrying. Returns full authoritative task detail. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<TaskDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_create_task(&self, Parameters(args): Parameters<CreateTaskArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_active_managed_column(database.connection(), &args.column_id)?;
            let task = tasks::create_with_details(
                database.connection_mut(),
                NewTask {
                    column_id: args.column_id,
                    title: args.title,
                },
                tasks::NewTaskDetails {
                    description: args.description,
                    priority: args.priority,
                    due_date: args.due_date,
                    estimate_minutes: args.estimate_minutes,
                },
            )?;

            task_detail(database.connection(), &task.id)
        })
    }

    #[tool(
        title = "Update an Atticus task",
        description = "Patch title, Markdown description, priority, due date, or estimate on a live MCP-managed task. Omitted fields stay unchanged; description is a complete replacement. Read first and pass its current updatedAt as expected_updated_at. Empty, stale, or contradictory updates are rejected. This may overwrite or clear state and is non-idempotent. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<TaskDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_update_task(&self, Parameters(args): Parameters<UpdateTaskArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            args.validate()?;
            mcp::require_live_managed_task(database.connection(), &args.task_id)?;
            tasks::update_if_current(
                database.connection(),
                &args.task_id,
                TaskPatch {
                    title: args.title,
                    description: args.description,
                    priority: args.priority,
                    due_date: args.due_date,
                    clear_due_date: args.clear_due_date.then_some(true),
                    estimate_minutes: args.estimate_minutes,
                    clear_estimate: args.clear_estimate.then_some(true),
                },
                args.expected_updated_at,
            )?;
            task_detail(database.connection(), &args.task_id)
        })
    }

    #[tool(
        title = "Move an Atticus task",
        description = "Move a live MCP-managed task to an explicit column on its current board and optionally a zero-based position; omit index to append. Both IDs must be writable and the move can reorder two columns. Inspect the board first. Repeating the identical final placement has no additional effect. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<MoveResult>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_move_task(&self, Parameters(args): Parameters<MoveTaskArgs>) -> CallToolResult {
        self.write_if_changed(|database, _settings| {
            args.validate()?;
            mcp::require_live_managed_task(database.connection(), &args.task_id)?;
            mcp::require_active_managed_column(database.connection(), &args.column_id)?;
            let result = tasks::move_to(
                database.connection_mut(),
                &args.task_id,
                &args.column_id,
                args.index.unwrap_or(i64::MAX),
            )?;
            let changed = result.changed;
            Ok((result, changed))
        })
    }

    #[tool(
        title = "Set Atticus task status",
        description = "Append a live MCP-managed task to the board's unique semantic Backlog, Todo, In Progress, Review, or Done column. If no single column matches, the error lists candidates; inspect the board and use atticus_move_task instead of guessing. This changes task state and the MCP revision. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<StatusMove>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn atticus_set_task_status(
        &self,
        Parameters(args): Parameters<SetTaskStatusArgs>,
    ) -> CallToolResult {
        self.write_if_changed(|database, _settings| {
            mcp::require_live_managed_task(database.connection(), &args.task_id)?;
            let task = tasks::find(database.connection(), &args.task_id)?;
            let board_columns = columns::list(database.connection(), &task.board_id)?;
            let destination = resolve_status_column(&board_columns, args.status)?;
            let result = tasks::move_to(
                database.connection_mut(),
                &args.task_id,
                &destination.id,
                i64::MAX,
            )?;
            let changed = result.changed;
            Ok((
                StatusMove {
                    requested_status: args.status,
                    destination,
                    result,
                },
                changed,
            ))
        })
    }

    #[tool(
        title = "Add an Atticus subtask",
        description = "Append a checklist item to a live MCP-managed task and return refreshed task detail. It does not complete or move the parent. This non-idempotent addition cannot be removed through MCP; after an unknown result, read the task before retrying. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<TaskDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_add_subtask(&self, Parameters(args): Parameters<AddSubtaskArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_live_managed_task(database.connection(), &args.task_id)?;
            subtasks::create(database.connection_mut(), &args.task_id, &args.title)?;
            task_detail(database.connection(), &args.task_id)
        })
    }

    #[tool(
        title = "Update an Atticus subtask",
        description = "Patch the title and/or completion state of a subtask on a live MCP-managed task. Read its parent first and pass the subtask's current updatedAt as expected_updated_at. Empty and stale updates are rejected. Mark done only after completion. This can overwrite state and changes timestamps. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<TaskDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_update_subtask(
        &self,
        Parameters(args): Parameters<UpdateSubtaskArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            args.validate()?;
            mcp::require_live_managed_subtask(database.connection(), &args.subtask_id)?;
            let updated = subtasks::update_if_current(
                database.connection_mut(),
                &args.subtask_id,
                SubtaskPatch {
                    title: args.title,
                    done: args.done,
                },
                args.expected_updated_at,
            )?;
            task_detail(database.connection(), &updated.task_id)
        })
    }

    #[tool(
        title = "Create an Atticus label",
        description = "Create a reusable label in an active MCP-managed project. Reuse an existing same-purpose label; duplicate names are rejected. This non-idempotent addition cannot be deleted through MCP, so inspect before retrying an unknown result. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<Label>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_create_label(
        &self,
        Parameters(args): Parameters<CreateLabelArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_active_managed_project(database.connection(), &args.project_id)?;
            labels::create(
                database.connection(),
                &args.project_id,
                LabelInput {
                    name: args.name,
                    color: args.color.as_str().to_owned(),
                },
            )
        })
    }

    #[tool(
        title = "Replace Atticus task labels",
        description = "Replace the complete label set of a live MCP-managed task with unique label IDs from its project. Read first, merge current labelIds with the intended change, and pass task.updatedAt as expected_updated_at; [] intentionally clears all labels. Stale and duplicate input is rejected. This is destructive replacement, not addition. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<TaskDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_set_task_labels(
        &self,
        Parameters(args): Parameters<SetTaskLabelsArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            args.validate()?;
            mcp::require_live_managed_task(database.connection(), &args.task_id)?;
            labels::set_for_task_if_current(
                database.connection_mut(),
                &args.task_id,
                &args.label_ids,
                args.expected_updated_at,
            )?;
            task_detail(database.connection(), &args.task_id)
        })
    }

    #[tool(
        title = "Add an Atticus file reference",
        description = "Append a path reference to a live MCP-managed task. The server never reads or uploads contents. Requires read/write access, separate file permission, a configured project folder, and an existing regular file canonically inside that folder. This non-idempotent addition cannot be removed through MCP; duplicates are rejected and unknown outcomes must be inspected before retrying.",
        output_schema = schema_for_output::<McpToolOutput<TaskDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    fn atticus_add_file(&self, Parameters(args): Parameters<AddFileArgs>) -> CallToolResult {
        self.write(|database, settings| {
            mcp::require_live_managed_task(database.connection(), &args.task_id)?;
            if !settings.allow_file_attachments {
                return Err(AppError::Conflict {
                    message: "File attachment is disabled in Atticus Settings → AI access."
                        .to_owned(),
                });
            }

            let path = permitted_attachment_path(database.connection(), &args.task_id, &args.path)?;
            let canonical = path.to_string_lossy();
            if file_refs::list(database.connection(), &args.task_id)?
                .iter()
                .any(|file| file.path == canonical)
            {
                return Err(AppError::validation(
                    "path",
                    "That file is already attached to this task.",
                ));
            }
            file_refs::add(database.connection_mut(), &args.task_id, &canonical, None)?;
            task_detail(database.connection(), &args.task_id)
        })
    }

    #[tool(
        title = "Add an Atticus link",
        description = "Append a verified complete http:// or https:// URL to a live MCP-managed task. Never invent a URL. This non-idempotent addition cannot be removed through MCP; duplicate URLs are rejected and unknown outcomes must be inspected before retrying. Returns refreshed task detail. Requires read/write access.",
        output_schema = schema_for_output::<McpToolOutput<TaskDetail>>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    fn atticus_add_link(&self, Parameters(args): Parameters<AddLinkArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_live_managed_task(database.connection(), &args.task_id)?;
            let url = crate::domain::validate::web_url("url", &args.url)?;
            if link_refs::list(database.connection(), &args.task_id)?
                .iter()
                .any(|link| link.url == url)
            {
                return Err(AppError::validation(
                    "url",
                    "That link is already attached to this task.",
                ));
            }
            link_refs::add(database.connection_mut(), &args.task_id, &url)?;
            task_detail(database.connection(), &args.task_id)
        })
    }
}

#[tool_handler]
impl ServerHandler for AtticusMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("atticus", env!("CARGO_PKG_VERSION"))
                    .with_title("Atticus Task Workspace")
                    .with_description(
                        "A permissioned local task-and-note workspace with read-only user projects and an isolated MCP-managed write scope.",
                    ),
            )
            .with_instructions(WORKFLOW_GUIDE)
    }
}

fn require_read_access(settings: &McpSettings) -> AppResult<()> {
    if settings.access == McpAccess::Disabled {
        Err(AppError::Conflict {
            message: "Atticus MCP access is disabled. Enable it in Settings → AI access."
                .to_owned(),
        })
    } else {
        Ok(())
    }
}

fn require_write_access(settings: &McpSettings) -> AppResult<()> {
    match settings.access {
        McpAccess::ReadWrite => Ok(()),
        McpAccess::ReadOnly => Err(AppError::Conflict {
            message: "Atticus MCP is read-only. Enable read/write access in Settings → AI access."
                .to_owned(),
        }),
        McpAccess::Disabled => Err(AppError::Conflict {
            message: "Atticus MCP access is disabled. Enable it in Settings → AI access."
                .to_owned(),
        }),
    }
}

fn read_tool_result<T: Serialize>(result: AppResult<T>) -> CallToolResult {
    match result {
        Ok(value) => encode_success(&value, false),
        Err(error) => encode_error(error, false),
    }
}

fn write_tool_result<T: Serialize>(result: Result<T, (AppError, bool)>) -> CallToolResult {
    match result {
        Ok(value) => encode_success(&value, true),
        Err((error, mutation_may_have_committed)) => {
            encode_error(error, mutation_may_have_committed)
        }
    }
}

fn encode_success<T: Serialize>(value: &T, mutation_completed: bool) -> CallToolResult {
    match (
        serde_json::to_value(value),
        serde_json::to_string_pretty(value),
    ) {
        (Ok(structured), Ok(readable)) => {
            let mut result = CallToolResult::structured(structured);
            result.content = vec![ContentBlock::text(readable)];
            result
        }
        (Err(error), _) | (_, Err(error)) => CallToolResult::structured_error(serde_json::json!({
            "error": {
                "kind": "encoding",
                "message": format!("Atticus completed the operation but could not encode its result: {error}"),
            },
            "retryableWithSameArguments": false,
            "mutationMayHaveCommitted": mutation_completed,
            "recovery": if mutation_completed {
                "Inspect the target before any retry; the mutation completed but its response could not be encoded."
            } else {
                "Report this server error; repeating the same call is unlikely to help."
            }
        })),
    }
}

fn encode_error(error: AppError, mutation_may_have_committed: bool) -> CallToolResult {
    let message = error.to_string();
    let recovery = match &error {
        AppError::Validation { .. } => {
            "Correct the named input field, then make one deliberate retry."
        }
        AppError::NotFound { .. } => {
            "Refresh the workspace, board, search, task, or note and use the current opaque ID."
        }
        AppError::Conflict { message } if message.contains("Settings → AI access") => {
            "Ask the user to change Settings → AI access if they want this operation; do not loop."
        }
        AppError::Conflict { .. } => {
            "Read the current resource, reconcile the conflict, and retry only with current state."
        }
        _ if mutation_may_have_committed => {
            "The outcome may have committed. Inspect or search before retrying to avoid duplication."
        }
        _ => "Report the server failure. Do not blindly repeat the same call.",
    };

    let mut result = CallToolResult::structured_error(serde_json::json!({
        "error": error,
        "message": message,
        "retryableWithSameArguments": false,
        "mutationMayHaveCommitted": mutation_may_have_committed,
        "recovery": recovery,
    }));
    result.content = vec![ContentBlock::text(format!(
        "{message}\nRecovery: {recovery}"
    ))];
    result
}

fn error_may_follow_mutation(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Database { .. }
            | AppError::Io { .. }
            | AppError::Migration { .. }
            | AppError::Internal { .. }
    )
}

fn workspace_overview(conn: &rusqlite::Connection) -> AppResult<WorkspaceOverview> {
    let mut overview = Vec::new();
    for project in projects::list(conn, false)? {
        let mut board_overviews = Vec::new();
        for board in boards::list(conn, &project.id)? {
            let board_columns = columns::list(conn, &board.id)?;
            board_overviews.push(BoardOverview {
                board,
                columns: board_columns,
            });
        }
        overview.push(ProjectOverview {
            project,
            boards: board_overviews,
        });
    }
    Ok(WorkspaceOverview { projects: overview })
}

fn board_detail(conn: &rusqlite::Connection, board_id: &str) -> AppResult<BoardDetail> {
    let board = boards::find(conn, board_id)?;
    let project = projects::find(conn, &board.project_id)?;
    let writable = project.mcp_managed && project.archived_at.is_none();
    let snapshot = board_view::load(conn, board_id)?;
    Ok(BoardDetail {
        project,
        board,
        writable,
        snapshot,
    })
}

fn task_detail(conn: &rusqlite::Connection, task_id: &str) -> AppResult<TaskDetail> {
    let task = tasks::find(conn, task_id)?;
    let project = projects::find(conn, &task.project_id)?;
    let board = boards::find(conn, &task.board_id)?;
    let column = columns::find(conn, &task.column_id)?;
    let mcp_managed = project.mcp_managed;
    Ok(TaskDetail {
        task_reference: format!("{}-{}", project.key_prefix, task.number),
        project_name: project.name,
        board_name: board.name,
        column_name: column.name,
        mcp_managed,
        writable: mcp_managed && project.archived_at.is_none() && task.archived_at.is_none(),
        subtasks: subtasks::list(conn, task_id)?,
        label_ids: labels::for_task(conn, task_id)?,
        available_labels: labels::list(conn, &task.project_id)?,
        file_refs: file_refs::list(conn, task_id)?,
        link_refs: link_refs::list(conn, task_id)?,
        task,
    })
}

#[derive(Clone)]
struct NoteProjectAccess {
    project_name: String,
    project_key_prefix: String,
    mcp_managed: bool,
    writable: bool,
}

fn note_project_access(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> AppResult<NoteProjectAccess> {
    let project = projects::find(conn, project_id)?;
    Ok(NoteProjectAccess {
        project_name: project.name,
        project_key_prefix: project.key_prefix,
        mcp_managed: project.mcp_managed,
        writable: project.mcp_managed && project.archived_at.is_none(),
    })
}

fn note_list(conn: &rusqlite::Connection, project_id: &str) -> AppResult<NoteList> {
    let access = note_project_access(conn, project_id)?;
    let note_summaries = notes::list(conn, project_id)?
        .into_iter()
        .map(|note| NoteSummary {
            id: note.id,
            title: note.title,
            task_ids: note.task_ids,
            position: note.position,
            created_at: note.created_at,
            updated_at: note.updated_at,
        })
        .collect();
    Ok(NoteList {
        project_id: project_id.to_owned(),
        project_name: access.project_name,
        project_key_prefix: access.project_key_prefix,
        mcp_managed: access.mcp_managed,
        writable: access.writable,
        notes: note_summaries,
    })
}

fn note_detail(conn: &rusqlite::Connection, note_id: &str) -> AppResult<NoteDetail> {
    let note = notes::find(conn, note_id)?;
    let access = note_project_access(conn, &note.project_id)?;
    Ok(NoteDetail {
        project_name: access.project_name,
        project_key_prefix: access.project_key_prefix,
        mcp_managed: access.mcp_managed,
        writable: access.writable,
        note,
    })
}

fn note_search_results(
    conn: &rusqlite::Connection,
    hits: Vec<notes::NoteSearchHit>,
) -> AppResult<Vec<NoteSearchResult>> {
    let mut project_access = HashMap::<String, NoteProjectAccess>::new();
    let mut results = Vec::with_capacity(hits.len());
    for hit in hits {
        let access = match project_access.get(&hit.project_id) {
            Some(access) => access.clone(),
            None => {
                let access = note_project_access(conn, &hit.project_id)?;
                project_access.insert(hit.project_id.clone(), access.clone());
                access
            }
        };
        results.push(NoteSearchResult {
            note_id: hit.note_id,
            project_id: hit.project_id,
            project_name: access.project_name,
            project_key_prefix: access.project_key_prefix,
            title: hit.title,
            excerpt: hit.excerpt,
            updated_at: hit.updated_at,
            task_ids: hit.task_ids,
            mcp_managed: access.mcp_managed,
            writable: access.writable,
        });
    }
    Ok(results)
}

fn normalise_column_name(name: &str) -> String {
    name.chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn status_names(status: WorkflowStatus) -> &'static [&'static str] {
    match status {
        WorkflowStatus::Backlog => &["backlog", "inbox", "later"],
        WorkflowStatus::Todo => &["todo", "planned", "ready", "next"],
        WorkflowStatus::InProgress => &["inprogress", "doing", "active", "started"],
        WorkflowStatus::Review => &["review", "testing", "qa", "verify"],
        WorkflowStatus::Done => &["done", "complete", "completed", "finished"],
    }
}

fn resolve_status_column(columns: &[Column], status: WorkflowStatus) -> AppResult<Column> {
    let matching: Vec<&Column> = columns
        .iter()
        .filter(|column| {
            status_names(status).contains(&normalise_column_name(&column.name).as_str())
        })
        .collect();

    match matching.as_slice() {
        [column] => Ok((*column).clone()),
        [] => Err(AppError::Conflict {
            message: format!(
                "This board has no unambiguous {} column. Available columns: {}. Use atticus_move_task with an explicit column ID.",
                status.as_str(),
                columns
                    .iter()
                    .map(|column| format!("{} ({})", column.name, column.id))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }),
        _ => Err(AppError::Conflict {
            message: format!(
                "More than one column matches {}: {}. Use atticus_move_task with the intended column ID.",
                status.as_str(),
                matching
                    .iter()
                    .map(|column| format!("{} ({})", column.name, column.id))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }),
    }
}

fn permitted_attachment_path(
    conn: &rusqlite::Connection,
    task_id: &str,
    raw_path: &str,
) -> AppResult<PathBuf> {
    let task = tasks::find(conn, task_id)?;
    let project = projects::find(conn, &task.project_id)?;
    let configured_root = project.directory_path.ok_or_else(|| AppError::Conflict {
        message: "Set a project folder before allowing an AI to attach files to this task."
            .to_owned(),
    })?;

    let root = std::fs::canonicalize(&configured_root).map_err(|_| AppError::NotFound {
        entity: "project folder".to_owned(),
        id: configured_root.clone(),
    })?;
    let requested = file_refs::validate_path(raw_path)?;
    let canonical = std::fs::canonicalize(&requested).map_err(|_| AppError::NotFound {
        entity: "file".to_owned(),
        id: raw_path.to_owned(),
    })?;

    if !canonical.is_file() {
        return Err(AppError::validation(
            "path",
            "Choose an existing file, not a folder.",
        ));
    }
    if !canonical.starts_with(&root) {
        return Err(AppError::Conflict {
            message: format!(
                "The file is outside this project's configured folder ({}).",
                root.to_string_lossy()
            ),
        });
    }

    Ok(canonical)
}

pub fn run_stdio() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = resolve_data_dir(std::env::args_os().skip(1))?;
    let database = Database::open(&data_dir.join(DATABASE_FILE_NAME))
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    let server = AtticusMcp::new(database);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    runtime.block_on(async move {
        let service = server
            .serve(rmcp::transport::stdio())
            .await
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        service
            .waiting()
            .await
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        Ok::<(), std::io::Error>(())
    })?;

    Ok(())
}

fn resolve_data_dir(args: impl Iterator<Item = OsString>) -> AppResult<PathBuf> {
    let arguments: Vec<OsString> = args.collect();
    if let Some(index) = arguments
        .iter()
        .position(|argument| argument == "--data-dir")
    {
        let value = arguments.get(index + 1).filter(|value| !value.is_empty());
        return value
            .map(PathBuf::from)
            .ok_or_else(|| AppError::validation("dataDir", "--data-dir needs a path."));
    }

    if let Some(override_dir) =
        std::env::var_os(crate::DATA_DIR_ENV).filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(override_dir));
    }

    platform_data_dir().ok_or_else(|| {
        AppError::internal(format!(
            "could not locate the Atticus data directory; set {} or pass --data-dir",
            crate::DATA_DIR_ENV
        ))
    })
}

#[cfg(target_os = "macos")]
fn platform_data_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/Application Support/nl.synaptica.takenkanban"))
}

#[cfg(target_os = "linux")]
fn platform_data_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local/share"))
        })
        .map(|base| base.join("nl.synaptica.takenkanban"))
}

#[cfg(target_os = "windows")]
fn platform_data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|base| base.join("nl.synaptica.takenkanban"))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_data_dir() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn structured(result: &CallToolResult) -> &serde_json::Value {
        result
            .structured_content
            .as_ref()
            .expect("tool result has structured content")
    }

    fn set_access(server: &AtticusMcp, access: McpAccess) {
        let database = server.database().expect("database lock");
        mcp::set_settings(
            database.connection(),
            &McpSettings {
                access,
                allow_file_attachments: false,
            },
        )
        .expect("access setting saves");
    }

    fn column(id: &str, name: &str) -> Column {
        Column {
            id: id.to_owned(),
            board_id: "board".to_owned(),
            name: name.to_owned(),
            wip_limit: None,
            position: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn initialization_publishes_one_canonical_professional_contract() {
        let server = AtticusMcp::new(Database::open_in_memory().expect("database opens"));
        let info = ServerHandler::get_info(&server);

        assert_eq!(info.server_info.name, "atticus");
        assert_eq!(
            info.server_info.title.as_deref(),
            Some("Atticus Task Workspace")
        );
        assert_eq!(info.server_info.version, env!("CARGO_PKG_VERSION"));
        assert!(info.capabilities.tools.is_some());
        assert_eq!(info.instructions.as_deref(), Some(WORKFLOW_GUIDE));

        for required in [
            "not an automatic activity logger",
            "Treat every database ID as opaque",
            "expected_updated_at",
            "project note for durable long-form context",
            "task_ids, when supplied, likewise replaces",
            "non-idempotent",
            "no delete, archive, restore",
            "server is passive",
        ] {
            assert!(
                WORKFLOW_GUIDE.contains(required),
                "guide should explain {required}"
            );
        }
    }

    #[test]
    fn every_tool_has_model_facing_metadata_and_an_output_schema() {
        let tools = AtticusMcp::tool_router().list_all();
        assert_eq!(tools.len(), 24);

        let read_only: HashSet<&str> = [
            "atticus_connection_status",
            "atticus_workflow_guide",
            "atticus_list_workspace",
            "atticus_get_board",
            "atticus_get_task",
            "atticus_search_tasks",
            "atticus_list_notes",
            "atticus_get_note",
            "atticus_search_notes",
        ]
        .into_iter()
        .collect();
        let open_world: HashSet<&str> = ["atticus_create_project", "atticus_add_file"]
            .into_iter()
            .collect();
        let destructive: HashSet<&str> = [
            "atticus_update_task",
            "atticus_move_task",
            "atticus_set_task_status",
            "atticus_update_subtask",
            "atticus_set_task_labels",
            "atticus_update_note",
        ]
        .into_iter()
        .collect();
        let idempotent: HashSet<&str> = read_only
            .iter()
            .copied()
            .chain(["atticus_move_task", "atticus_set_task_status"])
            .collect();

        for tool in tools {
            let name = tool.name.as_ref();
            assert!(name.starts_with("atticus_"), "unexpected tool name {name}");
            assert!(tool.title.as_deref().is_some_and(|title| !title.is_empty()));
            assert!(
                tool.description
                    .as_deref()
                    .is_some_and(|description| description.len() >= 80),
                "{name} needs an operational description"
            );
            assert!(tool.output_schema.is_some(), "{name} needs outputSchema");
            let output_schema = serde_json::to_string(tool.output_schema.as_ref().unwrap())
                .expect("output schema serializes");
            assert!(
                output_schema.contains("retryableWithSameArguments"),
                "{name} outputSchema must cover structured execution errors"
            );
            if name.ends_with("_note") || name.ends_with("_notes") {
                let input_schema =
                    serde_json::to_value(&tool.input_schema).expect("note input schema serializes");
                assert_eq!(
                    input_schema["additionalProperties"], false,
                    "{name} must reject unknown input fields"
                );
            }

            let annotations = tool.annotations.expect("annotations are required");
            assert_eq!(
                annotations.read_only_hint,
                Some(read_only.contains(name)),
                "readOnlyHint for {name}"
            );
            assert_eq!(
                annotations.open_world_hint,
                Some(open_world.contains(name)),
                "openWorldHint for {name}"
            );
            assert_eq!(annotations.idempotent_hint, Some(idempotent.contains(name)));
            assert_eq!(
                annotations.destructive_hint,
                Some(destructive.contains(name)),
                "destructiveHint for {name}"
            );
        }
    }

    #[test]
    fn tool_arguments_reject_unknown_empty_contradictory_and_unsafe_input() {
        let typo = serde_json::json!({
            "task_id": "task",
            "expected_updated_at": 1,
            "descripton": "misspelled"
        });
        assert!(serde_json::from_value::<UpdateTaskArgs>(typo).is_err());

        let empty = UpdateTaskArgs {
            task_id: "task".to_owned(),
            expected_updated_at: 1,
            title: None,
            description: None,
            priority: None,
            due_date: None,
            clear_due_date: false,
            estimate_minutes: None,
            clear_estimate: false,
        };
        assert!(empty.validate().is_err());

        let contradictory = UpdateTaskArgs {
            due_date: Some("2026-08-03".to_owned()),
            clear_due_date: true,
            ..empty
        };
        assert!(contradictory.validate().is_err());

        let negative_move = MoveTaskArgs {
            task_id: "task".to_owned(),
            column_id: "column".to_owned(),
            index: Some(-1),
        };
        assert!(negative_move.validate().is_err());

        let duplicate_labels = SetTaskLabelsArgs {
            task_id: "task".to_owned(),
            expected_updated_at: 1,
            label_ids: vec!["label".to_owned(), "label".to_owned()],
        };
        assert!(duplicate_labels.validate().is_err());

        let empty_note_update = UpdateNoteArgs {
            note_id: "note".to_owned(),
            expected_updated_at: 1,
            title: None,
            body: None,
            task_ids: None,
        };
        assert!(empty_note_update.validate().is_err());

        let duplicate_note_tasks = CreateNoteArgs {
            project_id: "project".to_owned(),
            title: "Plan".to_owned(),
            body: None,
            task_ids: vec!["task".to_owned(), "task".to_owned()],
        };
        assert!(duplicate_note_tasks.validate().is_err());

        let misspelled_note_field = serde_json::json!({
            "note_id": "note",
            "expected_updated_at": 1,
            "taskIds": []
        });
        assert!(serde_json::from_value::<UpdateNoteArgs>(misspelled_note_field).is_err());

        let tool_names: HashSet<_> = AtticusMcp::tool_router()
            .list_all()
            .into_iter()
            .map(|tool| tool.name.into_owned())
            .collect();
        assert!(!tool_names.contains("atticus_delete_note"));
    }

    #[test]
    fn a_connected_server_rechecks_permissions_and_returns_structured_errors() {
        let server = AtticusMcp::new(Database::open_in_memory().expect("database opens"));
        let user_note_id = {
            let mut database = server.database().expect("database lock");
            let (project, _) = projects::create(
                database.connection_mut(),
                NewProject {
                    name: "User research".to_owned(),
                    description: String::new(),
                    color: "blue".to_owned(),
                    key_prefix: Some("USR".to_owned()),
                    directory_path: None,
                },
            )
            .expect("user project creates");
            notes::create(
                database.connection_mut(),
                &project.id,
                "Private context",
                "A full project-note body.",
                &[],
            )
            .expect("user note creates")
            .id
        };

        let disabled_read = server.atticus_list_workspace();
        assert_eq!(disabled_read.is_error, Some(true));
        assert_eq!(structured(&disabled_read)["error"]["kind"], "conflict");
        assert_eq!(
            structured(&disabled_read)["retryableWithSameArguments"],
            false
        );

        let diagnostic = server.atticus_connection_status();
        assert_eq!(diagnostic.is_error, Some(false));
        assert_eq!(structured(&diagnostic)["access"], "disabled");
        assert!(structured(&diagnostic).get("databasePath").is_none());

        set_access(&server, McpAccess::ReadOnly);
        assert_eq!(server.atticus_list_workspace().is_error, Some(false));
        let read_only_note = server.atticus_get_note(Parameters(GetNoteArgs {
            note_id: user_note_id,
        }));
        assert_eq!(read_only_note.is_error, Some(false));
        assert_eq!(structured(&read_only_note)["writable"], false);
        assert_eq!(
            structured(&read_only_note)["note"]["body"],
            "A full project-note body."
        );
        let rejected_write = server.atticus_create_project(Parameters(CreateProjectArgs {
            name: "Should not exist".to_owned(),
            description: None,
            color: Some(ColorToken::Blue),
            key_prefix: None,
            directory_path: None,
        }));
        assert_eq!(rejected_write.is_error, Some(true));
        assert_eq!(
            structured(&rejected_write)["mutationMayHaveCommitted"],
            false
        );

        set_access(&server, McpAccess::ReadWrite);
        let created = server.atticus_create_project(Parameters(CreateProjectArgs {
            name: "Research programme".to_owned(),
            description: Some("Work that the user asked Atticus to track.".to_owned()),
            color: Some(ColorToken::Cyan),
            key_prefix: Some("RSP".to_owned()),
            directory_path: None,
        }));
        assert_eq!(created.is_error, Some(false));
        assert_eq!(structured(&created)["columns"].as_array().unwrap().len(), 5);

        let database = server.database().expect("database lock");
        assert_eq!(mcp::revision(database.connection()).unwrap(), 1);
    }

    #[test]
    fn stale_and_archived_task_writes_are_refused_without_revision_changes() {
        let server = AtticusMcp::new(Database::open_in_memory().expect("database opens"));
        set_access(&server, McpAccess::ReadWrite);

        let created_project = server.atticus_create_project(Parameters(CreateProjectArgs {
            name: "Operations".to_owned(),
            description: None,
            color: None,
            key_prefix: Some("OPS".to_owned()),
            directory_path: None,
        }));
        let column_id = structured(&created_project)["columns"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let created_task = server.atticus_create_task(Parameters(CreateTaskArgs {
            column_id,
            title: "Prepare the field report".to_owned(),
            description: Some("# Outcome\n\nPending.".to_owned()),
            priority: Some(2),
            due_date: Some("2026-08-10".to_owned()),
            estimate_minutes: Some(90),
        }));
        assert_eq!(created_task.is_error, Some(false));
        let task_id = structured(&created_task)["task"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let updated_at = structured(&created_task)["task"]["updatedAt"]
            .as_i64()
            .unwrap();
        assert_eq!(structured(&created_task)["taskReference"], "OPS-1");
        assert_eq!(structured(&created_task)["writable"], true);

        let no_op = server.atticus_move_task(Parameters(MoveTaskArgs {
            task_id: task_id.clone(),
            column_id: structured(&created_task)["task"]["columnId"]
                .as_str()
                .unwrap()
                .to_owned(),
            index: Some(0),
        }));
        assert_eq!(no_op.is_error, Some(false));
        assert_eq!(structured(&no_op)["changed"], false);
        {
            let database = server.database().expect("database lock");
            assert_eq!(
                mcp::revision(database.connection()).unwrap(),
                2,
                "an idempotent no-op must not announce an external change"
            );
        }

        let stale = server.atticus_update_task(Parameters(UpdateTaskArgs {
            task_id: task_id.clone(),
            expected_updated_at: updated_at - 1,
            title: Some("Stale title".to_owned()),
            description: None,
            priority: None,
            due_date: None,
            clear_due_date: false,
            estimate_minutes: None,
            clear_estimate: false,
        }));
        assert_eq!(stale.is_error, Some(true));
        assert!(structured(&stale)["message"]
            .as_str()
            .unwrap()
            .contains("changed after it was read"));

        {
            let mut database = server.database().expect("database lock");
            tasks::set_archived(database.connection_mut(), &task_id, true)
                .expect("task archives through the owner-facing database API");
            assert_eq!(mcp::revision(database.connection()).unwrap(), 2);
        }

        let archived_write = server.atticus_add_link(Parameters(AddLinkArgs {
            task_id: task_id.clone(),
            url: "https://example.com/report".to_owned(),
        }));
        assert_eq!(archived_write.is_error, Some(true));
        assert!(structured(&archived_write)["message"]
            .as_str()
            .unwrap()
            .contains("Archived tasks are read-only"));

        let database = server.database().expect("database lock");
        assert_eq!(mcp::revision(database.connection()).unwrap(), 2);
        assert!(link_refs::list(database.connection(), &task_id)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn the_complete_mcp_workflow_returns_authoritative_state() {
        let project_folder = tempfile::tempdir().expect("project folder");
        let evidence_path = project_folder.path().join("evidence.md");
        std::fs::write(&evidence_path, "verified evidence").expect("evidence file");

        let server = AtticusMcp::new(Database::open_in_memory().expect("database opens"));
        {
            let database = server.database().expect("database lock");
            mcp::set_settings(
                database.connection(),
                &McpSettings {
                    access: McpAccess::ReadWrite,
                    allow_file_attachments: true,
                },
            )
            .expect("read/write and files enable");
        }

        let project_result = server.atticus_create_project(Parameters(CreateProjectArgs {
            name: "Publication".to_owned(),
            description: Some("Research and writing deliverables.".to_owned()),
            color: Some(ColorToken::Plum),
            key_prefix: Some("PUB".to_owned()),
            directory_path: Some(project_folder.path().to_string_lossy().into_owned()),
        }));
        let project_id = structured(&project_result)["project"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let board_id = structured(&project_result)["initialBoard"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let todo_column = structured(&project_result)["columns"][1]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let extra_board = server.atticus_create_board(Parameters(CreateBoardArgs {
            project_id: project_id.clone(),
            name: "Editorial calendar".to_owned(),
        }));
        assert_eq!(
            structured(&extra_board)["columns"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        let custom_column = server.atticus_create_column(Parameters(CreateColumnArgs {
            board_id: board_id.clone(),
            name: "Waiting for source".to_owned(),
        }));
        assert_eq!(structured(&custom_column)["name"], "Waiting for source");

        let created_task = server.atticus_create_task(Parameters(CreateTaskArgs {
            column_id: todo_column,
            title: "Publish the field guide".to_owned(),
            description: Some("# Brief\n\nPrepare the approved field guide.".to_owned()),
            priority: Some(3),
            due_date: Some("2026-08-20".to_owned()),
            estimate_minutes: Some(240),
        }));
        let task_id = structured(&created_task)["task"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let first_updated_at = structured(&created_task)["task"]["updatedAt"]
            .as_i64()
            .unwrap();

        let created_note = server.atticus_create_note(Parameters(CreateNoteArgs {
            project_id: project_id.clone(),
            title: "Field guide decisions".to_owned(),
            body: Some("# Decision log\n\nUse the reviewed outline.".to_owned()),
            task_ids: vec![task_id.clone()],
        }));
        assert_eq!(created_note.is_error, Some(false));
        assert_eq!(structured(&created_note)["writable"], true);
        assert_eq!(structured(&created_note)["note"]["taskIds"][0], task_id);
        let note_id = structured(&created_note)["note"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let note_updated_at = structured(&created_note)["note"]["updatedAt"]
            .as_i64()
            .unwrap();

        let listed_notes = server.atticus_list_notes(Parameters(ListNotesArgs {
            project_id: project_id.clone(),
        }));
        assert_eq!(structured(&listed_notes)["notes"][0]["id"], note_id);
        assert!(structured(&listed_notes)["notes"][0].get("body").is_none());

        let updated_note = server.atticus_update_note(Parameters(UpdateNoteArgs {
            note_id: note_id.clone(),
            expected_updated_at: note_updated_at,
            title: None,
            body: Some(
                "# Decision log\n\nUse the reviewed outline and preserve source notes.".to_owned(),
            ),
            task_ids: Some(Vec::new()),
        }));
        assert_eq!(updated_note.is_error, Some(false));
        assert!(structured(&updated_note)["note"]["taskIds"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(structured(&server.atticus_get_note(Parameters(GetNoteArgs {
            note_id: note_id.clone(),
        })))["note"]["body"]
            .as_str()
            .unwrap()
            .contains("preserve source notes"));
        let note_search = server.atticus_search_notes(Parameters(SearchNotesArgs {
            query: "preserve source".to_owned(),
            project_id: Some(project_id.clone()),
            limit: Some(10),
        }));
        assert_eq!(structured(&note_search)[0]["noteId"], note_id);
        assert_eq!(structured(&note_search)[0]["writable"], true);

        let updated_task = server.atticus_update_task(Parameters(UpdateTaskArgs {
            task_id: task_id.clone(),
            expected_updated_at: first_updated_at,
            title: None,
            description: Some(
                "# Brief\n\nPrepare the approved field guide.\n\n## Decision\n\nUse the reviewed outline."
                    .to_owned(),
            ),
            priority: None,
            due_date: None,
            clear_due_date: false,
            estimate_minutes: None,
            clear_estimate: false,
        }));
        assert_eq!(updated_task.is_error, Some(false));

        let in_progress = server.atticus_set_task_status(Parameters(SetTaskStatusArgs {
            task_id: task_id.clone(),
            status: WorkflowStatus::InProgress,
        }));
        assert_eq!(structured(&in_progress)["requestedStatus"], "in_progress");
        assert_eq!(structured(&in_progress)["result"]["changed"], true);

        let with_subtask = server.atticus_add_subtask(Parameters(AddSubtaskArgs {
            task_id: task_id.clone(),
            title: "Verify every cited source".to_owned(),
        }));
        let subtask_id = structured(&with_subtask)["subtasks"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let subtask_updated_at = structured(&with_subtask)["subtasks"][0]["updatedAt"]
            .as_i64()
            .unwrap();
        let completed_subtask = server.atticus_update_subtask(Parameters(UpdateSubtaskArgs {
            subtask_id,
            expected_updated_at: subtask_updated_at,
            title: None,
            done: Some(true),
        }));
        assert_eq!(structured(&completed_subtask)["subtasks"][0]["done"], true);

        let label = server.atticus_create_label(Parameters(CreateLabelArgs {
            project_id: project_id.clone(),
            name: "source-verified".to_owned(),
            color: ColorToken::Grass,
        }));
        let label_id = structured(&label)["id"].as_str().unwrap().to_owned();
        let task_timestamp = structured(&completed_subtask)["task"]["updatedAt"]
            .as_i64()
            .unwrap();
        let labelled = server.atticus_set_task_labels(Parameters(SetTaskLabelsArgs {
            task_id: task_id.clone(),
            expected_updated_at: task_timestamp,
            label_ids: vec![label_id.clone()],
        }));
        assert_eq!(structured(&labelled)["labelIds"][0], label_id);

        let linked = server.atticus_add_link(Parameters(AddLinkArgs {
            task_id: task_id.clone(),
            url: "https://example.com/reviewed-source".to_owned(),
        }));
        assert_eq!(structured(&linked)["linkRefs"].as_array().unwrap().len(), 1);
        let duplicate_link = server.atticus_add_link(Parameters(AddLinkArgs {
            task_id: task_id.clone(),
            url: "https://example.com/reviewed-source".to_owned(),
        }));
        assert_eq!(duplicate_link.is_error, Some(true));

        let attached = server.atticus_add_file(Parameters(AddFileArgs {
            task_id: task_id.clone(),
            path: evidence_path.to_string_lossy().into_owned(),
        }));
        assert_eq!(
            structured(&attached)["fileRefs"].as_array().unwrap().len(),
            1
        );

        let done = server.atticus_set_task_status(Parameters(SetTaskStatusArgs {
            task_id: task_id.clone(),
            status: WorkflowStatus::Done,
        }));
        assert_eq!(structured(&done)["destination"]["name"], "Done");

        assert_eq!(
            structured(&server.atticus_get_task(Parameters(GetTaskArgs {
                task_id: task_id.clone(),
            })))["taskReference"],
            "PUB-1"
        );
        assert_eq!(
            structured(&server.atticus_get_board(Parameters(GetBoardArgs { board_id })))
                ["writable"],
            true
        );
        let search = server.atticus_search_tasks(Parameters(SearchTasksArgs {
            query: "pub-1".to_owned(),
            limit: Some(10),
        }));
        assert_eq!(structured(&search)[0]["taskId"], task_id);
        assert_eq!(structured(&search)[0]["writable"], true);

        let database = server.database().expect("database lock");
        assert_eq!(
            mcp::revision(database.connection()).unwrap(),
            15,
            "each successful mutation increments once; the rejected duplicate does not"
        );
    }

    #[test]
    fn stale_and_archived_note_writes_are_refused_without_revision_changes() {
        let server = AtticusMcp::new(Database::open_in_memory().expect("database opens"));
        set_access(&server, McpAccess::ReadWrite);

        let project = server.atticus_create_project(Parameters(CreateProjectArgs {
            name: "Managed notes".to_owned(),
            description: None,
            color: None,
            key_prefix: Some("MNT".to_owned()),
            directory_path: None,
        }));
        let project_id = structured(&project)["project"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let created = server.atticus_create_note(Parameters(CreateNoteArgs {
            project_id: project_id.clone(),
            title: "Current plan".to_owned(),
            body: Some("Authoritative body".to_owned()),
            task_ids: Vec::new(),
        }));
        let note_id = structured(&created)["note"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let updated_at = structured(&created)["note"]["updatedAt"].as_i64().unwrap();

        let stale = server.atticus_update_note(Parameters(UpdateNoteArgs {
            note_id: note_id.clone(),
            expected_updated_at: updated_at - 1,
            title: Some("Stale plan".to_owned()),
            body: None,
            task_ids: None,
        }));
        assert_eq!(stale.is_error, Some(true));
        assert!(structured(&stale)["message"]
            .as_str()
            .unwrap()
            .contains("changed after it was read"));

        {
            let mut database = server.database().expect("database lock");
            projects::set_archived(database.connection_mut(), &project_id, true)
                .expect("project archives through the owner-facing database API");
        }
        let archived = server.atticus_update_note(Parameters(UpdateNoteArgs {
            note_id: note_id.clone(),
            expected_updated_at: updated_at,
            title: Some("Archived plan".to_owned()),
            body: None,
            task_ids: None,
        }));
        assert_eq!(archived.is_error, Some(true));
        assert!(structured(&archived)["message"]
            .as_str()
            .unwrap()
            .contains("Archived projects are read-only"));

        let database = server.database().expect("database lock");
        assert_eq!(mcp::revision(database.connection()).unwrap(), 2);
        assert_eq!(
            notes::find(database.connection(), &note_id).unwrap().title,
            "Current plan"
        );
    }

    #[test]
    fn semantic_statuses_accept_normal_names_without_guessing_by_position() {
        let columns = vec![
            column("todo", "To do"),
            column("doing", "In Progress"),
            column("done", "Completed"),
        ];

        assert_eq!(
            resolve_status_column(&columns, WorkflowStatus::InProgress)
                .expect("status resolves")
                .id,
            "doing"
        );
        assert_eq!(
            resolve_status_column(&columns, WorkflowStatus::Done)
                .expect("status resolves")
                .id,
            "done"
        );
    }

    #[test]
    fn a_missing_or_ambiguous_status_is_refused() {
        let missing = vec![column("one", "Something else")];
        assert!(resolve_status_column(&missing, WorkflowStatus::Done).is_err());

        let ambiguous = vec![column("one", "Done"), column("two", "Completed")];
        assert!(resolve_status_column(&ambiguous, WorkflowStatus::Done).is_err());
    }

    #[test]
    fn invalid_focus_fields_do_not_leave_a_half_created_task() {
        let mut database = Database::open_in_memory().expect("database opens");
        let (_project, board_id) = projects::create(
            database.connection_mut(),
            NewProject {
                name: "Project".to_owned(),
                description: String::new(),
                color: "blue".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("project creates");
        let column_id = columns::list(database.connection(), &board_id)
            .expect("columns")
            .remove(0)
            .id;

        let result = tasks::create_with_details(
            database.connection_mut(),
            NewTask {
                column_id,
                title: "Should not survive".to_owned(),
            },
            tasks::NewTaskDetails {
                priority: Some(99),
                ..Default::default()
            },
        );

        assert!(result.is_err());
        let count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .expect("count reads");
        assert_eq!(count, 0);
    }

    #[test]
    fn file_attachment_is_confined_to_the_project_folder() {
        let directory = tempfile::tempdir().expect("project folder");
        let outside = tempfile::tempdir().expect("outside folder");
        let inside_file = directory.path().join("inside.txt");
        let outside_file = outside.path().join("outside.txt");
        std::fs::write(&inside_file, "inside").expect("inside file");
        std::fs::write(&outside_file, "outside").expect("outside file");

        let mut database = Database::open_in_memory().expect("database opens");
        let (project, board_id) = projects::create(
            database.connection_mut(),
            NewProject {
                name: "Project".to_owned(),
                description: String::new(),
                color: "blue".to_owned(),
                key_prefix: None,
                directory_path: Some(directory.path().to_string_lossy().into_owned()),
            },
        )
        .expect("project creates");
        let column_id = columns::list(database.connection(), &board_id)
            .expect("columns")
            .remove(0)
            .id;
        let task = tasks::create(
            database.connection_mut(),
            NewTask {
                column_id,
                title: "Task".to_owned(),
            },
        )
        .expect("task creates");
        assert_eq!(task.project_id, project.id);

        assert!(permitted_attachment_path(
            database.connection(),
            &task.id,
            &inside_file.to_string_lossy()
        )
        .is_ok());
        assert!(permitted_attachment_path(
            database.connection(),
            &task.id,
            &outside_file.to_string_lossy()
        )
        .is_err());
    }

    #[test]
    fn real_mcp_writes_cannot_modify_known_user_task_or_note_ids() {
        let mut database = Database::open_in_memory().expect("database opens");
        let (_project, board_id) = projects::create(
            database.connection_mut(),
            NewProject {
                name: "User project".to_owned(),
                description: String::new(),
                color: "blue".to_owned(),
                key_prefix: None,
                directory_path: None,
            },
        )
        .expect("user project creates");
        let column_id = columns::list(database.connection(), &board_id)
            .expect("columns")
            .remove(0)
            .id;
        let task = tasks::create(
            database.connection_mut(),
            NewTask {
                column_id,
                title: "User-owned title".to_owned(),
            },
        )
        .expect("user task creates");
        let note = notes::create(
            database.connection_mut(),
            &task.project_id,
            "User-owned note",
            "Private body",
            std::slice::from_ref(&task.id),
        )
        .expect("user note creates");
        mcp::set_settings(
            database.connection(),
            &McpSettings {
                access: McpAccess::ReadWrite,
                allow_file_attachments: true,
            },
        )
        .expect("read/write enables");

        let server = AtticusMcp::new(database);
        let readable_note = server.atticus_get_note(Parameters(GetNoteArgs {
            note_id: note.id.clone(),
        }));
        assert_eq!(readable_note.is_error, Some(false));
        assert_eq!(structured(&readable_note)["writable"], false);
        assert_eq!(structured(&readable_note)["note"]["body"], "Private body");
        let response = server.atticus_update_task(Parameters(UpdateTaskArgs {
            task_id: task.id.clone(),
            expected_updated_at: task.updated_at,
            title: Some("AI changed this".to_owned()),
            description: None,
            priority: None,
            due_date: None,
            clear_due_date: false,
            estimate_minutes: None,
            clear_estimate: false,
        }));

        assert_eq!(response.is_error, Some(true));
        assert!(serde_json::to_string(&response.content)
            .expect("response serializes")
            .contains("outside the isolated AI Boards section"));
        let note_response = server.atticus_update_note(Parameters(UpdateNoteArgs {
            note_id: note.id.clone(),
            expected_updated_at: note.updated_at,
            title: None,
            body: Some("AI changed this".to_owned()),
            task_ids: None,
        }));
        assert_eq!(note_response.is_error, Some(true));
        assert!(serde_json::to_string(&note_response.content)
            .expect("response serializes")
            .contains("outside the isolated AI Boards section"));

        let locked = server.database().expect("database lock");
        assert_eq!(
            tasks::find(locked.connection(), &task.id)
                .expect("task remains")
                .title,
            "User-owned title"
        );
        assert_eq!(
            notes::find(locked.connection(), &note.id)
                .expect("note remains")
                .body,
            "Private body"
        );
        assert_eq!(
            mcp::revision(locked.connection()).expect("revision reads"),
            0,
            "rejected writes must not announce a change"
        );
    }
}
