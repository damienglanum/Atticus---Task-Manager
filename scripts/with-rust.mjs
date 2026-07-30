#!/usr/bin/env node
/**
 * Runs a command with the Rust toolchain guaranteed to be on `PATH`.
 *
 *   node scripts/with-rust.mjs [--cwd <dir>] <command> [args...]
 *
 * Used for every script that shells out to `cargo`, directly or indirectly —
 * including `tauri`, which spawns `cargo metadata` itself and fails with a bare
 * "No such file or directory" when it cannot find it.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pathWithCargo } from "./rust-toolchain.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const argv = process.argv.slice(2);

let cwd = root;
if (argv[0] === "--cwd") {
  const target = argv[1];
  if (target === undefined) {
    console.error("with-rust: --cwd needs a directory");
    process.exit(2);
  }
  cwd = resolve(root, target);
  argv.splice(0, 2);
}

const [command, ...args] = argv;
if (command === undefined) {
  console.error("with-rust: no command given");
  process.exit(2);
}

let PATH;
try {
  PATH = pathWithCargo();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const child = spawn(command, args, {
  cwd,
  stdio: "inherit",
  env: { ...process.env, PATH },
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`with-rust: could not run \`${command}\`: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
