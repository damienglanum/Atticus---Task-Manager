//! Atticus as a local Model Context Protocol server.
//!
//! The packaged application and the MCP server are one executable. Normal
//! launches open Tauri; `Atticus --mcp` serves newline-delimited JSON-RPC over
//! stdin/stdout. Keeping this in the application binary means an installed app
//! and its AI integration can never drift onto different database schemas.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};
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
use crate::db::projects::{self, NewProject, Project};
use crate::db::search;
use crate::db::subtasks::{self, SubtaskPatch};
use crate::db::tasks::{self, MoveResult, NewTask, TaskPatch};
use crate::db::{Database, DATABASE_FILE_NAME};
use crate::error::{AppError, AppResult};

const WORKFLOW_GUIDE: &str = r#"Atticus is the user's source of truth for planned and active work.

Rules for using this server:
1. MCP writes are confined to projects created through atticus_create_project and shown in the app's isolated AI Boards section. User-created projects, boards, columns, tasks, labels, files, and links are immutable through MCP. Never attempt to work around this boundary.
2. Inspect before writing. Use atticus_list_workspace, atticus_get_board, atticus_search_tasks, or atticus_get_task to obtain real IDs. Never invent an ID. The mcpManaged field identifies the writable AI scope.
3. Do not create a duplicate task when an existing AI-managed task represents the same work. Update the existing task instead.
4. When you actually begin accepted work, move its task to in_progress with atticus_set_task_status. Do not mark a task in progress merely because you inspected it.
5. Keep the task useful while working: update its description with decisions or outcomes, add concrete subtasks, and attach only relevant labels, links, and existing files.
6. Mark a subtask done only after that subtask is complete. Move the parent task to done only after the requested work is implemented and appropriately verified. If work fails or remains incomplete, leave it in progress and record the blocker in the description.
7. Status names are semantic conveniences. If a custom board has no matching status column, inspect the board and use atticus_move_task with an explicit column ID. Never guess the closest column.
8. A newly created project or board already contains Backlog, Todo, In Progress, Review, and Done columns. Do not recreate those columns.
9. Labels use one of these color tokens: slate, indigo, blue, cyan, teal, grass, amber, orange, red, plum. Reuse an existing label when its meaning already matches.
10. Links must be complete http:// or https:// URLs. Never fabricate a URL or file path.
11. File attachment only stores a reference; it never uploads or reads the file. Attachments must exist inside the task project's configured folder and require the user's separate file permission.
12. Destructive operations are intentionally unavailable. Never work around that by editing the database or filesystem directly.
13. After every mutation, use the returned object as the authoritative state. Report clearly what changed."#;

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
        tool_result(result)
    }

    fn write<T: Serialize>(
        &self,
        operation: impl FnOnce(&mut Database, &McpSettings) -> AppResult<T>,
    ) -> CallToolResult {
        let result = (|| {
            let mut database = self.database()?;
            let settings = mcp::settings(database.connection())?;
            require_write_access(&settings)?;
            let value = operation(&mut database, &settings)?;
            mcp::record_external_change(database.connection())?;
            Ok(value)
        })();
        tool_result(result)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionStatus {
    access: McpAccess,
    allow_file_attachments: bool,
    database_path: Option<String>,
    workflow_instructions_attached: bool,
    write_scope: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOverview {
    projects: Vec<ProjectOverview>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectOverview {
    project: Project,
    boards: Vec<BoardOverview>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardOverview {
    board: Board,
    columns: Vec<Column>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedProject {
    project: Project,
    initial_board: Board,
    columns: Vec<Column>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedBoard {
    board: Board,
    columns: Vec<Column>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskDetail {
    task: crate::db::tasks::Task,
    subtasks: Vec<crate::db::subtasks::Subtask>,
    label_ids: Vec<String>,
    available_labels: Vec<Label>,
    file_refs: Vec<crate::db::file_refs::FileRef>,
    link_refs: Vec<crate::db::link_refs::LinkRef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusMove {
    requested_status: WorkflowStatus,
    destination: Column,
    result: MoveResult,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GetBoardArgs {
    /// Board ID returned by atticus_list_workspace or atticus_search_tasks.
    board_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct GetTaskArgs {
    /// Task ID returned by a board, search, or mutation result.
    task_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct SearchTasksArgs {
    /// Words from the title or description. The final word is prefix matched.
    query: String,
    /// Maximum results, from 1 to 100. Defaults to 25.
    limit: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct CreateProjectArgs {
    name: String,
    /// Optional short explanation of what belongs in the project.
    description: Option<String>,
    /// Atticus color token. Defaults to blue.
    color: Option<String>,
    /// Optional 2-5 letter task prefix; derived from the name when omitted.
    key_prefix: Option<String>,
    /// Optional absolute folder associated with the project.
    directory_path: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct CreateBoardArgs {
    /// Existing project ID.
    project_id: String,
    name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct CreateColumnArgs {
    /// Existing board ID.
    board_id: String,
    name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct CreateTaskArgs {
    /// Destination column ID. Inspect the board first.
    column_id: String,
    title: String,
    /// Optional markdown description to save immediately after creation.
    description: Option<String>,
    /// 0 none, 1 low, 2 medium, 3 high, 4 urgent.
    priority: Option<i64>,
    /// Optional YYYY-MM-DD calendar date.
    due_date: Option<String>,
    /// Optional positive estimate, in minutes.
    estimate_minutes: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct UpdateTaskArgs {
    task_id: String,
    title: Option<String>,
    /// Complete replacement markdown description. Read the task first so useful
    /// existing context is not accidentally erased.
    description: Option<String>,
    /// 0 none, 1 low, 2 medium, 3 high, 4 urgent.
    priority: Option<i64>,
    /// YYYY-MM-DD. Use clear_due_date instead when removing it.
    due_date: Option<String>,
    #[serde(default)]
    clear_due_date: bool,
    /// Positive estimate in minutes. Use clear_estimate instead when removing it.
    estimate_minutes: Option<i64>,
    #[serde(default)]
    clear_estimate: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct MoveTaskArgs {
    task_id: String,
    /// Destination column ID on the task's current board.
    column_id: String,
    /// Zero-based position. Omit to append to the column.
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

#[derive(Debug, Deserialize, JsonSchema)]
struct SetTaskStatusArgs {
    task_id: String,
    status: WorkflowStatus,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct AddSubtaskArgs {
    task_id: String,
    title: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct UpdateSubtaskArgs {
    subtask_id: String,
    title: Option<String>,
    done: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct CreateLabelArgs {
    project_id: String,
    name: String,
    /// One of slate, indigo, blue, cyan, teal, grass, amber, orange, red, plum.
    color: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct SetTaskLabelsArgs {
    task_id: String,
    /// Complete replacement list of existing label IDs. Use [] to clear labels.
    label_ids: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct AddFileArgs {
    task_id: String,
    /// Absolute path to an existing file inside the task project's configured folder.
    path: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
struct AddLinkArgs {
    task_id: String,
    /// Complete http:// or https:// URL.
    url: String,
}

#[tool_router]
impl AtticusMcp {
    #[tool(
        description = "Show whether Atticus MCP is disabled, read-only, or read/write and whether file attachment is enabled. This diagnostic is available even while access is disabled."
    )]
    fn atticus_connection_status(&self) -> CallToolResult {
        let result = (|| {
            let database = self.database()?;
            let settings = mcp::settings(database.connection())?;
            Ok(ConnectionStatus {
                access: settings.access,
                allow_file_attachments: settings.allow_file_attachments,
                database_path: database
                    .path()
                    .map(|path| path.to_string_lossy().into_owned()),
                workflow_instructions_attached: true,
                write_scope: "AI-managed projects only",
            })
        })();
        tool_result(result)
    }

    #[tool(
        description = "Return the complete Atticus AI workflow guide. The same rules are attached to the MCP initialization instructions so clients receive them automatically."
    )]
    fn atticus_workflow_guide(&self) -> String {
        WORKFLOW_GUIDE.to_owned()
    }

    #[tool(
        description = "List all active projects with their boards and ordered columns. Call this before creating or moving work so you use real IDs and do not duplicate the default workflow."
    )]
    fn atticus_list_workspace(&self) -> CallToolResult {
        self.read(|database| workspace_overview(database.connection()))
    }

    #[tool(
        description = "Load one board with its columns, live tasks, labels, subtask counts, and archived count."
    )]
    fn atticus_get_board(&self, Parameters(args): Parameters<GetBoardArgs>) -> CallToolResult {
        self.read(|database| board_view::load(database.connection(), &args.board_id))
    }

    #[tool(
        description = "Load a task and everything shown in focus mode: description, subtasks, assigned and available labels, file references, and links."
    )]
    fn atticus_get_task(&self, Parameters(args): Parameters<GetTaskArgs>) -> CallToolResult {
        self.read(|database| task_detail(database.connection(), &args.task_id))
    }

    #[tool(
        description = "Search live and archived tasks by title or description. Use this before creating a task when similar work may already exist."
    )]
    fn atticus_search_tasks(
        &self,
        Parameters(args): Parameters<SearchTasksArgs>,
    ) -> CallToolResult {
        self.read(|database| {
            search::search(
                database.connection(),
                &args.query,
                args.limit.unwrap_or(25).clamp(1, 100),
            )
        })
    }

    #[tool(
        description = "Create an isolated AI-managed project shown under AI Boards. It automatically includes an initial Board with Backlog, Todo, In Progress, Review, and Done columns. This is the only way MCP can establish writable scope. Requires read/write access."
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
                    color: args.color.unwrap_or_else(|| "blue".to_owned()),
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
        description = "Create a board inside an AI-managed project. User projects are immutable through MCP. The board automatically receives Backlog, Todo, In Progress, Review, and Done columns. Requires read/write access."
    )]
    fn atticus_create_board(
        &self,
        Parameters(args): Parameters<CreateBoardArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_project(database.connection(), &args.project_id)?;
            let board = boards::create(database.connection_mut(), &args.project_id, &args.name)?;
            let columns = columns::list(database.connection(), &board.id)?;
            Ok(CreatedBoard { board, columns })
        })
    }

    #[tool(
        description = "Append a custom column to an AI-managed board. User boards are immutable. Inspect first; new boards already have the five standard workflow columns. Requires read/write access."
    )]
    fn atticus_create_column(
        &self,
        Parameters(args): Parameters<CreateColumnArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_board(database.connection(), &args.board_id)?;
            columns::create(database.connection_mut(), &args.board_id, &args.name)
        })
    }

    #[tool(
        description = "Create a task at the end of a column inside AI Boards and optionally set its focus-mode fields. User columns are immutable. Search first when duplicate work may exist. Requires read/write access."
    )]
    fn atticus_create_task(&self, Parameters(args): Parameters<CreateTaskArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_column(database.connection(), &args.column_id)?;
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
        description = "Update an AI-managed task's focus-mode fields. User tasks are immutable. Description is a complete replacement, so read first and preserve useful context. Requires read/write access."
    )]
    fn atticus_update_task(&self, Parameters(args): Parameters<UpdateTaskArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_task(database.connection(), &args.task_id)?;
            tasks::update(
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
            )?;
            task_detail(database.connection(), &args.task_id)
        })
    }

    #[tool(
        description = "Move an AI-managed task to an explicit AI-managed column and optional zero-based index. User tasks and columns are immutable. Omit index to append. Requires read/write access."
    )]
    fn atticus_move_task(&self, Parameters(args): Parameters<MoveTaskArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_task(database.connection(), &args.task_id)?;
            mcp::require_managed_column(database.connection(), &args.column_id)?;
            tasks::move_to(
                database.connection_mut(),
                &args.task_id,
                &args.column_id,
                args.index.unwrap_or(i64::MAX),
            )
        })
    }

    #[tool(
        description = "Move a task to a semantic Backlog, Todo, In Progress, Review, or Done column. The board must contain an unambiguous matching column; otherwise inspect it and use atticus_move_task. Requires read/write access."
    )]
    fn atticus_set_task_status(
        &self,
        Parameters(args): Parameters<SetTaskStatusArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_task(database.connection(), &args.task_id)?;
            let task = tasks::find(database.connection(), &args.task_id)?;
            let board_columns = columns::list(database.connection(), &task.board_id)?;
            let destination = resolve_status_column(&board_columns, args.status)?;
            let result = tasks::move_to(
                database.connection_mut(),
                &args.task_id,
                &destination.id,
                i64::MAX,
            )?;
            Ok(StatusMove {
                requested_status: args.status,
                destination,
                result,
            })
        })
    }

    #[tool(
        description = "Append a concrete checklist item to an AI-managed task. User tasks are immutable. Adding a subtask does not complete or move its parent. Requires read/write access."
    )]
    fn atticus_add_subtask(&self, Parameters(args): Parameters<AddSubtaskArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_task(database.connection(), &args.task_id)?;
            subtasks::create(database.connection_mut(), &args.task_id, &args.title)?;
            task_detail(database.connection(), &args.task_id)
        })
    }

    #[tool(
        description = "Rename or complete a subtask inside AI Boards. User subtasks are immutable. Mark done only after the item is actually complete. Requires read/write access."
    )]
    fn atticus_update_subtask(
        &self,
        Parameters(args): Parameters<UpdateSubtaskArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_subtask(database.connection(), &args.subtask_id)?;
            let existing = subtasks::find(database.connection(), &args.subtask_id)?;
            subtasks::update(
                database.connection(),
                &args.subtask_id,
                SubtaskPatch {
                    title: args.title,
                    done: args.done,
                },
            )?;
            task_detail(database.connection(), &existing.task_id)
        })
    }

    #[tool(
        description = "Create a reusable label inside an AI-managed project. User projects are immutable. Reuse an existing label when its meaning already matches. Requires read/write access."
    )]
    fn atticus_create_label(
        &self,
        Parameters(args): Parameters<CreateLabelArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_project(database.connection(), &args.project_id)?;
            labels::create(
                database.connection(),
                &args.project_id,
                LabelInput {
                    name: args.name,
                    color: args.color,
                },
            )
        })
    }

    #[tool(
        description = "Replace an AI-managed task's labels with IDs from the same AI project. User tasks are immutable. Read first; this is replacement, not addition. Requires read/write access."
    )]
    fn atticus_set_task_labels(
        &self,
        Parameters(args): Parameters<SetTaskLabelsArgs>,
    ) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_task(database.connection(), &args.task_id)?;
            labels::set_for_task(database.connection_mut(), &args.task_id, &args.label_ids)?;
            task_detail(database.connection(), &args.task_id)
        })
    }

    #[tool(
        description = "Attach a reference to an existing file inside the task project's configured folder. This never reads or uploads file contents and requires both read/write access and the separate file-attachment permission."
    )]
    fn atticus_add_file(&self, Parameters(args): Parameters<AddFileArgs>) -> CallToolResult {
        self.write(|database, settings| {
            mcp::require_managed_task(database.connection(), &args.task_id)?;
            if !settings.allow_file_attachments {
                return Err(AppError::Conflict {
                    message: "File attachment is disabled in Atticus Settings → AI access."
                        .to_owned(),
                });
            }

            let path = permitted_attachment_path(database.connection(), &args.task_id, &args.path)?;
            file_refs::add(
                database.connection_mut(),
                &args.task_id,
                &path.to_string_lossy(),
                None,
            )?;
            task_detail(database.connection(), &args.task_id)
        })
    }

    #[tool(
        description = "Attach a complete http:// or https:// link to an AI-managed task. User tasks are immutable. Never invent a URL. Requires read/write access."
    )]
    fn atticus_add_link(&self, Parameters(args): Parameters<AddLinkArgs>) -> CallToolResult {
        self.write(|database, _settings| {
            mcp::require_managed_task(database.connection(), &args.task_id)?;
            link_refs::add(database.connection_mut(), &args.task_id, &args.url)?;
            task_detail(database.connection(), &args.task_id)
        })
    }
}

#[tool_handler(
    name = "atticus",
    version = "0.1.0",
    instructions = r#"Use Atticus as the user's source of truth. MCP writes are confined to projects created through atticus_create_project and shown in the isolated AI Boards sidebar section; all user-created work is immutable. Always inspect before writing and never invent IDs. Move a task to in_progress only when accepted work actually begins. Keep its description, subtasks, labels, links, and permitted file references useful while working. Move it to done only after implementation and appropriate verification succeed; otherwise leave it in progress and record the blocker. New projects and boards already contain Backlog, Todo, In Progress, Review, and Done. Destructive tools are intentionally unavailable. Call atticus_workflow_guide for the complete rules."#
)]
impl ServerHandler for AtticusMcp {}

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

fn tool_result<T: Serialize>(result: AppResult<T>) -> CallToolResult {
    match result {
        Ok(value) => match (
            serde_json::to_value(&value),
            serde_json::to_string_pretty(&value),
        ) {
            (Ok(structured), Ok(readable)) => {
                let mut result = CallToolResult::structured(structured);
                result.content = vec![ContentBlock::text(readable)];
                result
            }
            (Err(error), _) | (_, Err(error)) => CallToolResult::error(vec![ContentBlock::text(
                format!("Atticus completed the operation but could not encode its result: {error}"),
            )]),
        },
        Err(error) => CallToolResult::error(vec![ContentBlock::text(error.to_string())]),
    }
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

fn task_detail(conn: &rusqlite::Connection, task_id: &str) -> AppResult<TaskDetail> {
    let task = tasks::find(conn, task_id)?;
    Ok(TaskDetail {
        subtasks: subtasks::list(conn, task_id)?,
        label_ids: labels::for_task(conn, task_id)?,
        available_labels: labels::list(conn, &task.project_id)?,
        file_refs: file_refs::list(conn, task_id)?,
        link_refs: link_refs::list(conn, task_id)?,
        task,
    })
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
                "This board has no unambiguous {status:?} column. Available columns: {}. Use atticus_move_task with an explicit column ID.",
                columns
                    .iter()
                    .map(|column| format!("{} ({})", column.name, column.id))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }),
        _ => Err(AppError::Conflict {
            message: format!(
                "More than one column matches {status:?}: {}. Use atticus_move_task with the intended column ID.",
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
    fn a_real_mcp_write_cannot_modify_a_known_user_task_id() {
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
        mcp::set_settings(
            database.connection(),
            &McpSettings {
                access: McpAccess::ReadWrite,
                allow_file_attachments: true,
            },
        )
        .expect("read/write enables");

        let server = AtticusMcp::new(database);
        let response = server.atticus_update_task(Parameters(UpdateTaskArgs {
            task_id: task.id.clone(),
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

        let locked = server.database().expect("database lock");
        assert_eq!(
            tasks::find(locked.connection(), &task.id)
                .expect("task remains")
                .title,
            "User-owned title"
        );
        assert_eq!(
            mcp::revision(locked.connection()).expect("revision reads"),
            0,
            "rejected writes must not announce a change"
        );
    }
}
