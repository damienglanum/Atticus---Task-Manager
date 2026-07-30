import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";
import type { Column } from "@/lib/bindings/Column";
import { columnNameSchema, wipLimitSchema } from "@/lib/schemas";

interface ColumnSettingsDialogProps {
  /**
   * `null` means "create a new column" rather than "edit this one".
   *
   * The dialog is mounted only while it is open, with a `key` that changes with
   * the column, so its fields start from the right values without an effect
   * that resets them — see the call site in `BoardView`.
   */
  column: Column | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
  onSave: (id: string, name: string, wipLimit: number | null) => void;
  pending: boolean;
}

export function ColumnSettingsDialog({
  column,
  onOpenChange,
  onCreate,
  onSave,
  pending,
}: ColumnSettingsDialogProps) {
  const [name, setName] = useState(column?.name ?? "");
  const [limit, setLimit] = useState(column?.wipLimit == null ? "" : String(column.wipLimit));
  const [errors, setErrors] = useState<{ name?: string | undefined; limit?: string | undefined }>(
    {},
  );

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();

    const parsedName = columnNameSchema.safeParse(name);
    const parsedLimit = wipLimitSchema.safeParse(limit);

    if (!parsedName.success || !parsedLimit.success) {
      setErrors({
        name: parsedName.success ? undefined : parsedName.error.issues[0]?.message,
        limit: parsedLimit.success ? undefined : parsedLimit.error.issues[0]?.message,
      });
      return;
    }

    if (column === null) onCreate(parsedName.data);
    else onSave(column.id, parsedName.data, parsedLimit.data);
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={column === null ? "New column" : "Column settings"}
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" form="column-form" type="submit" disabled={pending}>
            {pending ? "Saving…" : column === null ? "Add column" : "Save changes"}
          </Button>
        </>
      }
    >
      <form id="column-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <TextField
          label="Name"
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
          }}
          {...(errors.name === undefined ? {} : { error: errors.name })}
        />

        {column === null ? null : (
          <TextField
            label="Work-in-progress limit"
            value={limit}
            inputMode="numeric"
            hint="Leave empty for no limit. Going over warns; it never blocks a move."
            onChange={(event) => {
              setLimit(event.target.value);
            }}
            {...(errors.limit === undefined ? {} : { error: errors.limit })}
          />
        )}
      </form>
    </Dialog>
  );
}
