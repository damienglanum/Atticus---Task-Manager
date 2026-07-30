/**
 * The task editor, driven against the real window.
 *
 * The parts that only a real run can settle: that autosave actually persists
 * without a save button, that a description survives closing the dialog and
 * restarting the application, and that the card reflects what the editor did.
 */
import {
  addTaskTo,
  chooseMenuItem,
  createProject,
  dialogNamed,
  openTaskMenu,
  taskCardTitled,
  waitForAppReady,
} from "../support/app.js";

/** Opens a task the way a user does: by clicking its card. */
async function openEditor(title: string) {
  const card = $(`//button[@data-task-card][.//p[normalize-space(text())="${title}"]]`);
  await card.waitForDisplayed();
  await card.click();

  const dialog = $('div[role="dialog"]');
  await dialog.waitForDisplayed();
  return dialog;
}

describe("the task editor", () => {
  before(async () => {
    await createProject("Detail");
    await addTaskTo("Todo", "Write the release notes");
  });

  it("opens by clicking the card, and shows the task's short ID", async () => {
    const dialog = await openEditor("Write the release notes");
    await expect(dialog).toHaveText(expect.stringContaining("DET-1"));
    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });
  });

  it("returns focus to the card it opened from", async () => {
    // The W3C APG modal requirement. Radix restores focus itself, but only
    // while its dialog is still mounted — and this one unmounts the moment the
    // editor closes, which was dropping focus onto `<body>`.
    //
    // Only focus is asserted here. That Enter on a focused card opens it is
    // covered by a component test; asserting it again through a synthesised
    // keypress made this spec depend on key-delivery timing and it failed only
    // when the suite ran long.
    const dialog = await openEditor("Write the release notes");
    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });

    await browser.waitUntil(
      async () =>
        await browser.execute(
          () => document.activeElement?.hasAttribute("data-task-card") === true,
        ),
      { timeoutMsg: "closing the editor left focus somewhere other than the card" },
    );
  });

  it("still offers Open in the actions menu", async () => {
    await openTaskMenu("Write the release notes");
    await chooseMenuItem("Open");

    const dialog = $('div[role="dialog"]');
    await dialog.waitForDisplayed();
    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });
  });

  it("saves a description with no save button, and it survives a restart", async () => {
    const dialog = await openEditor("Write the release notes");

    await expect($("button=Save")).not.toBeDisplayed();

    const description = $('textarea[aria-label="Edit description"]');
    await description.waitForDisplayed();
    await description.setValue("Something **important** about the release.");

    // Closing immediately, with the debounce still pending: the flush on close
    // is the part that would otherwise lose the writing (US-10 AC2).
    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });

    // Confirmed before the restart, so a failure says whether the write never
    // happened or merely did not survive.
    const check = await openEditor("Write the release notes");
    await expect(check).toHaveText(expect.stringContaining("about the release"));
    await browser.keys("Escape");
    await check.waitForDisplayed({ reverse: true });

    await browser.reloadSession();
    await waitForAppReady();

    const reopened = await openEditor("Write the release notes");
    await expect(reopened).toHaveText(expect.stringContaining("about the release"));
    // Rendered as markdown, not shown as literal asterisks.
    await expect(reopened.$("strong")).toHaveText("important");

    await browser.keys("Escape");
    await reopened.waitForDisplayed({ reverse: true });
  });

  it("sets a priority and shows it on the card, in words", async () => {
    const dialog = await openEditor("Write the release notes");
    await dialog.$('//span[normalize-space(text())="High"]').click();
    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });

    await expect(taskCardTitled("Write the release notes")).toHaveText(
      expect.stringContaining("High"),
    );
  });

  it("counts subtasks on the card without completing the task itself", async () => {
    const dialog = await openEditor("Write the release notes");

    for (const title of ["Draft", "Review", "Publish"]) {
      const field = dialog.$('input[aria-label="New subtask"]');
      await field.setValue(title);
      await browser.keys("Enter");
    }

    // Tick them all: the parent must not move or close (US-13 AC3).
    const boxes = dialog.$$('input[type="checkbox"]');
    for await (const box of boxes) {
      await box.click();
    }

    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });

    await expect(taskCardTitled("Write the release notes")).toHaveText(
      expect.stringContaining("3/3"),
    );
    // Still exactly where it was, and still on the board.
    await expect(taskCardTitled("Write the release notes")).toBeDisplayed();
  });

  it("adds a label and shows it on the card by name", async () => {
    const dialog = await openEditor("Write the release notes");

    await dialog.$("button=New label").click();
    await dialog.$('input[aria-label="New label name"]').setValue("Blocked");
    await dialog.$("button=Add label").click();

    // Newly created labels are not attached automatically — tick it.
    const checkbox = dialog.$('//label[.//span[normalize-space(text())="Blocked"]]//input');
    await checkbox.waitForDisplayed();
    await checkbox.click();

    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });

    await expect(taskCardTitled("Write the release notes")).toHaveText(
      expect.stringContaining("Blocked"),
    );
  });

  it("shows a due date state in words on the card", async () => {
    const dialog = await openEditor("Write the release notes");

    // Yesterday, so the state is unambiguous whenever this runs.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await dialog.$("#task-due").setValue(yesterday);

    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });

    await expect(taskCardTitled("Write the release notes")).toHaveText(
      expect.stringContaining("Overdue"),
    );
  });

  it("keeps everything after a restart", async () => {
    await browser.reloadSession();
    await waitForAppReady();

    const card = taskCardTitled("Write the release notes");
    await expect(card).toHaveText(expect.stringContaining("High"));
    await expect(card).toHaveText(expect.stringContaining("3/3"));
    await expect(card).toHaveText(expect.stringContaining("Blocked"));
    await expect(card).toHaveText(expect.stringContaining("Overdue"));
  });

  it("copies the task's short ID", async () => {
    const dialog = await openEditor("Write the release notes");
    await dialog.$('button[aria-label="Copy DET-1"]').click();

    await expect(dialog.$("//span[normalize-space(text())='Copied']")).toBeDisplayed();

    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });
  });

  it("carries the detail into a duplicate", async () => {
    await openTaskMenu("Write the release notes");
    await chooseMenuItem("Duplicate");

    const copy = taskCardTitled("Write the release notes (copy)");
    await expect(copy).toBeDisplayed();
    await expect(copy).toHaveText(expect.stringContaining("High"));
    await expect(copy).toHaveText(expect.stringContaining("3/3"));
    // A new short ID, not the original's.
    await expect(copy).not.toHaveText(expect.stringContaining("DET-1 "));
  });

  it("uses the rename dialog for the title as well", async () => {
    await openTaskMenu("Write the release notes (copy)");
    await chooseMenuItem("Rename");

    const dialog = dialogNamed("Rename task");
    await dialog.waitForDisplayed();
    await browser.keys("Escape");
    await dialog.waitForDisplayed({ reverse: true });
  });
});
