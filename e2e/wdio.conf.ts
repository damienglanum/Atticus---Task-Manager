/**
 * End-to-end configuration. Drives the real packaged-style binary through the
 * WebDriver server embedded in it — the only way to automate a Tauri window on
 * macOS, which ships no WKWebView driver. See `docs/adr/0008-e2e-webdriverio-on-macos.md`.
 *
 * The binary under test is built by `scripts/e2e.mjs`, not by this file.
 */
import type { Options } from "@wdio/types";
import type { TauriCapabilities } from "@wdio/tauri-service";

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pinWindow } from "./support/app.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Matches the `[profile.e2e]` output path in `src-tauri/Cargo.toml`. */
export const APP_BINARY = join(root, "src-tauri", "target", "e2e", "e2e", "takenkanban");

/** Screenshots of failing tests, and the visual review. Not committed. */
export const ARTIFACT_DIR = join(root, "e2e", "artifacts");

/**
 * Every run gets an empty database in a throwaway directory, which the spawned
 * application inherits through the environment. `specs/isolation.e2e.ts`
 * confirms it landed there before any other spec is allowed to write anything.
 *
 * This module is loaded twice — once by the launcher, once inside each worker
 * process — so creating the directory unconditionally would give the specs a
 * different path from the one the application was actually started with, and
 * every assertion about isolation would be checking an empty directory that
 * nothing had ever written to. Workers inherit the launcher's environment, so
 * an inherited value always wins.
 */
export const RUN_DATA_DIR =
  process.env.TAKENKANBAN_DATA_DIR ?? mkdtempSync(join(tmpdir(), "takenkanban-e2e-"));
process.env.TAKENKANBAN_DATA_DIR = RUN_DATA_DIR;

/**
 * `tauri:options` is not part of the base `WebdriverIO.Capabilities`; the
 * service declares it as `TauriCapabilities`, so the capability list is typed
 * with that rather than cast.
 */
export const config: Omit<Options.Testrunner, "capabilities"> & {
  capabilities: TauriCapabilities[];
} = {
  runner: "local",
  rootDir: root,

  // Isolation runs first and aborts the whole run if the app is not pointed at
  // the throwaway directory. Ordering here is a safety property, not a style.
  specs: ["./e2e/specs/isolation.e2e.ts", "./e2e/specs/*.e2e.ts"],

  // One window at a time. These specs restart the application and assert on
  // what it persisted, which is only meaningful in sequence.
  maxInstances: 1,

  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: APP_BINARY },
    },
  ],

  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: APP_BINARY,
        // macOS has no external driver; the server is compiled into the binary
        // under the `e2e-webdriver` Cargo feature.
        driverProvider: "embedded",
        // Surfaces Rust `eprintln!` output — including the startup path that
        // reports a database that would not open — in the test log.
        captureBackendLogs: true,
        captureFrontendLogs: true,
      },
    ],
  ],

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    // A cold start compiles nothing but does open a window and run migrations.
    timeout: 180_000,
  },

  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 10_000,
  bail: 1,

  /**
   * Removes the run's database when the run passed.
   *
   * A failed run keeps it and says where, because the database is usually the
   * evidence — "the project was not there after restart" is answered by opening
   * the file, not by reading the stack trace.
   */
  onComplete: function (exitCode) {
    if (exitCode === 0) {
      rmSync(RUN_DATA_DIR, { recursive: true, force: true });
    } else {
      console.log(`\nThe database from this run was kept at:\n  ${RUN_DATA_DIR}\n`);
    }
  },

  /**
   * Re-asserts window selection before each test. See `pinWindow` — without it
   * every element lookup pays a five-second timeout, and a `reloadSession()`
   * inside a spec quietly resets the state it depends on.
   */
  beforeTest: async function () {
    await pinWindow();
  },

  /**
   * Photographs the window whenever a test fails.
   *
   * An end-to-end failure is usually a layout or state problem, and the stack
   * trace says nothing about either. The screenshot is the first thing worth
   * looking at, so it is captured automatically rather than by re-running by
   * hand and hoping the failure repeats.
   */
  afterTest: async function (test, _context, { passed }) {
    if (passed) return;

    await mkdir(ARTIFACT_DIR, { recursive: true });
    const name = `${test.parent} ${test.title}`.replace(/[^\w]+/g, "-").toLowerCase();
    await browser.saveScreenshot(join(ARTIFACT_DIR, `${name}.png`));
  },
};
