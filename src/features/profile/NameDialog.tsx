import { useState, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";
import { LIMITS } from "@/lib/schemas";

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  pending: boolean;
  onSubmit: (name: string) => void;
}

/** Changing the name given at first run. */
export function NameDialog({
  open,
  onOpenChange,
  initialName,
  pending,
  onSubmit,
}: NameDialogProps) {
  const [name, setName] = useState(initialName);
  const ready = name.trim() !== "";

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (ready && !pending) onSubmit(name);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Your name"
      description="Used to greet you on the dashboard. It stays on this computer."
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!ready || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <TextField
          label="Full name"
          type="text"
          value={name}
          autoComplete="name"
          maxLength={LIMITS.profileName}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </form>
    </Dialog>
  );
}
