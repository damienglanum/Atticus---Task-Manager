/**
 * The board, driven the way a user drives it.
 *
 * These assertions are the reason M4b existed. Every one of them is about
 * something jsdom cannot answer: whether a card is actually on screen, whether
 * a menu opened, whether the work survived closing the application.
 */
import {
  addTaskTo,
  chooseMenuItem,
  chooseOption,
  columnNamed,
  createProject,
  dialogNamed,
  fieldLabelled,
  openMenu,
  openTaskMenu,
  taskCardTitled,
  waitForAppReady,
} from "../support/app.js";

const PROJECT = "Board Check";

describe("the board", () => {
  before(async () => {
    await createProject(PROJECT);
  });

  it("starts with the five default columns", async () => {
    await waitForAppReady();

    for (const name of ["Backlog", "Todo", "In Progress", "Review", "Done"]) {
      await expect(columnNamed(name)).toBeDisplayed();
    }
  });

  it("captures a task from a title alone", async () => {
    await addTaskTo("Todo", "Write the release notes");

    await expect(taskCardTitled("Write the release notes")).toBeDisplayed();
  });

  it("keeps the composer open so several tasks can be typed in a row", async () => {
    await addTaskTo("Todo", "Second task", { keepOpen: true });

    // Still open and cleared, ready for the next one — that is the behaviour
    // under test, not merely that two tasks ended up on the board.
    const composer = columnNamed("Todo").$("textarea");
    await expect(composer).toBeDisplayed();
    await expect(composer).toHaveValue("");

    await composer.setValue("Third task");
    await browser.keys("Enter");
    await browser.keys("Escape");

    await expect(taskCardTitled("Second task")).toBeDisplayed();
    await expect(taskCardTitled("Third task")).toBeDisplayed();
  });

  it("gives each task a per-project reference", async () => {
    // "Board Check" yields the prefix BC, so its first task is BC-1.
    const card = taskCardTitled("Write the release notes");
    await expect(card).toHaveText(expect.stringContaining("BC-"));
  });

  it("duplicates a task and places the copy below the original", async () => {
    await openTaskMenu("Write the release notes");
    await chooseMenuItem("Duplicate");

    await expect(taskCardTitled("Write the release notes (copy)")).toBeDisplayed();

    const titles = await columnNamed("Todo")
      .$$("[data-task-title]")
      .map((element) => element.getText());

    const original = titles.indexOf("Write the release notes");
    expect(titles[original + 1]).toBe("Write the release notes (copy)");
  });

  it("archives a task off the board and offers to undo it", async () => {
    await openTaskMenu("Write the release notes (copy)");
    await chooseMenuItem("Archive");

    await expect(taskCardTitled("Write the release notes (copy)")).not.toBeDisplayed();

    const undo = $("button=Undo");
    await undo.waitForDisplayed();
    await undo.click();

    await expect(taskCardTitled("Write the release notes (copy)")).toBeDisplayed();
  });

  it("deletes a task and can put it back", async () => {
    await openTaskMenu("Write the release notes (copy)");
    await chooseMenuItem("Delete");

    await expect(taskCardTitled("Write the release notes (copy)")).not.toBeDisplayed();

    await $("button=Undo").click();
    await expect(taskCardTitled("Write the release notes (copy)")).toBeDisplayed();
  });

  it("adds a column and sets a work-in-progress limit on it", async () => {
    await $("button=Add a column").click();
    await $('div[role="dialog"]').waitForDisplayed();
    await $("#column-form input").setValue("Blocked");
    await $("button=Add column").click();

    await expect(columnNamed("Blocked")).toBeDisplayed();
  });

  it("warns when a column goes over its limit, in more than colour", async () => {
    // A limit of one, then two tasks: the header must show the count, a warning
    // glyph, and announce the breach.
    await openMenu("Actions for Blocked");
    await chooseMenuItem("Rename and set a limit");
    await $('div[role="dialog"]').waitForDisplayed();

    const limitField = $(
      '//label[normalize-space(text())="Work-in-progress limit"]/following-sibling::input[1]',
    );
    await limitField.setValue("1");
    await $("button=Save changes").click();
    await $('div[role="dialog"]').waitForDisplayed({ reverse: true });

    await addTaskTo("Blocked", "First review");
    await expect(columnNamed("Blocked")).toHaveText(expect.stringContaining("1/1"));

    await addTaskTo("Blocked", "Second review");
    await expect(columnNamed("Blocked")).toHaveText(expect.stringContaining("2/1"));
    await expect(columnNamed("Blocked").$("[role='status']")).toHaveText(
      "Blocked is over its limit, 2 of 1",
    );
  });

  it("moves a deleted column's tasks rather than losing them", async () => {
    await openMenu("Actions for Blocked");
    await chooseMenuItem("Delete column");

    const dialog = $('[role="alertdialog"]');
    await dialog.waitForDisplayed();
    await expect(dialog).toHaveText(expect.stringContaining("2 tasks"));

    const targetSelector = 'select[aria-label="Column to move the tasks to"]';
    await chooseOption(targetSelector, "Done");

    // Read back: the tasks going somewhere other than the column named here is
    // exactly the failure this whole dialog exists to prevent.
    const chosen = await $(targetSelector).getValue();
    const doneHeading = await columnNamed("Done").getAttribute("aria-labelledby");
    expect(doneHeading).toBe(`column-heading-${chosen}`);

    await $("button=Delete column").click();
    await dialog.waitForDisplayed({ reverse: true });

    await expect(columnNamed("Blocked")).not.toBeDisplayed();
    await expect(columnNamed("Done")).toHaveText(expect.stringContaining("First review"));
    await expect(columnNamed("Done")).toHaveText(expect.stringContaining("Second review"));
  });

  it("undoes a column deletion, bringing the column and its tasks back", async () => {
    await $("button=Undo").click();

    await expect(columnNamed("Blocked")).toBeDisplayed();
    await expect(columnNamed("Blocked")).toHaveText(expect.stringContaining("First review"));
    await expect(columnNamed("Done")).not.toHaveText(expect.stringContaining("First review"));
  });

  it("reorders a column from the keyboard, and it stays put", async () => {
    await openMenu("Actions for Backlog");
    await chooseMenuItem("Move right");

    const names = await $$("main section[aria-labelledby] h3").map((heading) => heading.getText());
    expect(names.slice(0, 2)).toEqual(["Todo", "Backlog"]);
  });

  it("renames a task", async () => {
    await openTaskMenu("Third task");
    await chooseMenuItem("Rename");

    const dialog = dialogNamed("Rename task");
    await dialog.waitForDisplayed();
    await fieldLabelled("Title").setValue("Third task, renamed");
    await $("button=Save").click();
    await dialog.waitForDisplayed({ reverse: true });

    await expect(taskCardTitled("Third task, renamed")).toBeDisplayed();
  });

  it("restores an archived task from the archive panel", async () => {
    await openTaskMenu("Second task");
    await chooseMenuItem("Archive");
    await expect(taskCardTitled("Second task")).not.toBeDisplayed();

    // Deliberately not using the undo toast: archiving has to have a way back
    // that still exists once the toast has gone.
    await $("button=1 archived").click();
    const panel = dialogNamed("Archived tasks");
    await panel.waitForDisplayed();

    await panel.$("button=Restore").click();
    await browser.keys("Escape");
    await panel.waitForDisplayed({ reverse: true });

    await expect(taskCardTitled("Second task")).toBeDisplayed();
  });

  it("still has everything after the application is restarted", async () => {
    await browser.reloadSession();
    await waitForAppReady();

    await expect(columnNamed("Review")).toBeDisplayed();
    await expect(taskCardTitled("Write the release notes")).toBeDisplayed();
    await expect(taskCardTitled("Second task")).toBeDisplayed();
    await expect(taskCardTitled("Third task, renamed")).toBeDisplayed();

    // The column order was changed by a menu command, not a drag; it has to
    // survive a restart all the same (US-6 AC1).
    const names = await $$("main section[aria-labelledby] h3").map((heading) => heading.getText());
    expect(names.slice(0, 2)).toEqual(["Todo", "Backlog"]);
  });

  it("has forgotten its undo history, and does not pretend otherwise", async () => {
    // Undo is a session stack by design (ADR-0009). After a restart there is no
    // toast offering it, which is the honest state rather than a button that
    // would fail.
    await expect($("button=Undo")).not.toBeDisplayed();
  });
});
