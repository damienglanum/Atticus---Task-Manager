# ADR-0006 — Import/export format and versioning

Date: 2026-07-30 · Status: **Accepted**

## Context

The user must be able to get their data out and back in. "Invalid imported data" and "Importing an
older export version" are named edge cases. The export format is a promise to the user's future
self, so it needs a version number that means something.

## Decision

Export is JSON with an envelope:

```json
{
  "exportVersion": 1,
  "generatedAt": "2026-07-30T09:41:12.000Z",
  "app": "takenkanban",
  "appVersion": "1.0.0",
  "data": { "projects": [...], "boards": [...], "columns": [...], "tasks": [...], ... }
}
```

- `exportVersion` is **independent** of both the SQLite `user_version` and the app version. It
  increments only when the export *shape* changes.
- Import upgrades old documents through a chain of **pure functions** `v1→v2→…→current`, each
  unit-tested against a checked-in fixture. Fixtures for every released version are kept forever in
  `src-tauri/tests/fixtures/exports/`.
- An `exportVersion` **newer** than the running app is refused with a message naming both numbers.
  It is never partially imported.
- Validation of the whole document completes **before any write**. On failure nothing is written
  and `AppError::ImportInvalid { issues }` lists each problem with its JSON path.
- Two modes: **merge** (fresh UUIDv7s allocated for every record, nothing overwritten) and
  **replace** (existing data deleted first, typed confirmation required, automatic backup taken
  first). Either way, the whole import is one transaction.
- A dry-run `import_preview` returns the counts that *would* be created, shown to the user before
  they commit.

## Evidence

- Tying the export version to the schema version would force a new export format every time an
  index changes — meaningless churn in a number users are asked to trust.
- Validate-then-write is the only ordering under which a malformed file cannot damage good data;
  streaming or incremental import cannot make that guarantee.
- UUIDv7 identifiers mean merge-mode reallocation is trivial and collision-free.

## Alternatives considered

**No version field.** Rejected — makes every future format change a guessing game.

**Reuse the schema version.** Rejected as above.

**SQLite file as the export format.** It is the most faithful possible export. Rejected as the
*primary* format: it is opaque, not diffable, not editable, and not inspectable without tooling.
Kept as the **backup** mechanism, which is a different job (ADR: see `docs/data-and-backups.md`).

**Merge by matching names.** Rejected — names are explicitly not unique in this product
(product-spec US-1 AC5), so name-matching would silently collapse distinct records.

## Consequences

- Merge mode does not de-duplicate. Importing the same file twice creates two copies. This is
  stated in the import dialog rather than solved with heuristics that would occasionally be wrong.
- Every future format change costs an upgrade function plus a fixture. That cost is the point.
- File references export as paths, not contents. A restore on a different machine will show
  "missing file" states — documented in `docs/data-and-backups.md`.
