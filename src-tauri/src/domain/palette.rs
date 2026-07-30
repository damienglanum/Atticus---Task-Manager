//! The fixed colour palette for projects and labels.
//!
//! Colours are stored as **token names**, never hex literals. The database says
//! `indigo`; what indigo looks like is a design decision that lives in
//! `src/styles/tokens.css` and differs between light and dark themes. Storing a
//! hex value would freeze one theme's appearance into the user's data.

/// Names accepted for a project or label colour. Ten is enough to tell projects
/// apart at a glance and few enough that every one can be checked for contrast.
pub const COLORS: [&str; 10] = [
    "slate", "indigo", "blue", "cyan", "teal", "grass", "amber", "orange", "red", "plum",
];

pub fn is_valid(color: &str) -> bool {
    COLORS.contains(&color)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_every_palette_entry() {
        for color in COLORS {
            assert!(is_valid(color), "{color} should be accepted");
        }
    }

    #[test]
    fn rejects_anything_outside_the_palette() {
        for color in ["#ff0000", "INDIGO", "rebeccapurple", "", " indigo"] {
            assert!(!is_valid(color), "{color:?} should be rejected");
        }
    }
}
