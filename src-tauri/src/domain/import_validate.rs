//! Validating an import document **before any write**.
//!
//! This is the ordering the whole data-safety story rests on (product-spec §8):
//! a malformed file cannot damage good data if nothing is written until the
//! entire document has been checked. Streaming or incremental import cannot make
//! that guarantee, so this is a pure function over the parsed document and knows
//! nothing about SQLite.
//!
//! Every problem is collected rather than returned on the first failure. A
//! person repairing a hand-edited export should see the whole list once instead
//! of discovering the next problem on each attempt.

use std::collections::HashSet;

use serde::Serialize;
use ts_rs::TS;

use crate::domain::export_format::ExportDocument;
use crate::domain::validate;
use crate::error::{AppError, AppResult, ImportIssue};

/// What an import *would* create, shown before the user commits to it
/// (product-spec §7.2: "will create 3 projects, 11 boards, 214 tasks").
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ImportPlan.ts")]
pub struct ImportPlan {
    #[ts(type = "number")]
    pub projects: usize,
    #[ts(type = "number")]
    pub boards: usize,
    #[ts(type = "number")]
    pub columns: usize,
    #[ts(type = "number")]
    pub tasks: usize,
    #[ts(type = "number")]
    pub subtasks: usize,
    #[ts(type = "number")]
    pub labels: usize,
    #[ts(type = "number")]
    pub file_refs: usize,
    #[ts(type = "number")]
    pub saved_filters: usize,
    #[ts(type = "number")]
    pub notes: usize,
}

/// Checks the document and returns what it would create.
///
/// Returns `AppError::ImportInvalid` carrying every issue found, so the caller
/// can list them all with their paths.
pub fn validate_document(document: &ExportDocument) -> AppResult<ImportPlan> {
    let mut issues = Vec::new();

    check_projects(document, &mut issues);
    check_boards(document, &mut issues);
    check_columns(document, &mut issues);
    check_tasks(document, &mut issues);
    check_children(document, &mut issues);

    if issues.is_empty() {
        Ok(plan(document))
    } else {
        Err(AppError::ImportInvalid { issues })
    }
}

fn plan(document: &ExportDocument) -> ImportPlan {
    let data = &document.data;
    ImportPlan {
        projects: data.projects.len(),
        boards: data.boards.len(),
        columns: data.columns.len(),
        tasks: data.tasks.len(),
        subtasks: data.subtasks.len(),
        labels: data.labels.len(),
        file_refs: data.file_refs.len(),
        saved_filters: data.saved_filters.len(),
        notes: data.notes.len(),
    }
}

/// Ids that must be unique within the document, and referenced ids that must
/// resolve. Duplicate ids are checked because a document with two records
/// claiming the same id has no single correct interpretation.
fn unique_ids<'a>(
    ids: impl Iterator<Item = &'a str>,
    path: &str,
    issues: &mut Vec<ImportIssue>,
) -> HashSet<&'a str> {
    let mut seen = HashSet::new();

    for (index, id) in ids.enumerate() {
        if id.trim().is_empty() {
            issues.push(ImportIssue::new(
                format!("data.{path}[{index}].id"),
                "An id must not be empty.",
            ));
        } else if !seen.insert(id) {
            issues.push(ImportIssue::new(
                format!("data.{path}[{index}].id"),
                format!("Duplicate id {id}: two records cannot claim the same id."),
            ));
        }
    }

    seen
}

fn check_projects(document: &ExportDocument, issues: &mut Vec<ImportIssue>) {
    unique_ids(
        document.data.projects.iter().map(|p| p.id.as_str()),
        "projects",
        issues,
    );

    for (index, project) in document.data.projects.iter().enumerate() {
        if validate::required_text("name", &project.name, validate::PROJECT_NAME_MAX).is_err() {
            issues.push(ImportIssue::new(
                format!("data.projects[{index}].name"),
                format!(
                    "A project name must be between 1 and {} characters.",
                    validate::PROJECT_NAME_MAX
                ),
            ));
        }
        if validate::color("color", &project.color).is_err() {
            issues.push(ImportIssue::new(
                format!("data.projects[{index}].color"),
                format!("{} is not a colour this application knows.", project.color),
            ));
        }
    }
}

fn check_boards(document: &ExportDocument, issues: &mut Vec<ImportIssue>) {
    let projects: HashSet<&str> = document
        .data
        .projects
        .iter()
        .map(|p| p.id.as_str())
        .collect();

    unique_ids(
        document.data.boards.iter().map(|b| b.id.as_str()),
        "boards",
        issues,
    );

    for (index, board) in document.data.boards.iter().enumerate() {
        if !projects.contains(board.project_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.boards[{index}].projectId"),
                format!("No project with id {} is in this file.", board.project_id),
            ));
        }
        if board.name.trim().is_empty() {
            issues.push(ImportIssue::new(
                format!("data.boards[{index}].name"),
                "A board name must not be empty.",
            ));
        }
    }
}

fn check_columns(document: &ExportDocument, issues: &mut Vec<ImportIssue>) {
    let boards: HashSet<&str> = document.data.boards.iter().map(|b| b.id.as_str()).collect();

    unique_ids(
        document.data.columns.iter().map(|c| c.id.as_str()),
        "columns",
        issues,
    );

    for (index, column) in document.data.columns.iter().enumerate() {
        if !boards.contains(column.board_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.columns[{index}].boardId"),
                format!("No board with id {} is in this file.", column.board_id),
            ));
        }
        // The schema's own CHECK constraint, applied here so it surfaces as a
        // located issue rather than as a database error mid-import.
        if column.wip_limit.is_some_and(|limit| limit <= 0) {
            issues.push(ImportIssue::new(
                format!("data.columns[{index}].wipLimit"),
                "A work-in-progress limit must be greater than zero, or absent.",
            ));
        }
    }
}

fn check_tasks(document: &ExportDocument, issues: &mut Vec<ImportIssue>) {
    let projects: HashSet<&str> = document
        .data
        .projects
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    let boards: HashSet<&str> = document.data.boards.iter().map(|b| b.id.as_str()).collect();
    let columns: HashSet<&str> = document
        .data
        .columns
        .iter()
        .map(|c| c.id.as_str())
        .collect();

    unique_ids(
        document.data.tasks.iter().map(|t| t.id.as_str()),
        "tasks",
        issues,
    );

    for (index, task) in document.data.tasks.iter().enumerate() {
        let path = |field: &str| format!("data.tasks[{index}].{field}");

        if !projects.contains(task.project_id.as_str()) {
            issues.push(ImportIssue::new(
                path("projectId"),
                format!("No project with id {} is in this file.", task.project_id),
            ));
        }
        if !boards.contains(task.board_id.as_str()) {
            issues.push(ImportIssue::new(
                path("boardId"),
                format!("No board with id {} is in this file.", task.board_id),
            ));
        }
        if !columns.contains(task.column_id.as_str()) {
            issues.push(ImportIssue::new(
                path("columnId"),
                format!("No column with id {} is in this file.", task.column_id),
            ));
        }
        if validate::required_text("title", &task.title, validate::TASK_TITLE_MAX).is_err() {
            issues.push(ImportIssue::new(
                path("title"),
                format!(
                    "A task title must be between 1 and {} characters.",
                    validate::TASK_TITLE_MAX
                ),
            ));
        }
        if !(0..=4).contains(&task.priority) {
            issues.push(ImportIssue::new(
                path("priority"),
                format!("Priority must be 0 to 4; this is {}.", task.priority),
            ));
        }
        if let Some(due) = task.due_date.as_deref() {
            if !is_calendar_date(due) {
                issues.push(ImportIssue::new(
                    path("dueDate"),
                    format!("{due} is not a YYYY-MM-DD calendar date."),
                ));
            }
        }
        if task.estimate_minutes.is_some_and(|minutes| minutes <= 0) {
            issues.push(ImportIssue::new(
                path("estimateMinutes"),
                "An estimate must be greater than zero, or absent.",
            ));
        }
    }
}

/// Subtasks, labels, task-label links, file references and saved filters — all
/// of which hang off a task, a project, or both.
fn check_children(document: &ExportDocument, issues: &mut Vec<ImportIssue>) {
    let data = &document.data;
    let projects: HashSet<&str> = data.projects.iter().map(|p| p.id.as_str()).collect();
    let tasks: HashSet<&str> = data.tasks.iter().map(|t| t.id.as_str()).collect();

    unique_ids(
        data.subtasks.iter().map(|s| s.id.as_str()),
        "subtasks",
        issues,
    );
    for (index, subtask) in data.subtasks.iter().enumerate() {
        if !tasks.contains(subtask.task_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.subtasks[{index}].taskId"),
                format!("No task with id {} is in this file.", subtask.task_id),
            ));
        }
        if subtask.title.trim().is_empty() {
            issues.push(ImportIssue::new(
                format!("data.subtasks[{index}].title"),
                "A subtask title must not be empty.",
            ));
        }
    }

    let labels = unique_ids(data.labels.iter().map(|l| l.id.as_str()), "labels", issues);
    for (index, label) in data.labels.iter().enumerate() {
        if !projects.contains(label.project_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.labels[{index}].projectId"),
                format!("No project with id {} is in this file.", label.project_id),
            ));
        }
        if validate::color("color", &label.color).is_err() {
            issues.push(ImportIssue::new(
                format!("data.labels[{index}].color"),
                format!("{} is not a colour this application knows.", label.color),
            ));
        }
    }

    for (index, link) in data.task_labels.iter().enumerate() {
        if !tasks.contains(link.task_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.taskLabels[{index}].taskId"),
                format!("No task with id {} is in this file.", link.task_id),
            ));
        }
        if !labels.contains(link.label_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.taskLabels[{index}].labelId"),
                format!("No label with id {} is in this file.", link.label_id),
            ));
        }
    }

    unique_ids(
        data.file_refs.iter().map(|f| f.id.as_str()),
        "fileRefs",
        issues,
    );
    for (index, file_ref) in data.file_refs.iter().enumerate() {
        if !tasks.contains(file_ref.task_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.fileRefs[{index}].taskId"),
                format!("No task with id {} is in this file.", file_ref.task_id),
            ));
        }
        if file_ref.path.trim().is_empty() {
            issues.push(ImportIssue::new(
                format!("data.fileRefs[{index}].path"),
                "A file reference must have a path.",
            ));
        }
    }

    unique_ids(data.notes.iter().map(|n| n.id.as_str()), "notes", issues);
    for (index, note) in data.notes.iter().enumerate() {
        if !projects.contains(note.project_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.notes[{index}].projectId"),
                format!("No project with id {} is in this file.", note.project_id),
            ));
        }
        if note.title.trim().is_empty() {
            issues.push(ImportIssue::new(
                format!("data.notes[{index}].title"),
                "A note must have a title.",
            ));
        }
    }

    unique_ids(
        data.saved_filters.iter().map(|f| f.id.as_str()),
        "savedFilters",
        issues,
    );
    for (index, filter) in data.saved_filters.iter().enumerate() {
        if !projects.contains(filter.project_id.as_str()) {
            issues.push(ImportIssue::new(
                format!("data.savedFilters[{index}].projectId"),
                format!("No project with id {} is in this file.", filter.project_id),
            ));
        }
        // The filter body is JSON held as text. An unparseable one would be
        // stored happily and then fail to apply, which is a defect deferred.
        if serde_json::from_str::<serde_json::Value>(&filter.filter).is_err() {
            issues.push(ImportIssue::new(
                format!("data.savedFilters[{index}].filter"),
                "A saved filter's definition is not valid JSON.",
            ));
        }
    }
}

/// `YYYY-MM-DD`, matching the schema's own GLOB, and a real date rather than
/// merely a well-shaped one.
fn is_calendar_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }

    let (Ok(year), Ok(month), Ok(day)) = (
        value[0..4].parse::<i64>(),
        value[5..7].parse::<u32>(),
        value[8..10].parse::<u32>(),
    ) else {
        return false;
    };

    (1..=12).contains(&month) && day >= 1 && day <= days_in_month(year, month)
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::export_format::{
        ExportBoard, ExportColumn, ExportData, ExportProject, ExportTask, CURRENT_EXPORT_VERSION,
        EXPORT_APP,
    };

    fn document(data: ExportData) -> ExportDocument {
        ExportDocument {
            export_version: CURRENT_EXPORT_VERSION,
            generated_at: "2026-07-30T09:41:12.000Z".into(),
            app: EXPORT_APP.into(),
            app_version: "0.1.0".into(),
            data,
        }
    }

    fn project(id: &str) -> ExportProject {
        ExportProject {
            id: id.into(),
            name: "A project".into(),
            description: String::new(),
            color: "indigo".into(),
            key_prefix: "PRJ".into(),
            next_task_number: 1,
            directory_path: None,
            position: 0,
            archived_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn board(id: &str, project_id: &str) -> ExportBoard {
        ExportBoard {
            id: id.into(),
            project_id: project_id.into(),
            name: "Board".into(),
            position: 0,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn column(id: &str, board_id: &str) -> ExportColumn {
        ExportColumn {
            id: id.into(),
            board_id: board_id.into(),
            name: "Todo".into(),
            wip_limit: None,
            position: 0,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn task(id: &str) -> ExportTask {
        ExportTask {
            id: id.into(),
            project_id: "p1".into(),
            board_id: "b1".into(),
            column_id: "c1".into(),
            number: 1,
            title: "A task".into(),
            description: String::new(),
            priority: 0,
            due_date: None,
            estimate_minutes: None,
            position: 0,
            archived_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    /// A minimal document that is entirely valid, so every test below changes
    /// exactly one thing and the failure it produces is attributable.
    fn sound() -> ExportData {
        ExportData {
            projects: vec![project("p1")],
            boards: vec![board("b1", "p1")],
            columns: vec![column("c1", "b1")],
            tasks: vec![task("t1")],
            ..ExportData::default()
        }
    }

    fn issues(data: ExportData) -> Vec<ImportIssue> {
        match validate_document(&document(data)) {
            Ok(plan) => panic!("expected issues, got a plan for {plan:?}"),
            Err(AppError::ImportInvalid { issues }) => issues,
            Err(other) => panic!("expected ImportInvalid, got {other:?}"),
        }
    }

    #[test]
    fn a_sound_document_yields_a_plan_with_the_counts() {
        let plan = validate_document(&document(sound())).expect("valid");

        assert_eq!(
            plan,
            ImportPlan {
                projects: 1,
                boards: 1,
                columns: 1,
                tasks: 1,
                ..ImportPlan::default()
            }
        );
    }

    #[test]
    fn an_empty_document_is_valid_and_creates_nothing() {
        // Not an error: exporting a project with nothing in it and importing it
        // back should be a no-op, not a failure.
        let plan = validate_document(&document(ExportData::default())).expect("valid");

        assert_eq!(plan, ImportPlan::default());
    }

    #[test]
    fn a_task_pointing_at_a_missing_column_is_located_by_json_path() {
        let mut data = sound();
        data.tasks[0].column_id = "nope".into();

        let found = issues(data);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "data.tasks[0].columnId");
        assert!(found[0].message.contains("nope"));
    }

    #[test]
    fn every_problem_is_reported_at_once_rather_than_the_first() {
        // The property that makes the list worth having: a person repairing a
        // hand-edited file sees all of it in one pass.
        let mut data = sound();
        data.tasks[0].column_id = "nope".into();
        data.tasks[0].priority = 9;
        data.tasks[0].title = String::new();
        data.boards[0].project_id = "missing".into();

        let found = issues(data);

        let paths: Vec<&str> = found.iter().map(|issue| issue.path.as_str()).collect();
        assert!(paths.contains(&"data.tasks[0].columnId"), "{paths:?}");
        assert!(paths.contains(&"data.tasks[0].priority"), "{paths:?}");
        assert!(paths.contains(&"data.tasks[0].title"), "{paths:?}");
        assert!(paths.contains(&"data.boards[0].projectId"), "{paths:?}");
    }

    #[test]
    fn two_records_cannot_claim_the_same_id() {
        let mut data = sound();
        data.tasks.push(task("t1"));

        let found = issues(data);

        assert_eq!(found[0].path, "data.tasks[1].id");
        assert!(found[0].message.contains("Duplicate"));
    }

    #[test]
    fn a_due_date_must_be_a_real_calendar_date() {
        for bad in [
            "2026-13-01",
            "2026-02-30",
            "2025-02-29",
            "30-07-2026",
            "2026-7-3",
        ] {
            let mut data = sound();
            data.tasks[0].due_date = Some(bad.to_owned());

            let found = issues(data);

            assert_eq!(found[0].path, "data.tasks[0].dueDate", "{bad} was accepted");
        }
    }

    #[test]
    fn a_real_leap_day_is_accepted() {
        let mut data = sound();
        data.tasks[0].due_date = Some("2024-02-29".to_owned());

        validate_document(&document(data)).expect("a leap day is a date");
    }

    #[test]
    fn a_wip_limit_of_zero_is_refused_before_sqlite_can_refuse_it() {
        let mut data = sound();
        data.columns[0].wip_limit = Some(0);

        let found = issues(data);

        assert_eq!(found[0].path, "data.columns[0].wipLimit");
    }

    #[test]
    fn an_unknown_colour_is_refused() {
        let mut data = sound();
        data.projects[0].color = "octarine".into();

        let found = issues(data);

        assert_eq!(found[0].path, "data.projects[0].color");
        assert!(found[0].message.contains("octarine"));
    }
}
