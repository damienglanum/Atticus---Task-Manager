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
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownMenu.Content
      align={align}
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
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none",
        "data-disabled:pointer-events-none",
        destructive
          ? "text-danger-fg data-highlighted:bg-danger-bg data-disabled:text-fg-tertiary"
          : "text-fg-primary data-highlighted:bg-surface-sunken data-disabled:text-fg-tertiary",
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="bg-border-subtle my-1 h-px" />;
}
