import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The shared shape of a dropdown menu's surface and items.
 *
 * Not a design-system layer over Radix — Radix stays visible at every call site
 * and its `Root`/`Trigger`/`Portal` are used directly. This is only the two
 * pieces that were being written out identically in three menus, where the
 * third copy had already drifted to a different z-index.
 */
export function MenuContent({
  children,
  align = "end",
  side = "bottom",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  /** Opens upward for a trigger that sits at the bottom of the window. */
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <DropdownMenu.Content
      align={align}
      side={side}
      sideOffset={4}
      style={{ zIndex: "var(--z-dropdown)" }}
      className={cn(
        "bg-surface-raised border-border-default min-w-44 rounded-md border p-1 shadow-(--shadow-overlay)",
        className,
      )}
    >
      {children}
    </DropdownMenu.Content>
  );
}

/**
 * The look of one row in a menu.
 *
 * The highlight carries the same ring as every other focused control, drawn
 * inset so it hugs the row. The background alone was not enough: measured, a
 * sunken row against the menu surface is 1.1:1 in the light theme, which is a
 * state change one can fail to see. It follows the pointer as well as the
 * keyboard, because `data-highlighted` is Radix's single notion of "the row the
 * menu is on" and splitting it would mean two ideas of what is focused.
 */
const ITEM = cn(
  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none",
  // `outline-solid` is not redundant beside `outline-2`: `outline-none` above
  // sets Tailwind's `--tw-outline-style` to `none` unconditionally, so a width
  // on its own produced a 2 px outline with no style and nothing was drawn.
  "data-highlighted:outline-focus-ring data-highlighted:-outline-offset-2",
  "data-highlighted:outline-2 data-highlighted:outline-solid",
  "data-disabled:pointer-events-none data-disabled:text-fg-muted data-disabled:outline-none",
);

const ORDINARY = "text-fg-primary data-highlighted:bg-surface-sunken";

export function MenuItem({
  children,
  onSelect,
  destructive = false,
  disabled = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(ITEM, destructive ? "text-danger-fg data-highlighted:bg-danger-bg" : ORDINARY)}
    >
      {children}
    </DropdownMenu.Item>
  );
}

/**
 * A menu row that toggles rather than closes.
 *
 * Separate from `MenuItem` because Radix's `CheckboxItem` is a different
 * primitive with its own role and `aria-checked`; the only thing the two share
 * is how a row looks, which is the part that was being copied.
 */
export function MenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
}: {
  children: ReactNode;
  checked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => {
        // Kept open: choosing several values in one facet is the normal case,
        // and reopening the menu between each would be tedious.
        event.preventDefault();
      }}
      className={cn(ITEM, ORDINARY)}
    >
      {children}
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="bg-border-subtle my-1 h-px" />;
}
