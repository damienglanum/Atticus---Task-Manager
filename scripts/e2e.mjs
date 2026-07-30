/**
 * Builds the binary the end-to-end suite drives, then runs the suite.
 *
 * The build is a separate step from `npm run build` and a separate target
 * directory from every other cargo invocation, because `tauri dev` and
 * `cargo build` write to `target/debug/atticus` and would otherwise
 * overwrite the WebDriver-enabled binary between building it and running it —
 * which they did, silently, the first time this was set up.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pathWithCargo } from "./rust-toolchain.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const binary = join(root, "src-tauri", "target", "e2e", "e2e", "atticus");
const passThrough = process.argv.slice(2);

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PATH: pathWithCargo() },
    ...options,
  });
}

// The e2e binary embeds `dist/` rather than loading the dev server, so a stale
// frontend build would be tested instead of the current source.
run("npm", ["run", "build"]);

run(
  "cargo",
  ["build", "--profile", "e2e", "--features", "e2e-webdriver", "--target-dir", "target/e2e"],
  { cwd: join(root, "src-tauri") },
);

if (!existsSync(binary)) {
  console.error(`The end-to-end build did not produce ${binary}.`);
  process.exit(1);
}

run("npx", ["wdio", "run", "e2e/wdio.conf.ts", ...passThrough]);
