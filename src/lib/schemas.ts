import { z } from "zod";

/**
 * Client-side validation.
 *
 * This layer exists for immediate feedback while typing. It is **not** the
 * security boundary and is never trusted — Rust re-validates every field on
 * every call (see `docs/architecture.md` §7). The limits below deliberately
 * mirror `src-tauri/src/domain/validate.rs`; a test asserts they agree on the
 * boundary values, because two copies of a rule drift silently.
 */
export const LIMITS = {
  projectName: 100,
  projectDescription: 2000,
  boardName: 100,
  columnName: 60,
  taskTitle: 500,
  noteTitle: 200,
  // Matches `validate::NOTE_TITLE_MAX` and friends in Rust. A name is not stored
  // by the backend at all — it lives in `ui_state` — so this limit exists only
  // to stop a paste of a whole document going into a text field.
  profileName: 80,
  keyPrefixMin: 2,
  keyPrefixMax: 5,
} as const;

export const PROJECT_COLORS = [
  "slate",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "grass",
  "amber",
  "orange",
  "red",
  "plum",
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

/**
 * Length in Unicode code points — deliberately **not** grapheme clusters.
 *
 * Rust validates with `chars().count()`, which counts code points. Counting
 * graphemes here would let the frontend accept a string the backend rejects,
 * which is exactly the drift these two layers must not have.
 */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

const trimmedRequired = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "This can't be empty." })
    .refine((value) => codePointLength(value) <= max, {
      message: `Keep this to ${String(max)} characters or fewer.`,
    })
    .describe(label);

export const projectFormSchema = z.object({
  name: trimmedRequired(LIMITS.projectName, "name"),
  description: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => codePointLength(value) <= LIMITS.projectDescription, {
      message: `Keep this to ${String(LIMITS.projectDescription)} characters or fewer.`,
    }),
  color: z.enum(PROJECT_COLORS),
  keyPrefix: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => value === "" || /^[A-Z]+$/.test(value), {
      message: "Use letters A–Z only.",
    })
    .refine(
      (value) =>
        value === "" ||
        (value.length >= LIMITS.keyPrefixMin && value.length <= LIMITS.keyPrefixMax),
      {
        message: `Use between ${String(LIMITS.keyPrefixMin)} and ${String(LIMITS.keyPrefixMax)} letters.`,
      },
    ),
  directoryPath: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value === "" || value.startsWith("/"), {
      message: "Use a full path, starting with /.",
    }),
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

export const columnNameSchema = trimmedRequired(LIMITS.columnName, "name");

export const taskTitleSchema = trimmedRequired(LIMITS.taskTitle, "title");

/**
 * A work-in-progress limit as typed into a text field.
 *
 * Empty means no limit; anything else has to be a whole number of at least one.
 * Zero is rejected rather than quietly read as "no limit" — someone typing 0
 * meant something, and it was not that. Mirrors `validate_wip_limit` in Rust.
 */
export const wipLimitSchema = z
  .string()
  .transform((value) => value.trim())
  .superRefine((value, ctx) => {
    if (value.length === 0) return;
    if (!/^\d+$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Use a whole number, or leave it empty." });
      return;
    }
    if (Number(value) < 1) {
      ctx.addIssue({
        code: "custom",
        message: "A limit has to be at least 1. Leave it empty for no limit.",
      });
    }
  })
  .transform((value) => (value.length === 0 ? null : Number(value)));

export const boardFormSchema = z.object({
  name: trimmedRequired(LIMITS.boardName, "name"),
});

export type BoardFormValues = z.infer<typeof boardFormSchema>;

/** Field-keyed messages, ready to hand to the form controls. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    result[key] ??= issue.message;
  }
  return result;
}
