# ADR-0010 — Generate TypeScript types from Rust with ts-rs

Date: 2026-07-30 · Status: **Accepted**

## Context

ADR-0002 puts ~40 typed commands at the IPC boundary. Tauri's `invoke()` returns `unknown`. The
coding standards forbid `any` except at a documented external boundary — and this boundary is
exactly where hand-written duplicate types silently drift from the Rust structs they describe.

## Decision

Rust types crossing the boundary derive `serde::Serialize`/`Deserialize` **and** `ts_rs::TS`.
Running `cargo test` regenerates `src/lib/bindings/*.ts`. The generated files are committed, and a
CI step regenerates them and fails on any diff.

All `invoke()` calls go through one module, `src/lib/ipc.ts`, which maps each command name to its
generated argument and return types. **No component calls `invoke()` directly.**

## Evidence

- The drift this prevents is silent and type-checks cleanly on both sides: rename a Rust field, and
  TypeScript keeps compiling against the stale hand-written interface until something is `undefined`
  at runtime, in production, in front of the user.
- Generation runs in `cargo test`, so it needs no extra toolchain, no build script in the hot path,
  and no network.
- Committing the output keeps the TypeScript build independent of Rust — `npm run typecheck` works
  without a Rust toolchain present — while the CI diff check keeps the commit honest.
- Funnelling through `ipc.ts` means the entire command surface is one greppable file, and component
  tests can mock one module instead of a global.

## Alternatives considered

**Hand-written TypeScript interfaces.** Zero tooling. Rejected: guaranteed to drift, and the drift
is invisible until runtime.

**`specta` / `tauri-specta`.** Richer, generates the typed `invoke` wrappers too. A reasonable
choice; rejected for v1 to keep the dependency count down, since `ts-rs` covers the types and
`ipc.ts` is thirty lines of wrapper we want to own anyway (it is where the single-flight move queue
and error mapping live).

**Derive TypeScript from Zod schemas and validate responses at runtime.** Rejected as the primary
mechanism: it validates our *own* trusted backend's output on every call, which is cost without
benefit. Zod stays where it belongs — validating user input and untrusted import documents.

## Consequences

- Generated files must not be edited; the directory carries a header saying so and is
  lint-ignored and marked `linguist-generated`.
- Adding a command means touching Rust, regenerating, and adding one line to `ipc.ts`. Deliberate
  friction on the security boundary.
- **64-bit integers need an explicit annotation.** This ADR originally assumed `ts-rs` maps
  `i64`/`u64` to `number`. It does not — it emits `bigint`, which is correct for JSON-native
  bigints but wrong for this stack: `serde_json` writes these fields as JSON numbers and Tauri's
  IPC hands the frontend a plain `number`. A `bigint` binding therefore type-checks while being a
  lie about runtime, which is precisely the drift this ADR exists to prevent. Every such field
  carries `#[ts(type = "number")]`, and `scripts/check-bindings.mjs` fails on any `bigint` in a
  generated file so the next one cannot slip through. Timestamps are epoch milliseconds and
  positions are small, both far inside `Number.MAX_SAFE_INTEGER`, so `number` is accurate as well
  as convenient — but that is a property of these fields, not a general licence.
