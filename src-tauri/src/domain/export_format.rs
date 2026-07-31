//! The export document: its shape, its version, and the upgrade chain.
//!
//! `exportVersion` is **independent** of the SQLite schema version and of the
//! application version (ADR-0006). It increments only when the shape below
//! changes, because it is a promise to the user's future self and a number they
//! are asked to trust. Tying it to the schema would churn it every time an index
//! moved.
//!
//! Reading an older document is a chain of pure functions `v1 → v2 → … →
//! CURRENT`, each with a checked-in fixture that is kept forever. Reading a
//! newer one is refused, naming both numbers, and never partially applied.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult};

/// The shape this build writes, and the highest it can read.
pub const CURRENT_EXPORT_VERSION: u32 = 2;

/// The application name written into the envelope, so a file that is obviously
/// from somewhere else can be rejected by looking rather than by parsing.
pub const EXPORT_APP: &str = "atticus";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportDocument.ts")]
pub struct ExportDocument {
    pub export_version: u32,
    pub generated_at: String,
    pub app: String,
    pub app_version: String,
    pub data: ExportData,
}

/// Every record, in dependency order. Archived rows are included: an export that
/// silently dropped them would be a lossy backup wearing the word "export".
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportData.ts")]
pub struct ExportData {
    #[serde(default)]
    pub projects: Vec<ExportProject>,
    #[serde(default)]
    pub boards: Vec<ExportBoard>,
    #[serde(default)]
    pub columns: Vec<ExportColumn>,
    #[serde(default)]
    pub tasks: Vec<ExportTask>,
    #[serde(default)]
    pub subtasks: Vec<ExportSubtask>,
    #[serde(default)]
    pub labels: Vec<ExportLabel>,
    #[serde(default)]
    pub task_labels: Vec<ExportTaskLabel>,
    #[serde(default)]
    pub file_refs: Vec<ExportFileRef>,
    #[serde(default)]
    pub saved_filters: Vec<ExportSavedFilter>,
    #[serde(default)]
    pub notes: Vec<ExportNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportProject.ts")]
pub struct ExportProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub color: String,
    pub key_prefix: String,
    #[ts(type = "number")]
    pub next_task_number: i64,
    pub directory_path: Option<String>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportBoard.ts")]
pub struct ExportBoard {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportColumn.ts")]
pub struct ExportColumn {
    pub id: String,
    pub board_id: String,
    pub name: String,
    #[ts(type = "number | null")]
    pub wip_limit: Option<i64>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportTask.ts")]
pub struct ExportTask {
    pub id: String,
    pub project_id: String,
    pub board_id: String,
    pub column_id: String,
    #[ts(type = "number")]
    pub number: i64,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[ts(type = "number")]
    pub priority: i64,
    pub due_date: Option<String>,
    #[ts(type = "number | null")]
    pub estimate_minutes: Option<i64>,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportSubtask.ts")]
pub struct ExportSubtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub done: bool,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportLabel.ts")]
pub struct ExportLabel {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportTaskLabel.ts")]
pub struct ExportTaskLabel {
    pub task_id: String,
    pub label_id: String,
}

/// File references travel as **paths, not contents** (ADR-0006). Restoring on
/// another machine therefore shows honest "missing file" states rather than
/// pretending the bytes came along.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportFileRef.ts")]
pub struct ExportFileRef {
    pub id: String,
    pub task_id: String,
    pub path: String,
    pub display_name: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportSavedFilter.ts")]
pub struct ExportSavedFilter {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub filter: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ExportNote.ts")]
pub struct ExportNote {
    pub id: String,
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[ts(type = "number")]
    pub position: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// Brings any readable document up to `CURRENT_EXPORT_VERSION`.
///
/// Refuses a newer version by number rather than trying to read it: a document
/// written by a later build may carry fields whose absence here would be a
/// silent data loss, and "partially imported" is the one outcome ADR-0006 does
/// not allow.
pub fn upgrade(document: serde_json::Value) -> AppResult<ExportDocument> {
    let version = document
        .get("exportVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            AppError::validation(
                "exportVersion",
                "This file has no exportVersion, so it is not an Atticus export.",
            )
        })?;

    if version > u64::from(CURRENT_EXPORT_VERSION) {
        return Err(AppError::validation(
            "exportVersion",
            format!(
                "This file was written by a newer version of Atticus (export version {version}); \
                 this build understands up to {CURRENT_EXPORT_VERSION}. Nothing has been imported."
            ),
        ));
    }

    // The upgrade chain. Each arm takes the document one version forward and is
    // a pure function of the value, so a fixture can pin it forever. There is
    // only one released shape so far; the `match` is the shape the second one
    // slots into rather than a rewrite.
    let current = match version {
        1 => v1_to_v2(document),
        2 => document,
        other => {
            return Err(AppError::validation(
                "exportVersion",
                format!("Export version {other} is not a version this build has ever written."),
            ));
        }
    };

    serde_json::from_value(current).map_err(|error| AppError::Validation {
        field: "data".into(),
        message: format!("This file is not shaped like an Atticus export: {error}"),
    })
}

/// v1 → v2: notes did not exist.
///
/// `ExportData` defaults every collection, so deserialising a v1 document would
/// already have produced an empty `notes`. This arm exists anyway, and writes
/// the empty list explicitly, because the chain's value is that every released
/// shape has a named step: the next migration that is *not* a no-op has
/// somewhere obvious to go, and a reader can see that v1 files were considered
/// rather than merely happening to work.
fn v1_to_v2(mut document: serde_json::Value) -> serde_json::Value {
    if let Some(data) = document
        .get_mut("data")
        .and_then(serde_json::Value::as_object_mut)
    {
        data.entry("notes")
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    }
    document["exportVersion"] = serde_json::json!(CURRENT_EXPORT_VERSION);
    document
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(version: u32) -> serde_json::Value {
        serde_json::json!({
            "exportVersion": version,
            "generatedAt": "2026-07-30T09:41:12.000Z",
            "app": EXPORT_APP,
            "appVersion": "0.1.0",
            "data": {},
        })
    }

    #[test]
    fn reads_the_current_version() {
        let document = upgrade(envelope(CURRENT_EXPORT_VERSION)).expect("current version reads");

        assert_eq!(document.export_version, CURRENT_EXPORT_VERSION);
        assert!(document.data.projects.is_empty());
    }

    #[test]
    fn refuses_a_newer_version_naming_both_numbers() {
        let error = upgrade(envelope(CURRENT_EXPORT_VERSION + 1)).expect_err("newer is refused");

        let message = error.to_string();
        assert!(
            message.contains(&(CURRENT_EXPORT_VERSION + 1).to_string()),
            "the message should name the file's version: {message}"
        );
        assert!(
            message.contains(&CURRENT_EXPORT_VERSION.to_string()),
            "the message should name this build's version: {message}"
        );
        assert!(
            message.contains("Nothing has been imported"),
            "the message should say nothing was written: {message}"
        );
    }

    #[test]
    fn refuses_a_file_with_no_version_at_all() {
        let error = upgrade(serde_json::json!({ "data": {} })).expect_err("unversioned is refused");

        assert!(error.to_string().contains("exportVersion"));
    }

    #[test]
    fn refuses_a_document_whose_data_is_the_wrong_shape() {
        let mut document = envelope(CURRENT_EXPORT_VERSION);
        document["data"]["projects"] = serde_json::json!("not an array");

        let error = upgrade(document).expect_err("a wrong-shaped document is refused");

        assert!(error.to_string().contains("not shaped like"));
    }

    #[test]
    fn a_document_round_trips_through_json_unchanged() {
        // The export is a promise about a file on disk, so the assertion that
        // matters is that what we write is what we can read back.
        let original = ExportDocument {
            export_version: CURRENT_EXPORT_VERSION,
            generated_at: "2026-07-30T09:41:12.000Z".into(),
            app: EXPORT_APP.into(),
            app_version: "0.1.0".into(),
            data: ExportData {
                projects: vec![ExportProject {
                    id: "p1".into(),
                    name: "Atticus".into(),
                    description: "A board".into(),
                    color: "indigo".into(),
                    key_prefix: "ATT".into(),
                    next_task_number: 4,
                    directory_path: None,
                    position: 0,
                    archived_at: None,
                    created_at: 1,
                    updated_at: 2,
                }],
                ..ExportData::default()
            },
        };

        let json = serde_json::to_value(&original).expect("serialises");
        let read_back = upgrade(json).expect("reads back");

        assert_eq!(read_back.data.projects.len(), 1);
        assert_eq!(read_back.data.projects[0].key_prefix, "ATT");
        assert_eq!(read_back.data.projects[0].next_task_number, 4);
    }
}
