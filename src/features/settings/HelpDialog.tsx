import { Dialog } from "@/components/ui/Dialog";

interface Shortcut {
  action: string;
  keys: string;
}

interface Group {
  title: string;
  shortcuts: Shortcut[];
}

/**
 * What the header's help button opens.
 *
 * The shortcuts, and nothing else. There is no documentation site to link to and
 * no support address to write to, so a help button that offered either would be
 * pointing at nothing. Kept in step with `docs/shortcuts.md` by hand, which is
 * the honest description of the arrangement.
 */
const GROUPS: Group[] = [
  {
    title: "Anywhere",
    shortcuts: [
      { action: "Search tasks and run commands", keys: "⌘K" },
      { action: "Undo the last action", keys: "⌘Z" },
      { action: "Close a dialog, popover, or menu", keys: "Esc" },
    ],
  },
  {
    title: "On the board",
    shortcuts: [
      { action: "Move between task cards", keys: "Tab" },
      { action: "Open the focused task", keys: "Enter" },
      { action: "Pick a task up, then move it", keys: "Space, then arrow keys" },
      { action: "Drop it", keys: "Space" },
      { action: "Abandon the drag, leaving the task untouched", keys: "Esc" },
    ],
  },
  {
    title: "In the task editor",
    shortcuts: [
      { action: "Save your changes", keys: "⌘Enter" },
      { action: "Discard them and close", keys: "Esc" },
      { action: "Add another checklist item", keys: "Enter" },
    ],
  },
];

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Everything here also has a button or a menu item. Nothing is keyboard-only."
    >
      <div className="space-y-5">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase">
              {group.title}
            </h3>
            <dl className="mt-2 space-y-1.5">
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.action} className="flex items-baseline justify-between gap-4">
                  <dt className="text-fg-primary min-w-0 text-sm">{shortcut.action}</dt>
                  <dd className="shrink-0">
                    <kbd className="border-border-subtle text-fg-secondary rounded border px-1.5 py-0.5 font-sans text-2xs">
                      {shortcut.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
