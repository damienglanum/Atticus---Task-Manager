/**
 * The M4b smoke run: prove the harness can do the things later milestones will
 * depend on — launch, read, type, click, resize, and above all restart the
 * application and find the data still there.
 *
 * Deliberately thin on product assertions. Its job is to establish that a
 * failing end-to-end test in M5 or later means the product is broken, not the
 * harness.
 */
import {
  closeDialogNamed,
  createProject,
  dialogNamed,
  openSettings,
  projectDestination,
  projectDisclosure,
  projectInSidebar,
  setViewportWidth,
} from "../support/app.js";

const PROJECT_NAME = "Harness Check";

describe("smoke", () => {
  it("creates a project and lists it in the sidebar", async () => {
    await createProject(PROJECT_NAME);
    await expect(projectInSidebar(PROJECT_NAME)).toBeDisplayed();
  });

  it("keeps the project after the application is restarted", async () => {
    await browser.reloadSession();

    await expect(projectInSidebar(PROJECT_NAME)).toBeDisplayed();
  });

  it("selects the restored project rather than starting blank", async () => {
    // The workspace row records the last opened project, so a restart should
    // land on its expanded branch and mark its board destination as current.
    // This is US-5 exercised end to end through the new project hierarchy.
    await expect(projectDisclosure(PROJECT_NAME)).toHaveAttribute("aria-expanded", "true");
    await expect(projectDestination(PROJECT_NAME, "Board View")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("remains usable in a narrow window", async () => {
    await setViewportWidth(900, 700);
    await expect(projectInSidebar(PROJECT_NAME)).toBeDisplayed();

    await setViewportWidth(1280, 820);
    await expect(projectInSidebar(PROJECT_NAME)).toBeDisplayed();
  });

  it("opens the settings dialog and closes it with Escape", async () => {
    await openSettings();
    await expect(dialogNamed("Settings")).toBeDisplayed();

    await closeDialogNamed("Settings");
    await expect(dialogNamed("Settings")).not.toBeDisplayed();
  });
});
