/**
 * Selectors and small interactions shared across specs.
 *
 * Everything here is addressed the way a user or a screen reader addresses it —
 * by accessible name or visible label — so a passing test is evidence the
 * control is reachable, not merely present in the DOM.
 */

let pinnedSession: string | null = null;

/**
 * Tells the service, once per session, that we have chosen our window.
 *
 * Before every `findElement`, `elementClick` and `getTitle`, the service checks
 * which window is focused by invoking `plugin:wdio|get_window_states` through
 * `window.__TAURI__`. This application exposes neither — `withGlobalTauri` is
 * off by design (ADR-0002: `invoke` reaches the webview through one module, not
 * a global that any script on the page can call) and `tauri-plugin-wdio` is not
 * installed. The probe therefore waits five seconds and gives up, on every
 * single command, which cost roughly ninety seconds per spec file before this.
 *
 * Marking the window as explicitly selected is the service's own condition for
 * skipping that probe. An application with one window loses nothing by saying
 * so.
 *
 * The service keys the suppression on the session id, so a `reloadSession()`
 * silently un-does it. Comparing against the current session id rather than
 * holding a boolean means a restart re-pins on its own, and `beforeTest` in
 * `wdio.conf.ts` calls this so no spec has to remember.
 */
export async function pinWindow(): Promise<void> {
  if (pinnedSession === browser.sessionId) return;
  pinnedSession = browser.sessionId;
  await browser.tauri.switchWindow("main");
}

/**
 * A dialog addressed by its accessible name.
 *
 * Not `div[role="dialog"]`: more than one dialog exists in this application,
 * and a bare role selector silently matches whichever one happens to be open —
 * which is how a passing "the project dialog closed" assertion once turned out
 * to be waiting on the settings dialog left over from an earlier spec.
 */
export function dialogNamed(title: string) {
  return $(`//div[@role="dialog"][.//*[normalize-space(text())="${title}"]]`);
}

/** Waits for the shell to have finished its first load. */
export async function waitForAppReady(): Promise<void> {
  await pinWindow();
  await $('//button[normalize-space(.)="Settings"]').waitForDisplayed({ timeout: 20_000 });
}

/**
 * Sizes the window so the *CSS viewport* is `cssWidth` wide, and proves it.
 *
 * `setWindowRect` on this driver is in **physical** pixels, while layout — and
 * therefore every media query, every `min-w-` and the whole responsive design —
 * is in CSS pixels. On a 2× display those differ by exactly a factor of two,
 * measured across six widths from 900 to 3840 and linear throughout.
 *
 * Every width this suite claimed to inspect was therefore half of what it said:
 * the "900 px narrow window" laid out at 450 px, well under the 900 px minimum
 * product-spec §6 supports, and the overflow it reported was the interface
 * being asked to do something it never promised. Milestone 8 requires 900 /
 * 1280 / 1920 *inspected*, so the widths have to be the real ones.
 *
 * The window may exceed the display — 3840 physical on a 1920 physical screen
 * yields a true 1920 px viewport — so all three are reachable here.
 *
 * The measurement is asserted rather than assumed: a resize is asynchronous,
 * and reading the layout before it lands measures the previous width.
 */
export async function setViewportWidth(cssWidth: number, cssHeight: number): Promise<void> {
  const ratio = await browser.execute(() => window.devicePixelRatio);
  await browser.setWindowRect(null, null, cssWidth * ratio, cssHeight * ratio);

  await browser.waitUntil(
    async () => (await browser.execute(() => document.documentElement.clientWidth)) === cssWidth,
    {
      timeoutMsg: `the viewport never reached ${String(cssWidth)} CSS px (device pixel ratio ${String(ratio)})`,
    },
  );
}

export async function openSettings(): Promise<void> {
  await waitForAppReady();

  const dialog = dialogNamed("Settings");
  if (!(await dialog.isExisting())) {
    await $('//button[normalize-space(.)="Settings"]').click();
    await dialog.waitForDisplayed();
  }
}

/** Closes a dialog with the keyboard, which is also an assertion that Escape works. */
export async function closeDialogNamed(title: string): Promise<void> {
  await browser.keys("Escape");
  await dialogNamed(title).waitForDisplayed({ reverse: true });
}

/**
 * Reads one row out of the diagnostics list by its visible label.
 *
 * Addressed through the `dt`/`dd` relationship rather than a test id: that
 * relationship is what makes the list a description list to assistive
 * technology, so asserting through it also asserts the markup is right.
 */
export async function readDiagnostic(label: string): Promise<string> {
  const value = $(`//dt[normalize-space(text())="${label}"]/following-sibling::dd[1]`);
  await value.waitForDisplayed();

  // WebKit's rendered-text extraction reports soft line breaks, so a value
  // styled `break-all` comes back with newlines wherever it happened to wrap.
  // Collapsing runs of whitespace gives the logical text back. Note this cannot
  // reconstruct a path that legitimately contains spaces — assert on paths from
  // the filesystem, not from here. See `specs/isolation.e2e.ts`.
  return (await value.getText()).replace(/\s+/g, " ").trim();
}

export async function createProject(name: string): Promise<void> {
  await waitForAppReady();

  const firstProjectButton = $("button=Create your first project");
  if (await firstProjectButton.isExisting()) {
    await firstProjectButton.click();
  } else {
    await $('button[aria-label="New project"]').click();
  }

  const dialog = dialogNamed("New project");
  await dialog.waitForDisplayed();

  await fieldLabelled("Name").setValue(name);
  await $("button=Create project").click();
  await dialog.waitForDisplayed({ reverse: true });
}

/**
 * Finds a form control by the text of the `<label>` bound to it.
 *
 * Ids come from React's `useId()` and are deliberately not addressed directly:
 * they are generated, and a test that depended on their shape would break for
 * reasons that have nothing to do with the product. Going through `for`/`id` is
 * also the association a screen reader uses, so a passing test means the field
 * is correctly labelled.
 */
export function fieldLabelled(label: string) {
  return $(
    `//label[normalize-space(text())="${label}"]/following-sibling::*[self::input or self::textarea][1]`,
  );
}

export function projectInSidebar(name: string) {
  return $(`//nav[@aria-label="Workspace"]//button[@aria-label="${name}"]`);
}

export function columnNamed(name: string) {
  return $(`//section[.//h3[normalize-space(text())="${name}"]]`);
}

export function taskCardTitled(title: string) {
  return $(`//li[.//p[normalize-space(text())="${title}"]]`);
}

/**
 * Types a task into a column's quick composer.
 *
 * `keepOpen` leaves the composer focused so a spec can assert that Enter is
 * ready for the next task rather than having closed the box.
 */
export async function addTaskTo(
  columnName: string,
  title: string,
  { keepOpen = false }: { keepOpen?: boolean } = {},
): Promise<void> {
  const column = columnNamed(columnName);
  await column.waitForDisplayed();

  const addButton = column.$(`button[aria-label="Add a task to ${columnName}"]`);
  await addButton.click();

  const composer = column.$("textarea");
  await composer.waitForDisplayed();
  await composer.setValue(title);
  await browser.keys("Enter");

  if (!keepOpen) {
    await browser.keys("Escape");
  }
}

/**
 * Opens a Radix dropdown by its trigger's accessible name.
 *
 * Focus-then-Enter rather than click: a synthesised WebDriver click focuses the
 * trigger but does not open the menu, and driving it the way a keyboard user
 * does also makes every menu assertion an accessibility assertion.
 */
export async function openMenu(triggerLabel: string): Promise<void> {
  await openMenuAt(`button[aria-label="${triggerLabel}"]`);
}

/**
 * Opens a Radix dropdown whose trigger is found by any selector.
 *
 * A click alone sometimes opens the menu and sometimes only focuses the trigger,
 * depending on how the driver synthesises the gesture — so Enter is sent only
 * when the click did not open it. Sending it unconditionally toggled the menu
 * shut again, which showed up as an item that existed and then did not.
 */
export async function openMenuAt(selector: string): Promise<void> {
  const trigger = $(selector);
  await trigger.waitForDisplayed();
  await trigger.click();

  const menu = $('[role="menu"]');
  const openedByClick = await menu.isDisplayed().catch(() => false);
  if (!openedByClick) {
    await browser.keys("Enter");
  }

  await menu.waitForDisplayed();
}

export async function openTaskMenu(title: string): Promise<void> {
  await openMenu(`Actions for ${title}`);
}

/** Chooses a menu item by its exact visible label. */
export async function chooseMenuItem(label: string): Promise<void> {
  const item = $(`//*[@role="menuitem"][normalize-space(.)="${label}"]`);
  await item.waitForDisplayed();
  await item.click();
  await $('[role="menu"]').waitForDisplayed({ reverse: true });
}

/**
 * Picks an option in a native `<select>`.
 *
 * WebdriverIO's `selectByVisibleText` does not change the value under the
 * embedded WKWebView driver — verified by reading the value back, which stayed
 * on the default. This sets it through the native property setter and then
 * dispatches a bubbling `change`, which is the event a real selection produces
 * and the one React listens for.
 *
 * The selector is re-queried inside the page rather than passed as an element
 * reference: this driver delivers such references as empty objects, so the
 * function body would receive something with no `options` on it.
 *
 * A driver workaround, and only that: the control under test is an ordinary
 * `<select>` and is untouched by it.
 */
export async function chooseOption(selector: string, visibleText: string): Promise<void> {
  await $(selector).waitForDisplayed();

  await browser.execute(
    (cssSelector: string, text: string) => {
      const element = document.querySelector<HTMLSelectElement>(cssSelector);
      if (!element) throw new Error(`no select matching ${cssSelector}`);

      const option = Array.from(element.options).find(
        (candidate) => candidate.textContent.trim() === text,
      );
      if (!option) throw new Error(`no option labelled "${text}"`);

      // Reflect.set reaches the same native setter without lifting an unbound
      // method out of the property descriptor.
      Reflect.set(HTMLSelectElement.prototype, "value", option.value, element);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    visibleText,
  );
}

/** The titles of a column's cards, top to bottom. */
export async function titlesIn(columnName: string): Promise<string[]> {
  await columnNamed(columnName).waitForDisplayed();
  return columnNamed(columnName)
    .$$("[data-task-title]")
    .map((element) => element.getText());
}
