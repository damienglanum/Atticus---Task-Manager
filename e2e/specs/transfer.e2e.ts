/**
 * Export and import against the real binary.
 *
 * The system file dialogs cannot be driven — they are native windows outside
 * the WebDriver session, the same gap `docs/testing.md` records for the file
 * picker. So the dialogs are stepped over by calling the commands with a path
 * directly, through the same IPC the buttons use. What that still proves is the
 * part worth proving: that a real database exports to a real file on disk, and
 * that the file imports back into a running application and reaches the board.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addTaskTo,
  columnNamed,
  createProject,
  taskCardTitled,
  waitForAppReady,
} from "../support/app.js";

/**
 * Every sidebar entry with this name.
 *
 * The same XPath `projectInSidebar` uses, because the name sits in a nested
 * `span` and the nav also holds the new-project and per-project menu buttons —
 * a plain `button` selector counts those too.
 */
function projectsNamed(name: string) {
  return $$(`//nav[@aria-label="Projects"]//button[.//span[normalize-space(text())="${name}"]]`);
}

/**
 * Invokes a command from inside the page.
 *
 * Through `window.__TAURI_INTERNALS__`, which is what `@tauri-apps/api` itself
 * calls. Importing the package here is not an option: `browser.execute` ships a
 * raw function to the page rather than a bundled module, so a bare specifier
 * like `@tauri-apps/api/core` has nothing to resolve against.
 *
 * This reaches past the application's own `ipc` module, which ADR-0002 keeps as
 * the only caller of `invoke`. That is a deliberate exception for the test
 * layer and nowhere else — the rule exists so no *page script* can reach the
 * backend, and the spec is not a page script.
 */
async function command<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const outcome = await browser.execute(
    async (commandName: string, commandArgs: Record<string, unknown>) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: (command: string, payload: Record<string, unknown>) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;

      if (internals === undefined) return { ok: false, value: "__TAURI_INTERNALS__ is absent" };

      try {
        return { ok: true, value: await internals.invoke(commandName, commandArgs) };
      } catch (error) {
        return { ok: false, value: error instanceof Error ? error.message : error };
      }
    },
    name,
    args,
  );

  if (!outcome.ok) throw new Error(`${name} failed: ${JSON.stringify(outcome.value)}`);
  return outcome.value as T;
}

const WORKSPACE = mkdtempSync(join(tmpdir(), "atticus-transfer-"));
const EXPORT_FILE = join(WORKSPACE, "export.json");

describe("export and import", () => {
  before(async () => {
    await createProject("Transferable");
    await addTaskTo("Backlog", "Survives a round trip");
  });

  it("writes an export file the user can actually read", async () => {
    await waitForAppReady();

    await command<string>("export_data", { scope: { kind: "everything" }, path: EXPORT_FILE });

    expect(existsSync(EXPORT_FILE)).toBe(true);

    // Parsed rather than pattern-matched: the promise in product-spec §7.1 is a
    // file someone can open in five years, so the test opens it.
    const document = JSON.parse(readFileSync(EXPORT_FILE, "utf8")) as {
      exportVersion: number;
      app: string;
      data: { projects: { name: string }[]; tasks: { title: string }[] };
    };

    expect(document.exportVersion).toBe(1);
    expect(document.app).toBe("atticus");
    expect(document.data.projects.map((project) => project.name)).toContain("Transferable");
    expect(document.data.tasks.map((task) => task.title)).toContain("Survives a round trip");
  });

  it("previews an import without writing anything", async () => {
    const plan = await command<{ projects: number; tasks: number }>("import_preview", {
      path: EXPORT_FILE,
    });

    expect(plan.projects).toBeGreaterThanOrEqual(1);
    expect(plan.tasks).toBeGreaterThanOrEqual(1);

    // Still one project on screen: a preview is a read.
    expect(await projectsNamed("Transferable").length).toBe(1);
  });

  it("refuses a file that is not an export, and says nothing was written", async () => {
    const rubbish = join(WORKSPACE, "not-an-export.json");
    writeFileSync(rubbish, '{"hello":"world"}');

    await expect(command("import_preview", { path: rubbish })).rejects.toThrow(/exportVersion/);
  });

  it("merges the file back in, and the copy reaches the board", async () => {
    const result = await command<{ mode: string }>("import_apply", {
      path: EXPORT_FILE,
      mode: "merge",
    });
    expect(result.mode).toBe("merge");

    // Asked of the backend before the interface, so a failure says whether the
    // write happened or only whether the sidebar noticed.
    const stored = await command<{ name: string }[]>("projects_list", {
      includeArchived: true,
    });
    expect(stored.filter((project) => project.name === "Transferable")).toHaveLength(2);

    // A merge never overwrites, so there are now two projects of that name —
    // which is ADR-0006's stated behaviour, not an accident.
    //
    // The command was invoked directly rather than through the panel, so the
    // application's own cache invalidation never ran and the page is still
    // showing what it read at startup. Reloading the document is what makes the
    // assertion below about the database rather than about a stale cache.
    await browser.execute(() => {
      window.location.reload();
    });
    await waitForAppReady();

    const afterRestart = await command<{ name: string; archivedAt: number | null }[]>(
      "projects_list",
      { includeArchived: true },
    );

    await browser.waitUntil(async () => (await projectsNamed("Transferable").length) >= 2, {
      timeoutMsg: `the merged copy never appeared in the sidebar. Backend after restart: ${JSON.stringify(
        afterRestart,
      )}`,
    });
  });

  it("gives the imported copy its own boards, columns and tasks", async () => {
    // Asserted through the read model rather than by navigating to the copy.
    // Every spec file shares one database, so by the time this runs the sidebar
    // holds projects from seven other files and "the second Transferable" is
    // not a stable thing to click. What matters is that the copy is a complete,
    // independent project — which `board_load` is the honest way to ask.
    const copies = await command<{ id: string; name: string }[]>("projects_list", {
      includeArchived: false,
    });
    const imported = copies.filter((project) => project.name === "Transferable").at(-1);
    expect(imported).toBeDefined();

    const boards = await command<{ id: string }[]>("boards_list", {
      projectId: imported?.id ?? "",
    });
    expect(boards).toHaveLength(1);

    const snapshot = await command<{
      columns: { name: string }[];
      tasks: { title: string }[];
    }>("board_load", { boardId: boards[0]?.id ?? "" });

    expect(snapshot.columns.map((column) => column.name)).toContain("Backlog");
    expect(snapshot.tasks.map((task) => task.title)).toContain("Survives a round trip");
  });

  it("still shows a usable board after an import", async () => {
    // The interface half: whatever the shell restored after the reload is a
    // real board with real columns, rather than an empty or broken state.
    await waitForAppReady();

    await expect(columnNamed("Backlog")).toBeDisplayed();
    await expect(taskCardTitled("Survives a round trip")).toBeDisplayed();
  });

  it("lists the backup that the replace-import took", async () => {
    await command("import_apply", { path: EXPORT_FILE, mode: "replace" });

    const backups = await command<{ label: string }[]>("backups_list", {});

    expect(backups.map((backup) => backup.label)).toContain("pre-import");
  });
});
