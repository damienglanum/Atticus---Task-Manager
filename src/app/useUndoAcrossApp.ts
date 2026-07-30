import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { notify, notifyError } from "@/app/toast";
import { messageFor } from "@/lib/errors";
import { ipc } from "@/lib/ipc";

/**
 * Undo, from anywhere — `⌘Z` and the command palette.
 *
 * Takes no argument: the stack lives in the backend, so there is nothing for the
 * caller to hold or to get wrong. Everything is invalidated afterwards rather
 * than a chosen subset, because an undo can restore a column, a task, a label or
 * a move, and working out which caches that touched from here would be a second
 * place to keep in step with `UndoToken`.
 */
export function useUndoAcrossApp(): () => void {
  const client = useQueryClient();

  return useCallback(() => {
    void ipc.undoLast().then(
      async (description) => {
        if (description === null) {
          notify("There is nothing to undo.");
          return;
        }
        await client.invalidateQueries();
        notify(`Undone: ${description}`);
      },
      (error: unknown) => {
        notifyError(messageFor(error));
      },
    );
  }, [client]);
}
