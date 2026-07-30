import { describe, expect, it } from "vitest";

import type { AppError } from "./bindings/AppError";
import { describeAppError, IpcError, isAppError, toAppError } from "./errors";

describe("isAppError", () => {
  it("accepts a payload carrying a kind discriminator", () => {
    expect(isAppError({ kind: "conflict", message: "nope" })).toBe(true);
  });

  it.each([[null], [undefined], ["conflict"], [{}], [{ kind: 7 }]])("rejects %o", (value) => {
    expect(isAppError(value)).toBe(false);
  });
});

describe("toAppError", () => {
  it("passes an AppError through unchanged", () => {
    const error: AppError = { kind: "not_found", entity: "task", id: "abc" };

    expect(toAppError(error)).toStrictEqual(error);
  });

  it("unwraps an IpcError back to its typed payload", () => {
    const error: AppError = { kind: "validation", field: "title", message: "required" };

    expect(toAppError(new IpcError(error))).toStrictEqual(error);
  });

  it("never loses a failure: an unknown rejection becomes an internal error", () => {
    expect(toAppError(new Error("boom"))).toStrictEqual({ kind: "internal", message: "boom" });
    expect(toAppError("boom")).toStrictEqual({ kind: "internal", message: "boom" });
  });
});

describe("describeAppError", () => {
  it("names the offending field for a validation failure", () => {
    expect(describeAppError({ kind: "validation", field: "title", message: "required" })).toBe(
      "title: required",
    );
  });

  it("names the entity and id for a missing record", () => {
    expect(describeAppError({ kind: "not_found", entity: "board", id: "b1" })).toBe(
      "board b1 was not found.",
    );
  });

  it.each<AppError>([
    { kind: "conflict", message: "in use" },
    { kind: "database", message: "locked" },
    { kind: "io", message: "no space" },
    { kind: "migration", message: "failed", backupPath: null },
    { kind: "internal", message: "unexpected" },
  ])("surfaces the message for $kind", (error) => {
    expect(describeAppError(error)).toBe((error as Extract<AppError, { message: string }>).message);
  });
});

describe("IpcError", () => {
  it("is a real Error, so it survives generic error handling", () => {
    const error = new IpcError({ kind: "database", message: "locked" });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("IpcError");
    expect(error.message).toBe("locked");
    expect(error.appError).toStrictEqual({ kind: "database", message: "locked" });
  });
});
