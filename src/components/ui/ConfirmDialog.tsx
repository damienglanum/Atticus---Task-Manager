import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Rich body: destructive confirmations state real counts, not a vague warning. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  destructive?: boolean;
}

/**
 * A confirmation for an action that loses data.
 *
 * Uses Radix `AlertDialog`, which — unlike a plain dialog — refuses to close on
 * an outside click, so a confirmation cannot be dismissed by a stray click.
 * Initial focus goes to **Cancel**, per the W3C APG guidance to focus the least
 * destructive control.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  confirmDisabled = false,
  destructive = true,
}: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="fixed inset-0 bg-black/40"
          style={{ zIndex: "var(--z-overlay)" }}
        />
        <AlertDialogPrimitive.Content
          style={{ zIndex: "var(--z-dialog)" }}
          className={cn(
            "bg-surface-raised border-border-default fixed top-1/2 left-1/2 w-[min(30rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2 rounded-lg border shadow-(--shadow-overlay)",
            "max-h-[calc(100vh-4rem)] overflow-y-auto p-5",
          )}
        >
          <AlertDialogPrimitive.Title className="text-lg font-semibold">
            {title}
          </AlertDialogPrimitive.Title>

          <div className="text-fg-secondary mt-3 space-y-3 text-xs">{children}</div>

          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel
              className={cn(
                "bg-surface-card text-fg-primary border-border-default hover:border-border-strong",
                "inline-flex h-8 cursor-default items-center rounded-md border px-3 text-xs font-medium",
              )}
            >
              {cancelLabel}
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              disabled={confirmDisabled}
              onClick={onConfirm}
              className={cn(
                "inline-flex h-8 cursor-default items-center rounded-md border border-transparent px-3 text-xs font-medium text-white",
                destructive ? "bg-danger-solid" : "bg-accent-solid",
                "hover:opacity-90 disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {confirmLabel}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
