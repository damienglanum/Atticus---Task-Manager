/**
 * Locates the Rust toolchain.
 *
 * Homebrew's `rustup` formula is keg-only, so `cargo` is frequently absent from
 * `PATH` even on a machine where Rust is perfectly well installed. Depending on
 * the developer's shell profile to fix that makes `npm run verify` pass or fail
 * based on which terminal tab you happen to be in, which is not a build system.
 *
 * This resolves the toolchain from the environment first and from the known
 * install locations second, and says something useful when it genuinely is not
 * installed.
 */
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

const EXECUTABLE = platform() === "win32" ? "cargo.exe" : "cargo";

/** Directories to try, in order of preference. */
function candidateDirectories() {
  const directories = [];

  // Whatever is already on PATH wins: an explicitly chosen toolchain should not
  // be silently overridden by one of the fallbacks below.
  for (const entry of (process.env["PATH"] ?? "").split(delimiter)) {
    if (entry) directories.push(entry);
  }

  if (process.env["CARGO_HOME"]) directories.push(join(process.env["CARGO_HOME"], "bin"));

  directories.push(
    join(homedir(), ".cargo", "bin"),
    // Homebrew keg-only rustup — Apple Silicon, then Intel.
    "/opt/homebrew/opt/rustup/bin",
    "/usr/local/opt/rustup/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
  );

  return directories;
}

/** The directory containing `cargo`, or `null` if it cannot be found. */
export function findCargoDirectory() {
  for (const directory of candidateDirectories()) {
    if (existsSync(join(directory, EXECUTABLE))) return directory;
  }
  return null;
}

/** A `PATH` guaranteed to contain `cargo`. Throws with instructions if it cannot. */
export function pathWithCargo() {
  const directory = findCargoDirectory();

  if (directory === null) {
    throw new Error(
      [
        "Could not find `cargo`. Rust is required to build the Tauri backend.",
        "",
        "Install it with:",
        "  brew install rustup && rustup toolchain install stable",
        "or from https://rustup.rs",
        "",
        "If Rust is already installed, its bin directory is not in PATH and is not",
        "one of the locations checked. Set CARGO_HOME, or add it to PATH.",
      ].join("\n"),
    );
  }

  const current = process.env["PATH"] ?? "";
  return current.split(delimiter).includes(directory)
    ? current
    : `${directory}${delimiter}${current}`;
}
