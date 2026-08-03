// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().any(|argument| argument == "--mcp") {
        if let Err(error) = atticus_lib::mcp::run_stdio() {
            eprintln!("atticus-mcp: {error}");
            std::process::exit(1);
        }
    } else {
        atticus_lib::run()
    }
}
