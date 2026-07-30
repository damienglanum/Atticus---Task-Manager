import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { Task } from "@/lib/bindings/Task";
import { messageFor } from "@/lib/errors";

import { useArchivedTasks } from "./queries";

interface ArchivePanelProps {
  boardId: string;
  projectPrefix: string;
  onOpenChange: (open: boolean) => void;
  onRestore: (task: Task) => void;
  pending: boolean;
}

/**
 * The archive, and the way back out of it.
 *
 * This panel is why archiving is offered at all: an archive with no route back
 * is a delete that lies about what it did. Loaded on demand rather than with the
 * board, because most sessions never open it.
 */
export function ArchivePanel({
  boardId,
  projectPrefix,
  onOpenChange,
  onRestore,
  pending,
}: ArchivePanelProps) {
  const archived = useArchivedTasks(boardId, true);

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Archived tasks"
      description="Restoring a task puts it back at the end of the column it was archived from."
    >
      {archived.isPending ? (
        <p role="status" className="text-fg-secondary text-xs">
          Loading the archive…
        </p>
      ) : archived.isError ? (
        <p className="text-danger-fg text-xs">{messageFor(archived.error)}</p>
      ) : archived.data.length === 0 ? (
        <p className="text-fg-secondary text-xs">
          Nothing is archived on this board. Archiving takes a task off the board without deleting
          it.
        </p>
      ) : (
        <ul className="divide-border-subtle divide-y">
          {archived.data.map((task) => (
            <li key={task.id} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-fg-primary text-xs break-words">{task.title}</p>
                <p className="text-fg-secondary mt-0.5 font-mono text-2xs" data-numeric>
                  {projectPrefix}-{task.number}
                </p>
              </div>

              <Button
                disabled={pending}
                onClick={() => {
                  onRestore(task);
                }}
              >
                <Undo2 size={13} aria-hidden />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
