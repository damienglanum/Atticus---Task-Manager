import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";

interface SaveFilterDialogProps {
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
  pending: boolean;
}

/** Names the filter currently applied, so it can be brought back later (US-21). */
export function SaveFilterDialog({ onOpenChange, onSave, pending }: SaveFilterDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Save this filter"
      description="Saved filters belong to the project, so they are available on every board in it."
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" form="save-filter-form" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save filter"}
          </Button>
        </>
      }
    >
      <form
        id="save-filter-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed === "") {
            setError("Give the filter a name so you can find it again.");
            return;
          }
          onSave(trimmed);
        }}
      >
        <TextField
          label="Name"
          value={name}
          maxLength={60}
          onChange={(event) => {
            setName(event.target.value);
          }}
          {...(error === undefined ? {} : { error })}
        />
      </form>
    </Dialog>
  );
}
