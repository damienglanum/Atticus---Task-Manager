//! Authoritative input validation.
//!
//! The webview validates too, with Zod, so the user gets immediate feedback —
//! but that layer is a convenience and is never trusted. These functions run on
//! every command call regardless of what the frontend did, and the limits here
//! are the ones that actually hold. See `docs/architecture.md` §7.

use crate::domain::palette;
use crate::error::{AppError, AppResult};

pub const PROJECT_NAME_MAX: usize = 100;
pub const PROJECT_DESCRIPTION_MAX: usize = 2000;
pub const BOARD_NAME_MAX: usize = 100;
pub const COLUMN_NAME_MAX: usize = 60;
pub const TASK_TITLE_MAX: usize = 500;
pub const TASK_DESCRIPTION_MAX: usize = 100_000;
pub const SUBTASK_TITLE_MAX: usize = 300;
pub const LABEL_NAME_MAX: usize = 40;
pub const SAVED_FILTER_NAME_MAX: usize = 60;
/// Highest priority level. The scale is fixed (US-15 AC1): None, Low, Medium,
/// High, Urgent. Not user-editable, so it can carry a distinct glyph per level.
pub const PRIORITY_MAX: i64 = 4;
/// Fourteen days. Beyond that an "estimate" is a plan, not an estimate.
pub const ESTIMATE_MINUTES_MAX: i64 = 60 * 24 * 14;
pub const KEY_PREFIX_MIN: usize = 2;
pub const KEY_PREFIX_MAX: usize = 5;

/// Trims, then requires a non-empty result within `max` characters.
///
/// Length is counted in `char`s, not bytes: a limit that silently halves for
/// someone writing in a non-Latin script is a bug, not a policy.
pub fn required_text(field: &str, value: &str, max: usize) -> AppResult<String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(AppError::validation(field, "This can't be empty."));
    }

    let length = trimmed.chars().count();
    if length > max {
        return Err(AppError::validation(
            field,
            format!("Keep this to {max} characters or fewer (currently {length})."),
        ));
    }

    Ok(trimmed.to_owned())
}

/// Trims and length-checks, but permits empty.
pub fn optional_text(field: &str, value: &str, max: usize) -> AppResult<String> {
    let trimmed = value.trim();
    let length = trimmed.chars().count();

    if length > max {
        return Err(AppError::validation(
            field,
            format!("Keep this to {max} characters or fewer (currently {length})."),
        ));
    }

    Ok(trimmed.to_owned())
}

pub fn color(field: &str, value: &str) -> AppResult<String> {
    if palette::is_valid(value) {
        Ok(value.to_owned())
    } else {
        Err(AppError::validation(
            field,
            format!("Choose one of: {}.", palette::COLORS.join(", ")),
        ))
    }
}

/// A short human-readable project key, e.g. `KAN` in `KAN-14`.
///
/// Uppercased on the user's behalf rather than rejected for case, because
/// insisting on shift is friction with no benefit.
pub fn key_prefix(field: &str, value: &str) -> AppResult<String> {
    let normalised: String = value.trim().to_uppercase();

    if !normalised
        .chars()
        .all(|character| character.is_ascii_uppercase())
    {
        return Err(AppError::validation(field, "Use letters A–Z only."));
    }

    let length = normalised.chars().count();
    if !(KEY_PREFIX_MIN..=KEY_PREFIX_MAX).contains(&length) {
        return Err(AppError::validation(
            field,
            format!("Use between {KEY_PREFIX_MIN} and {KEY_PREFIX_MAX} letters."),
        ));
    }

    Ok(normalised)
}

/// An optional absolute path. Whether it currently exists is **not** validated
/// here — a project whose directory is temporarily on an unmounted volume is
/// still a valid project. Existence is reported separately so the UI can warn.
pub fn optional_directory(field: &str, value: Option<&str>) -> AppResult<Option<String>> {
    let Some(raw) = value else { return Ok(None) };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.contains('\0') {
        return Err(AppError::validation(field, "That isn't a usable path."));
    }

    if !std::path::Path::new(trimmed).is_absolute() {
        return Err(AppError::validation(
            field,
            "Use a full path, starting with /.",
        ));
    }

    Ok(Some(trimmed.to_owned()))
}

/// Derives a default key prefix from a project name: `"Taken Kanban"` → `"TAK"`.
///
/// Falls back to `PRJ` when the name has no usable letters at all, because a
/// project called `"日本語"` still needs an id and failing to create it would be
/// absurd.
pub fn suggest_key_prefix(name: &str) -> String {
    let initials: String = name
        .split_whitespace()
        .filter_map(|word| word.chars().find(|c| c.is_ascii_alphabetic()))
        .take(3)
        .collect::<String>()
        .to_uppercase();

    if initials.chars().count() >= KEY_PREFIX_MIN {
        return initials;
    }

    let letters: String = name
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .take(3)
        .collect::<String>()
        .to_uppercase();

    if letters.chars().count() >= KEY_PREFIX_MIN {
        letters
    } else {
        "PRJ".to_owned()
    }
}

/// A priority level, or a message naming the range.
pub fn priority(value: i64) -> AppResult<i64> {
    if (0..=PRIORITY_MAX).contains(&value) {
        return Ok(value);
    }
    Err(AppError::validation(
        "priority",
        format!("Priority has to be between 0 and {PRIORITY_MAX}."),
    ))
}

/// A due date as a calendar date, `YYYY-MM-DD`.
///
/// Deliberately not an instant. A task due "on the 14th" is due on the 14th
/// wherever the user happens to be, and storing a moment in time would make it
/// shift across a timezone change and land on the wrong day around a
/// daylight-saving boundary. See `docs/product-spec.md` §8.
pub fn due_date(value: Option<&str>) -> AppResult<Option<String>> {
    let Some(raw) = value else { return Ok(None) };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let parts: Vec<&str> = trimmed.split('-').collect();
    let valid = matches!(parts.as_slice(), [y, m, d]
        if y.len() == 4 && m.len() == 2 && d.len() == 2
            && parts.iter().all(|part| part.chars().all(|c| c.is_ascii_digit())));

    if !valid {
        return Err(AppError::validation(
            "dueDate",
            "A due date has to look like 2026-07-30.",
        ));
    }

    let month: u32 = parts[1].parse().unwrap_or(0);
    let day: u32 = parts[2].parse().unwrap_or(0);
    let year: i32 = parts[0].parse().unwrap_or(0);

    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return Err(AppError::validation(
            "dueDate",
            format!("There is no such date as {trimmed}."),
        ));
    }

    Ok(Some(trimmed.to_owned()))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// An estimate in minutes. Zero is not an estimate; it is an empty field typed
/// as a number, so it is refused rather than stored.
pub fn estimate_minutes(value: Option<i64>) -> AppResult<Option<i64>> {
    match value {
        None => Ok(None),
        Some(minutes) if minutes < 1 => Err(AppError::validation(
            "estimateMinutes",
            "An estimate has to be at least a minute. Leave it empty for no estimate.",
        )),
        Some(minutes) if minutes > ESTIMATE_MINUTES_MAX => Err(AppError::validation(
            "estimateMinutes",
            "That estimate is longer than two weeks — record it as a description instead.",
        )),
        Some(minutes) => Ok(Some(minutes)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_text_trims_before_measuring() {
        assert_eq!(
            required_text("name", "  Takenkanban  ", PROJECT_NAME_MAX).expect("valid"),
            "Takenkanban",
        );
    }

    #[test]
    fn whitespace_only_is_empty() {
        let error = required_text("name", "   \t\n ", PROJECT_NAME_MAX).expect_err("invalid");

        match error {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn length_is_counted_in_characters_not_bytes() {
        // Each of these is 3 bytes but 1 character. A byte-based limit would
        // reject a name a third of the permitted length.
        let name = "あ".repeat(PROJECT_NAME_MAX);

        assert!(required_text("name", &name, PROJECT_NAME_MAX).is_ok());
        assert!(
            required_text("name", &"あ".repeat(PROJECT_NAME_MAX + 1), PROJECT_NAME_MAX).is_err()
        );
    }

    #[test]
    fn the_length_message_says_how_long_it_actually_is() {
        let error = required_text("name", &"x".repeat(120), PROJECT_NAME_MAX).expect_err("invalid");

        match error {
            AppError::Validation { message, .. } => {
                assert!(message.contains("100"), "should state the limit: {message}");
                assert!(
                    message.contains("120"),
                    "should state the actual: {message}"
                );
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn optional_text_permits_empty_but_still_bounds_length() {
        assert_eq!(
            optional_text("d", "  ", PROJECT_DESCRIPTION_MAX).expect("valid"),
            ""
        );
        assert!(optional_text("d", &"x".repeat(2001), PROJECT_DESCRIPTION_MAX).is_err());
    }

    #[test]
    fn key_prefix_uppercases_rather_than_complaining() {
        assert_eq!(key_prefix("keyPrefix", " kan ").expect("valid"), "KAN");
    }

    #[test]
    fn key_prefix_rejects_digits_and_symbols() {
        for value in ["K4N", "KA-N", "KA N", ""] {
            assert!(
                key_prefix("keyPrefix", value).is_err(),
                "{value:?} should be rejected"
            );
        }
    }

    #[test]
    fn key_prefix_enforces_its_length_range() {
        assert!(key_prefix("k", "A").is_err());
        assert!(key_prefix("k", "AB").is_ok());
        assert!(key_prefix("k", "ABCDE").is_ok());
        assert!(key_prefix("k", "ABCDEF").is_err());
    }

    #[test]
    fn a_directory_must_be_absolute_but_need_not_exist() {
        assert_eq!(
            optional_directory("dir", Some("/nowhere/at/all")).expect("valid"),
            Some("/nowhere/at/all".to_owned()),
        );
        assert!(optional_directory("dir", Some("relative/path")).is_err());
        assert_eq!(optional_directory("dir", Some("  ")).expect("valid"), None);
        assert_eq!(optional_directory("dir", None).expect("valid"), None);
    }

    #[test]
    fn suggested_prefixes_come_from_initials() {
        assert_eq!(suggest_key_prefix("Taken Kanban"), "TK");
        assert_eq!(suggest_key_prefix("My Great Side Project"), "MGS");
        assert_eq!(suggest_key_prefix("Takenkanban"), "TAK");
    }

    #[test]
    fn a_name_with_no_latin_letters_still_gets_a_prefix() {
        assert_eq!(suggest_key_prefix("日本語"), "PRJ");
        assert_eq!(suggest_key_prefix(""), "PRJ");
    }

    #[test]
    fn every_suggested_prefix_is_itself_valid() {
        for name in ["Taken Kanban", "My Great Side Project", "日本語", "", "a"] {
            let suggested = suggest_key_prefix(name);
            assert!(
                key_prefix("keyPrefix", &suggested).is_ok(),
                "suggestion {suggested:?} for {name:?} must pass validation",
            );
        }
    }
}
