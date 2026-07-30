import { create } from "zustand";

/**
 * Transient notifications.
 *
 * Zustand, not TanStack Query: a toast disappears on reload and nobody minds,
 * which is exactly the boundary set out in ADR-0011.
 */
export type ToastTone = "info" | "error";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** An offer to reverse what just happened. Runs, then dismisses the toast. */
  action?: ToastAction;
}

interface ToastStore {
  toasts: Toast[];
  push: (tone: ToastTone, message: string, action?: ToastAction) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (tone, message, action) => {
    const id = nextId++;
    set((state) => ({
      toasts: [...state.toasts, action ? { id, tone, message, action } : { id, tone, message }],
    }));
    return id;
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

/**
 * Errors are **not** auto-dismissed.
 *
 * A failure the user did not happen to be looking at is a failure they never
 * learn about, so an error stays until it is dismissed. Informational toasts
 * time out, because they are confirmations of something the user just did.
 */
export const TOAST_TIMEOUT_MS = 5000;

export function notify(message: string): void {
  const { push, dismiss } = useToastStore.getState();
  const id = push("info", message);
  setTimeout(() => {
    dismiss(id);
  }, TOAST_TIMEOUT_MS);
}

export function notifyError(message: string): void {
  useToastStore.getState().push("error", message);
}

/**
 * A confirmation that offers to take the action back.
 *
 * Given longer than a plain notification, because reading what happened and
 * deciding to reverse it takes longer than reading a confirmation. Undoing
 * dismisses the toast: the offer is spent.
 */
export const UNDO_TOAST_TIMEOUT_MS = 10_000;

export function notifyUndoable(message: string, undo: () => void): void {
  const { push, dismiss } = useToastStore.getState();
  const id = push("info", message, {
    label: "Undo",
    run: () => {
      undo();
      dismiss(id);
    },
  });
  setTimeout(() => {
    dismiss(id);
  }, UNDO_TOAST_TIMEOUT_MS);
}
