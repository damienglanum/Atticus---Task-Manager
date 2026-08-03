import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { IconButton } from "./Button";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  // `| undefined` is required under `exactOptionalPropertyTypes`: callers pass a
  // conditional expression, and "absent" and "explicitly undefined" are the same
  // thing for a prop that simply is not rendered.
  description?: string | undefined;
  /** Lets a larger, information-dense view opt into a wider dialog. */
  contentClassName?: string | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
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
  contentClassName,
  children,
  footer,
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
            "w-[min(32rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2 rounded-xl border shadow-(--shadow-overlay)",
            "max-h-[calc(100vh-4rem)] overflow-y-auto p-5",
            contentClassName,
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
            className="text-fg-secondary hover:text-fg-primary hover:bg-surface-sunken absolute top-4 right-4 inline-flex size-7 cursor-default items-center justify-center rounded-md"
          >
            <X size={14} aria-hidden />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface DialogPageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sits above the title, in small caps: where in the app this page is. */
  breadcrumb?: ReactNode;
  title: string;
  /** Names the back control, so it says what it goes back *to*. */
  backLabel: string;
  /** Trailing controls in the header bar. */
  actions?: ReactNode | undefined;
  children: ReactNode;
}

/**
 * A dialog that takes the whole window rather than floating in the middle of it.
 *
 * Still a Radix dialog, and deliberately so. The task editor reads as a page —
 * it has its own header, a two-column body, and enough in it to scroll — but it
 * is modal in every way that matters: Escape closes it, focus is trapped inside
 * it, focus returns to the card that opened it, and the board behind it is
 * `aria-hidden`. Rebuilding it as a route would have meant reimplementing all
 * four, and getting one of them wrong is not visible until someone tries it
 * from the keyboard.
 *
 * The back control is **last in the DOM and first in the layout**. Radix focuses
 * the first focusable descendant on open, and a page that opens with focus on
 * "back" is a page you have to tab into before you can edit anything. Same
 * reasoning, and same tradeoff, as the close button in `Dialog` above.
 */
export function DialogPage({
  open,
  onOpenChange,
  breadcrumb,
  title,
  backLabel,
  actions,
  children,
}: DialogPageProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/40"
          style={{ zIndex: "var(--z-overlay)" }}
        />
        <DialogPrimitive.Content
          style={{ zIndex: "var(--z-dialog)" }}
          className="bg-surface-app fixed inset-0 flex flex-col"
        >
          <header className="border-border-subtle flex shrink-0 items-center gap-4 border-b px-5 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="order-2 min-w-0">
                {breadcrumb}
                <DialogPrimitive.Title className="truncate text-xl font-semibold">
                  {title}
                </DialogPrimitive.Title>
              </div>

              <DialogPrimitive.Close asChild>
                <IconButton label={backLabel} className="order-1 size-8 shrink-0">
                  <ArrowLeft size={16} aria-hidden />
                </IconButton>
              </DialogPrimitive.Close>
            </div>

            {actions === undefined ? null : (
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
