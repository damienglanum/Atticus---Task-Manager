// @vitest-environment node
//
// This file reads the Rust source from disk to check the two validators agree.
// Under jsdom, `import.meta.url` is not a file: URL and `fileURLToPath` fails.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { boardFormSchema, fieldErrors, LIMITS, projectFormSchema, wipLimitSchema } from "./schemas";

describe("projectFormSchema", () => {
  const valid = {
    name: "Takenkanban",
    description: "",
    color: "indigo" as const,
    keyPrefix: "",
    directoryPath: "",
  };

  it("trims before validating, so spaces are not a name", () => {
    expect(projectFormSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(projectFormSchema.parse({ ...valid, name: "  Kept  " }).name).toBe("Kept");
  });

  it("uppercases the key prefix rather than rejecting lowercase", () => {
    expect(projectFormSchema.parse({ ...valid, keyPrefix: " kan " }).keyPrefix).toBe("KAN");
  });

  it("permits an empty key prefix, because the backend derives one", () => {
    expect(projectFormSchema.safeParse({ ...valid, keyPrefix: "" }).success).toBe(true);
  });

  it.each(["K4N", "KA-N", "A", "ABCDEF"])("rejects the key prefix %s", (keyPrefix) => {
    expect(projectFormSchema.safeParse({ ...valid, keyPrefix }).success).toBe(false);
  });

  it("requires a directory to be absolute", () => {
    expect(projectFormSchema.safeParse({ ...valid, directoryPath: "relative" }).success).toBe(
      false,
    );
    expect(projectFormSchema.safeParse({ ...valid, directoryPath: "/abs" }).success).toBe(true);
    expect(projectFormSchema.safeParse({ ...valid, directoryPath: "" }).success).toBe(true);
  });

  it("rejects a colour outside the palette", () => {
    expect(projectFormSchema.safeParse({ ...valid, color: "chartreuse" }).success).toBe(false);
  });

  it("counts length in code points, matching the backend", () => {
    // Each of these is 3 bytes but one `char` in Rust. A byte-based limit here
    // would reject a name the backend would happily accept.
    const atLimit = "あ".repeat(LIMITS.projectName);
    const overLimit = "あ".repeat(LIMITS.projectName + 1);

    expect(projectFormSchema.safeParse({ ...valid, name: atLimit }).success).toBe(true);
    expect(projectFormSchema.safeParse({ ...valid, name: overLimit }).success).toBe(false);
  });
});

describe("boardFormSchema", () => {
  it("requires a name", () => {
    expect(boardFormSchema.safeParse({ name: " " }).success).toBe(false);
    expect(boardFormSchema.parse({ name: " Ideas " }).name).toBe("Ideas");
  });
});

describe("fieldErrors", () => {
  it("keys messages by field so they reach the right input", () => {
    const result = projectFormSchema.safeParse({
      name: "",
      description: "",
      color: "indigo",
      keyPrefix: "1",
      directoryPath: "nope",
    });

    expect(result.success).toBe(false);
    const errors = fieldErrors(result.error!);
    expect(errors.name).toBeDefined();
    expect(errors.keyPrefix).toBeDefined();
    expect(errors.directoryPath).toBeDefined();
  });
});

/**
 * The frontend and the backend each hold their own copy of these limits. Two
 * copies of a rule drift silently, so this reads the Rust constants and asserts
 * they still agree — if someone raises a limit on one side only, this fails.
 */
describe("limits agree with the Rust validator", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/domain/validate.rs", import.meta.url)),
    "utf8",
  );

  function rustConst(name: string): number {
    const match = new RegExp(`pub const ${name}: usize = (\\d+);`).exec(source);
    if (match?.[1] === undefined) throw new Error(`could not find ${name} in validate.rs`);
    return Number(match[1]);
  }

  it.each([
    ["PROJECT_NAME_MAX", LIMITS.projectName],
    ["PROJECT_DESCRIPTION_MAX", LIMITS.projectDescription],
    ["BOARD_NAME_MAX", LIMITS.boardName],
    ["COLUMN_NAME_MAX", LIMITS.columnName],
    ["TASK_TITLE_MAX", LIMITS.taskTitle],
    ["KEY_PREFIX_MIN", LIMITS.keyPrefixMin],
    ["KEY_PREFIX_MAX", LIMITS.keyPrefixMax],
  ])("%s matches", (rustName, tsValue) => {
    expect(rustConst(rustName)).toBe(tsValue);
  });
});

describe("wipLimitSchema", () => {
  it("treats an empty field as no limit", () => {
    expect(wipLimitSchema.parse("")).toBeNull();
    expect(wipLimitSchema.parse("   ")).toBeNull();
  });

  it("accepts a whole number of at least one", () => {
    expect(wipLimitSchema.parse("5")).toBe(5);
    expect(wipLimitSchema.parse(" 1 ")).toBe(1);
  });

  it("refuses zero rather than reading it as no limit", () => {
    const result = wipLimitSchema.safeParse("0");
    expect(result.success).toBe(false);
  });

  it("refuses anything that is not a whole number", () => {
    for (const value of ["-1", "2.5", "five", "1e3"]) {
      expect(wipLimitSchema.safeParse(value).success).toBe(false);
    }
  });
});
