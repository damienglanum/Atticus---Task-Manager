import type { AppError } from "./bindings/AppError";

/**
 * A rejected Tauri command carries the serialised `AppError` payload, not an
 * `Error`. Wrapping it keeps a real stack trace and lets any generic error
 * boundary handle it, while `appError` preserves the typed detail the UI needs
 * to attach a validation failure to the right form field.
 */
export class IpcError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(describeAppError(appError));
    this.name = "IpcError";
    this.appError = appError;
  }
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as Record<"kind", unknown>).kind === "string"
  );
}

/**
 * Normalises anything a rejected command threw into an `AppError`. An
 * unrecognised rejection becomes `internal` rather than being swallowed — the
 * user still learns that something failed.
 */
export function toAppError(value: unknown): AppError {
  if (value instanceof IpcError) return value.appError;
  if (isAppError(value)) return value;
  return {
    kind: "internal",
    message: value instanceof Error ? value.message : String(value),
  };
}

/** Human-readable text for an error. Presentation-free, so it is unit-testable. */
export function describeAppError(error: AppError): string {
  switch (error.kind) {
    case "validation":
      return `${error.field}: ${error.message}`;
    case "not_found":
      return `${error.entity} ${error.id} was not found.`;
    case "conflict":
    case "database":
    case "io":
    case "migration":
    case "internal":
      return error.message;
  }
}

/**
 * The sentence to show the user for anything thrown across the IPC boundary.
 *
 * Callers deal in `unknown` — a mutation's `onError` gives no better type — so
 * the unwrap and the description belong together rather than being spelt out at
 * every call site.
 */
export function messageFor(error: unknown): string {
  return describeAppError(toAppError(error));
}
