import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";
import type { Task } from "@/lib/bindings/Task";
import { LIMITS, taskTitleSchema } from "@/lib/schemas";

interface RenameTaskDialogProps {
  task: Task;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, title: string) => void;
  pending: boolean;
}

/**
 * Fixes a title.
 *
 * Not the task editor — that arrives with descriptions, labels and dates in a
 * later milestone. A quick-captured title with a typo in it is worth being able
 * to correct now, and this is the whole of what it does.
 */
export function RenameTaskDialog({ task, onOpenChange, onSave, pending }: RenameTaskDialogProps) {
  const [title, setTitle] = useState(task.title);
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();

    const parsed = taskTitleSchema.safeParse(title);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }

    onSave(task.id, parsed.data);
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Rename task"
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" form="rename-task-form" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="rename-task-form" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Title"
          value={title}
          maxLength={LIMITS.taskTitle}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          {...(error === undefined ? {} : { error })}
        />
      </form>
    </Dialog>
  );
}
