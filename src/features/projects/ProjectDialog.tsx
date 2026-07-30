import { useState, type SubmitEventHandler } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextAreaField, TextField } from "@/components/ui/Field";
import type { Project } from "@/lib/bindings/Project";
import { describeAppError, toAppError } from "@/lib/errors";
import {
  fieldErrors,
  projectFormSchema,
  type ProjectColor,
  type ProjectFormValues,
} from "@/lib/schemas";
import { ColorPicker } from "./ProjectColor";

const EMPTY: ProjectFormValues = {
  name: "",
  description: "",
  color: "indigo",
  keyPrefix: "",
  directoryPath: "",
};

function initialValues(project: Project | undefined): ProjectFormValues {
  if (project === undefined) return EMPTY;
  return {
    name: project.name,
    description: project.description,
    color: project.color as ProjectColor,
    keyPrefix: project.keyPrefix,
    directoryPath: project.directoryPath ?? "",
  };
}

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent means "create". */
  project?: Project;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
  pending: boolean;
}

/**
 * Create or edit a project.
 *
 * The caller mounts this only while it is open, so the form state is seeded
 * from props at mount rather than reset by an effect — an effect that writes
 * state during render is a cascading-render hazard, and the mount already
 * gives us the reset for free.
 *
 * Validation runs on submit, not on every keystroke: telling someone a field is
 * empty while they are still walking towards it is noise. Backend validation
 * errors land on the same field as client-side ones, so a rule the frontend
 * missed still points at the right input.
 */
export function ProjectDialog({
  open,
  onOpenChange,
  project,
  onSubmit,
  pending,
}: ProjectDialogProps) {
  const editing = project !== undefined;
  const [values, setValues] = useState<ProjectFormValues>(() => initialValues(project));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const update = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _cleared, ...rest } = current;
      return rest;
    });
  };

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setFormError(null);

    const parsed = projectFormSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    void onSubmit(parsed.data).catch((error: unknown) => {
      const appError = toAppError(error);
      if (appError.kind === "validation") {
        setErrors({ [appError.field]: appError.message });
      } else {
        setFormError(describeAppError(appError));
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Project settings" : "New project"}
      description={
        editing
          ? undefined
          : "A board with five columns is created alongside it. You can rename or remove any of them."
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
          <Button variant="primary" form="project-form" type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create project"}
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <TextField
          label="Name"
          value={values.name}
          onChange={(event) => {
            update("name", event.target.value);
          }}
          error={errors.name}
          maxLength={200}
        />

        <TextAreaField
          label="Description"
          rows={2}
          value={values.description}
          onChange={(event) => {
            update("description", event.target.value);
          }}
          error={errors.description}
        />

        <ColorPicker
          value={values.color}
          onChange={(color) => {
            update("color", color);
          }}
        />

        <TextField
          label="Task ID prefix"
          value={values.keyPrefix}
          onChange={(event) => {
            update("keyPrefix", event.target.value);
          }}
          error={errors.keyPrefix}
          hint={
            editing
              ? "Used for task IDs like KAN-14. Existing task numbers keep their place."
              : "Used for task IDs like KAN-14. Left blank, it's derived from the name."
          }
          maxLength={10}
          className="w-28 uppercase"
        />

        <TextField
          label="Project directory"
          value={values.directoryPath}
          onChange={(event) => {
            update("directoryPath", event.target.value);
          }}
          error={errors.directoryPath}
          hint="Optional. A full path to where this project lives on disk."
          placeholder="/Users/you/code/project"
          className="font-mono text-xs"
        />

        {formError !== null ? (
          <p role="alert" className="text-danger-fg text-xs">
            {formError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
