import * as LabelPrimitive from "@radix-ui/react-label";
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

const CONTROL = cn(
  "bg-surface-card border-border-strong text-fg-primary w-full rounded-md border px-2 py-1.5",
  "text-base placeholder:text-fg-secondary",
  "aria-invalid:border-danger-border",
);

interface FieldShellProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * Wires a label, a hint, and an error message to a control.
 *
 * The error is rendered in an `alert` live region and referenced by
 * `aria-describedby`, so it reaches a screen reader whether the user is on the
 * field or not — a red border alone communicates nothing.
 */
export function Field({ label, error, hint, children }: FieldShellProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
      .filter((value) => value !== null)
      .join(" ") || undefined;

  return (
    <div className="space-y-1">
      <LabelPrimitive.Root htmlFor={id} className="text-fg-secondary block text-xs font-medium">
        {label}
      </LabelPrimitive.Root>

      {children({ id, describedBy, invalid: error !== undefined })}

      {hint !== undefined ? (
        <p id={hintId} className="text-fg-secondary text-2xs">
          {hint}
        </p>
      ) : null}

      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-danger-fg text-2xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function TextField({ label, error, hint, className, ...rest }: TextFieldProps) {
  return (
    <Field label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL, className)}
          {...rest}
        />
      )}
    </Field>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function TextAreaField({ label, error, hint, className, ...rest }: TextAreaFieldProps) {
  return (
    <Field label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL, "resize-y", className)}
          {...rest}
        />
      )}
    </Field>
  );
}
