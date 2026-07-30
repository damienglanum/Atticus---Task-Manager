//! Tauri command surface. Commands stay thin: deserialise, validate, delegate.
//!
//! `#[tauri::command]` generates sibling items that `generate_handler!` looks up
//! by module path, so commands are referenced through their module rather than
//! flattened with `pub use`.
pub mod app_info;
pub mod board;
pub mod boards;
pub mod database;
pub mod detail;
pub mod find;
pub mod preferences;
pub mod projects;
pub mod transfer;
