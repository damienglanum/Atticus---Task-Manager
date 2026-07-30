/**
 * Fails if the committed TypeScript bindings differ from what Rust currently
 * generates. Without this, renaming a Rust field type-checks cleanly on both
 * sides and only surfaces as `undefined` at runtime. See ADR-0010.
 *
 * Deliberately git-independent: it regenerates into a temp directory and
 * compares, so it works in a fresh checkout, in CI, and before the first commit.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pathWithCargo } from "./rust-toolchain.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const committed = join(root, "src", "lib", "bindings");
const scratch = mkdtempSync(join(tmpdir(), "takenkanban-bindings-"));

function readDirectory(dir) {
  const files = new Map();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.set(entry.name, readFileSync(join(dir, entry.name), "utf8"));
    }
  }
  return files;
}

try {
  execFileSync("cargo", ["test", "--quiet"], {
    cwd: join(root, "src-tauri"),
    env: { ...process.env, PATH: pathWithCargo(), TS_RS_EXPORT_DIR: scratch },
    stdio: ["ignore", "ignore", "inherit"],
  });

  const expected = readDirectory(scratch);
  const actual = readDirectory(committed);
  const problems = [];

  for (const [name, content] of expected) {
    if (!actual.has(name)) problems.push(`missing binding: ${name}`);
    else if (actual.get(name) !== content) problems.push(`out of date: ${name}`);
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) problems.push(`stale binding, no longer generated: ${name}`);
  }

  if (expected.size === 0) {
    problems.push("Rust generated no bindings at all — is the ts-rs export wired up?");
  }

  // ts-rs maps Rust's 64-bit integers to `bigint`, but serde_json writes them as
  // JSON numbers and Tauri's IPC hands the frontend a plain `number`. A `bigint`
  // in a binding is therefore always a lie about runtime. Annotate the field
  // `#[ts(type = "number")]` rather than casting on the TypeScript side.
  for (const [name, content] of expected) {
    if (/\bbigint\b/.test(content)) {
      problems.push(
        `${name} declares \`bigint\`, but Tauri IPC delivers \`number\` — annotate the Rust field \`#[ts(type = "number")]\``,
      );
    }
  }

  if (problems.length > 0) {
    console.error("TypeScript bindings are out of sync with the Rust types:\n");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("\nRun `npm run rust:test` to regenerate, then commit src/lib/bindings.");
    process.exit(1);
  }

  console.log(`Bindings are in sync (${String(expected.size)} files).`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
