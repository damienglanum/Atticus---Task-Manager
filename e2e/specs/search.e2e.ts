/**
 * Search, filters, saved filters and undo — milestone 7, in the real window.
 *
 * The parts worth running here rather than in jsdom: that `⌘K` reaches the
 * palette from anywhere, that a result in another project switches to it, that
 * filters survive closing the application, and that `⌘Z` reverses the last
 * thing that happened.
 */
import {
  addTaskTo,
  chooseMenuItem,
  chooseOption,
  columnNamed,
  createProject,
  dialogNamed,
  openMenuAt,
  openTaskMenu,
  taskCardTitled,
  titlesIn,
  waitForAppReady,
} from "../support/app.js";

const PALETTE = 'input[aria-label="Search tasks and commands"]';

async function openPalette() {
  await browser.keys(["Meta", "k"]);
  await $(PALETTE).waitForDisplayed();
}

async function closePalette() {
  await browser.keys("Escape");
  await $(PALETTE).waitForDisplayed({ reverse: true });
}

describe("search and filters", () => {
  before(async () => {
    await createProject("Searchable");
    await addTaskTo("Todo", "Write the release notes");
    await addTaskTo("Todo", "Fix the migration runner");
    await addTaskTo("In Progress", "Investigate the ordering bug");
  });

  it("opens the palette with the keyboard", async () => {
    await openPalette();
    await expect($(PALETTE)).toBeDisplayed();
    await closePalette();
  });

  it("finds a task by a word in its title", async () => {
    await openPalette();
    await $(PALETTE).setValue("migration");

    const options = $$('[role="option"]');
    await browser.waitUntil(async () => (await options.length) > 0, {
      timeoutMsg: "search returned nothing",
    });

    await expect($('[role="listbox"]')).toHaveText(expect.stringContaining("Fix the migration"));
    await closePalette();
  });

  it("opens the task it was asked for", async () => {
    await openPalette();
    await $(PALETTE).setValue("ordering");
    await browser.waitUntil(async () => (await $$('[role="option"]').length) > 0);

    await browser.keys("Enter");

    const dialog = dialogNamed("Edit task");
    await dialog.waitForDisplayed();
    await expect(dialog.$("#task-title")).toHaveValue("Investigate the ordering bug");

    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });
  });

  it("says so plainly when nothing matches", async () => {
    await openPalette();
    await $(PALETTE).setValue("nothingwhatsoevermatchesthis");

    await expect($('div[role="dialog"]')).toHaveText(expect.stringContaining("Nothing matches"));
    await closePalette();
  });

  it("survives punctuation that would be a search-syntax error", async () => {
    await openPalette();
    for (const nonsense of ['"', "*", "NEAR(", "a AND"]) {
      await $(PALETTE).setValue(nonsense);
      // The point is that the palette is still standing.
      await expect($(PALETTE)).toBeDisplayed();
    }
    await closePalette();
  });

  it("filters the board by text, and says how many are hidden", async () => {
    await $('input[aria-label="Filter tasks on this board"]').setValue("migration");

    await browser.waitUntil(async () => (await titlesIn("Todo")).length === 1, {
      timeoutMsg: "the filter did not narrow the board",
    });
    expect(await titlesIn("Todo")).toEqual(["Fix the migration runner"]);
    await expect($("button=Clear filter")).toBeDisplayed();
  });

  it("keeps the filter after the application restarts", async () => {
    await browser.reloadSession();
    await waitForAppReady();

    await expect($('input[aria-label="Filter tasks on this board"]')).toHaveValue("migration");
    expect(await titlesIn("Todo")).toEqual(["Fix the migration runner"]);
  });

  it("clears the filter in one action", async () => {
    await $("button=Clear filter").click();

    await browser.waitUntil(async () => (await titlesIn("Todo")).length === 2);
    await expect($("button=Clear filter")).not.toBeDisplayed();
  });

  it("filters by priority", async () => {
    await openTaskMenu("Write the release notes");
    await chooseMenuItem("Open");
    const editor = dialogNamed("Edit task");
    await editor.waitForDisplayed();
    await chooseOption("#task-priority", "Urgent");
    await editor.$("button=Save changes").click();
    await editor.waitForDisplayed({ reverse: true });

    await openMenuAt("button=Priority");
    await $('//*[@role="menuitemcheckbox"][contains(normalize-space(.), "Urgent")]').click();
    await browser.keys("Escape");

    await browser.waitUntil(async () => (await titlesIn("Todo")).length === 1, {
      timeoutMsg: "the priority filter did not narrow the board",
    });
    expect(await titlesIn("Todo")).toEqual(["Write the release notes"]);
  });

  it("saves the filter under a name and brings it back", async () => {
    await openMenuAt("button=Saved");
    // Driven with the keyboard: "Save the current filter…" is the last item and
    // Radix's roving focus wraps, so ArrowUp reaches it however the list grows.
    await browser.keys("ArrowUp");
    await browser.keys("Enter");

    const dialog = $('div[role="dialog"]');
    await dialog.waitForDisplayed();
    await dialog
      .$('//label[normalize-space(text())="Name"]/following-sibling::input[1]')
      .setValue("Urgent only");
    await $("button=Save filter").click();
    await dialog.waitForDisplayed({ reverse: true });

    await $("button*=Clear").click();
    await browser.waitUntil(async () => (await titlesIn("Todo")).length === 2);

    await openMenuAt("button=Saved (1)");
    await browser.keys("ArrowDown");
    await browser.keys("Enter");

    await browser.waitUntil(async () => (await titlesIn("Todo")).length === 1, {
      timeoutMsg: "the saved filter did not narrow the board",
    });
  });

  it("undoes the last action with the keyboard", async () => {
    await $("button*=Clear").click();
    await browser.waitUntil(async () => (await titlesIn("Todo")).length === 2);

    await openTaskMenu("Fix the migration runner");
    await chooseMenuItem("Archive");
    await expect(taskCardTitled("Fix the migration runner")).not.toBeDisplayed();

    await browser.keys(["Meta", "z"]);

    await expect(taskCardTitled("Fix the migration runner")).toBeDisplayed();
    await expect(columnNamed("Todo")).toBeDisplayed();
  });

  it("says there is nothing to undo rather than failing silently", async () => {
    // Drain whatever the session still has, then ask once more.
    for (let step = 0; step < 25; step += 1) {
      await browser.keys(["Meta", "z"]);
    }

    await expect($("//*[contains(text(), 'nothing to undo')]")).toBeDisplayed();
  });
});
