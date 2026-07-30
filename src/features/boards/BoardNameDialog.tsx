import { useState, type SubmitEventHandler } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";
import { describeAppError, toAppError } from "@/lib/errors";
import { boardFormSchema, fieldErrors } from "@/lib/schemas";

interface BoardNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent means "create". */
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
  pending: boolean;
}

/** Mounted only while open, so state seeds at mount instead of via an effect. */
export function BoardNameDialog({
  open,
  onOpenChange,
  initialName,
  onSubmit,
  pending,
}: BoardNameDialogProps) {
  const editing = initialName !== undefined;
  const [name, setName] = useState(initialName ?? "");
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setFormError(null);

    const parsed = boardFormSchema.safeParse({ name });
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).name);
      return;
    }

    void onSubmit(parsed.data.name).catch((caught: unknown) => {
      const appError = toAppError(caught);
      if (appError.kind === "validation") setError(appError.message);
      else setFormError(describeAppError(appError));
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Rename board" : "New board"}
      description={
        editing ? undefined : "New boards start with the same five columns as the first one."
      }
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" form="board-form" type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Rename" : "Create board"}
          </Button>
        </>
      }
    >
      <form id="board-form" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Board name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          error={error}
          maxLength={200}
        />
        {formError !== null ? (
          <p role="alert" className="text-danger-fg mt-2 text-xs">
            {formError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
