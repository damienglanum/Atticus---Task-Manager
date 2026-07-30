/**
 * Runs before every other spec and aborts the run if the application under test
 * is not using the throwaway database this run created.
 *
 * The rest of the suite creates and deletes projects. If the environment
 * variable that redirects the data directory were ever not inherited by the
 * spawned process, those specs would do that to the database the user works in.
 * Asserting it here, before anything has been written, turns a data-loss bug
 * into a failed first test.
 *
 * The assertion is made against the filesystem rather than against the path the
 * app displays: reading it back through the UI depends on how WebKit reports
 * text that has soft-wrapped, and a path containing a space — `Application
 * Support`, on the very platform this runs on — cannot be reconstructed from
 * rendered text at all.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { RUN_DATA_DIR } from "../wdio.conf.js";
import { closeDialogNamed, openSettings, readDiagnostic, waitForAppReady } from "../support/app.js";

describe("data isolation", () => {
  it("created its database inside this run's throwaway directory", async () => {
    await waitForAppReady();

    expect(existsSync(join(RUN_DATA_DIR, "takenkanban.sqlite3"))).toBe(true);
  });

  it("reports a fully migrated schema", async () => {
    await openSettings();

    // Freshly created and migrated, so the applied version is the latest one.
    expect(await readDiagnostic("Schema version")).toMatch(/^(\d+) of \1$/);

    // The application instance outlives this spec file, so anything opened here
    // has to be closed here or it becomes another spec's mystery failure.
    await closeDialogNamed("Settings");
  });
});
