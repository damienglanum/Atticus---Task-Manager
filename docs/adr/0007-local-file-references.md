# ADR-0007 — Local file references, not attachments

Date: 2026-07-30 · Status: **Accepted** · Chosen by the user during discovery

## Context

Tasks need to point at real things on disk — a spec, a screenshot, a source file in the project's
repository. The choice is between copying files into app storage and referencing them in place.

## Decision

Store a **reference**: an absolute canonical path, a display name, a `found` flag, and
`last_verified_at`. No file contents are ever copied, read, or embedded.

- The user picks a file through the **system dialog** (`dialog:allow-open`). This is the only way a
  path enters the application, and it is user-gated by construction.
- The path is canonicalised in Rust and rejected if it is not absolute or contains a NUL byte.
- Opening a reference goes through a Rust command that calls the opener plugin
  (`reveal-item-in-dir` / open with default app). **The webview never reads the file.**
- Existence is verified lazily when a task editor opens; a missing file renders in an explicit
  "missing" state showing the path, with a "Locate…" action that re-opens the picker.
- The frontend is granted **no `fs` plugin permission of any kind**.

## Evidence

- The Tauri fs plugin scopes files by path pattern (<https://v2.tauri.app/plugin/file-system/>,
  accessed 2026-07-30) with deny taking precedence over allow. But any scope broad enough to be
  *useful* for arbitrary user files — `$HOME/**` — is also broad enough to be dangerous if the
  webview is ever compromised through a markdown renderer or a dependency. Granting zero fs
  permission and routing through a user-gated dialog gives the same capability with none of that
  exposure.
- References keep one copy of the truth. A copied file diverges from the original the moment the
  user edits the original, and the user is then looking at a stale copy without knowing it.

## Alternatives considered

**Copy files into app storage.** Self-contained backups, links never break. Rejected by the user
during discovery, and independently the weaker choice for a developer's workflow, where the point
of the link is to open *the file you are working on*.

**Both, chosen per attachment.** Most flexible. Rejected: it doubles the backup, export, and
verification surface for a single-user app, and each mode's edge cases need their own tests.

**macOS security-scoped bookmarks.** The correct mechanism *if the app is sandboxed*. Not adopted
in v1 because the app is not sandboxed and therefore has ordinary user-level file access, and
bookmarks are macOS-only — they would make the reference column non-portable.

## Consequences

- **Moving or renaming a referenced file breaks the link.** This is the accepted cost, surfaced
  honestly in the UI rather than hidden, with a one-click relink.
- Exports and backups do not contain file contents; restoring on another machine shows missing
  references. Documented in `docs/data-and-backups.md`.
- **If this app is ever sandboxed for Mac App Store distribution, plain paths will stop resolving**
  and security-scoped bookmarks become mandatory. Recorded as a known future migration in
  `docs/architecture.md` §12, not a present defect.
