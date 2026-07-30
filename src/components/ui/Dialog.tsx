import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  // `| undefined` is required under `exactOptionalPropertyTypes`: callers pass a
  // conditional expression, and "absent" and "explicitly undefined" are the same
  // thing for a prop that simply is not rendered.
  description?: string | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  /** Wider, for a two-column body such as the task editor. */
  wide?: boolean;
}

/**
 * A modal dialog.
 *
 * Radix supplies focus trapping, focus restoration on close, Escape handling,
 * and `aria-modal` — the W3C APG modal-dialog pattern, implemented once and
 * correctly.
 *
 * The close button is rendered **last** in the DOM and positioned absolutely.
 * That is deliberate: Radix focuses the first focusable descendant on open, so
 * with the close button first, every form dialog would open with focus on
 * "Close" and the user would have to tab into the form. Ordering it last means
 * focus lands on the first field — the APG's "focus the most frequently used
 * element" guidance — without an `autoFocus` prop anywhere.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/40"
          style={{ zIndex: "var(--z-overlay)" }}
        />
        <DialogPrimitive.Content
          style={{ zIndex: "var(--z-dialog)" }}
          className={cn(
            "bg-surface-raised border-border-default fixed top-1/2 left-1/2",
            wide ? "w-[min(56rem,calc(100vw-2rem))]" : "w-[min(32rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2 rounded-lg border shadow-(--shadow-overlay)",
            "max-h-[calc(100vh-4rem)] overflow-y-auto p-5",
          )}
        >
          <div className="mb-4 pr-8">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            {description !== undefined ? (
              <DialogPrimitive.Description className="text-fg-secondary mt-1 text-xs">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>

          {children}

          {footer !== undefined ? (
            <div className="mt-5 flex justify-end gap-2">{footer}</div>
          ) : null}

          <DialogPrimitive.Close
            aria-label="Close"
            className="text-fg-secondary hover:text-fg-primary hover:bg-surface-sunken absolute top-4 right-4 inline-flex size-6 cursor-default items-center justify-center rounded-md"
          >
            <X size={14} aria-hidden />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
