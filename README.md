# Takenkanban

A local-first Kanban task manager for running several personal software projects at once.

No account, no cloud, no telemetry, no network access at runtime. Your data is a SQLite file on
your own disk, and you are told exactly where it is.

> **Status: in development.** Milestones 1–7 are complete — the board, the task editor, `⌘K` search
> across every project, board filters with saved filters, and undo on `⌘Z`. What remains is visual
> and accessibility polish, import/export, and packaging. See
> [`docs/milestones.md`](docs/milestones.md) for what is built and what is not, and
> [Known limitations](#known-limitations) below for what is honestly missing today.

## What it does

Planned for v1.0 (see [`docs/product-spec.md`](docs/product-spec.md) for the full specification):

- Multiple projects, each with multiple boards, user-defined columns, and optional WIP limits.
- Tasks with a markdown description, priority, labels, due date, subtasks, an estimate, and
  references to real files on your disk.
- Task movement by pointer drag, by keyboard drag, and by an explicit "Move to…" command — drag is
  never the only way.
- Global search, filters, saved filters, a command palette, and keyboard shortcuts.
- Light and dark themes, reduced-motion support, WCAG 2.2 AA as the accessibility target.
- Versioned JSON export/import and SQLite backup/restore.

Explicitly **not** included: assignees, comments, sharing, sync, or anything else that implies
people other than you. See [`docs/product-spec.md`](docs/product-spec.md) §3.

## Supported platforms

| Platform | Status |
|---|---|
| macOS 13+ (Apple Silicon) | Developed and verified here |
| macOS (Intel) | Should build; **not verified** |
| Windows / Linux | Code and SQL are kept portable, but **no build has been attempted or tested** |

## Prerequisites

- **Node.js** `^20.19.0 || >=22.12.0` and npm.
- **Rust** (stable). Verified with 1.97.1.
- **Xcode Command Line Tools** — `xcode-select --install`.

If you installed Rust through Homebrew's `rustup` formula, note that it is **keg-only** and no
longer ships `rustup-init`. Put it on your `PATH`:

```bash
echo 'export PATH="/opt/homebrew/opt/rustup/bin:$PATH"' >> ~/.zshrc
```

Then install the toolchain:

```bash
rustup toolchain install stable --profile minimal -c clippy -c rustfmt && rustup default stable
```

## Development

```bash
npm install
```

```bash
npm run tauri dev
```

That opens the desktop window with hot reload. `npm run dev` alone serves only the web layer, where
every Tauri command fails — useful for pure styling work, useless for anything touching data.

## Tests and checks

The single gate. Everything must pass before work moves on:

```bash
npm run verify
```

It runs, in order: format check → ESLint → `tsc` → Vitest → `cargo fmt --check` →
`cargo clippy -D warnings` → `cargo test` → generated-bindings drift check → production build.

Individual steps:

```bash
npm run lint && npm run typecheck && npm run test
```

```bash
npm run rust:test
```

`npm run rust:test` also regenerates the TypeScript type bindings in `src/lib/bindings/` from the
Rust types. `npm run bindings:check` fails the build if the committed bindings have drifted — see
[ADR-0010](docs/adr/0010-generated-type-bindings.md).

End-to-end tests drive the real application window:

```bash
npm run e2e
```

This builds a separate binary with an embedded WebDriver server, runs it against a throwaway
database in a temporary directory, and never touches your own data. It is not part of `npm run
verify` because it compiles a second Rust binary; run it before finishing a milestone and after any
change to persistence. Full detail in [`docs/testing.md`](docs/testing.md).

## Build and packaging

```bash
npm run tauri build
```

Produces a `.app` and a `.dmg` under `src-tauri/target/release/bundle/`. The built application runs
with no dev server and no network connection.

## Where your data lives

```
~/Library/Application Support/nl.synaptica.takenkanban/
  takenkanban.sqlite3        the database
  backups/                   timestamped snapshots
```

The exact path is shown inside the application, so you never have to guess. It is a plain SQLite
file — `sqlite3` and any SQLite browser can open it.

Setting `TAKENKANBAN_DATA_DIR` moves it. That is how a second profile, a portable install on an
external disk, or an automated test run gets its own data without touching yours:

```bash
TAKENKANBAN_DATA_DIR=~/Documents/kanban-work open -a Takenkanban
```

## Backups

Full detail in [`docs/data-and-backups.md`](docs/data-and-backups.md). In short: backups use
SQLite's `VACUUM INTO`, are taken automatically before any schema migration and before any
destructive bulk operation, and can be taken manually at any time. Restoring backs up the current
database first, so a restore is itself reversible.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/product-spec.md`](docs/product-spec.md) | Target user, user stories, acceptance criteria, edge cases, non-goals |
| [`docs/architecture.md`](docs/architecture.md) | Boundaries, schema, commands, transactions, security posture |
| [`docs/research.md`](docs/research.md) | Every source consulted, with URLs, dates, and what was rejected |
| [`docs/design-decisions.md`](docs/design-decisions.md) | The three visual directions and why "Ledger" was chosen |
| [`docs/milestones.md`](docs/milestones.md) | The milestones and their acceptance criteria |
| [`docs/testing.md`](docs/testing.md) | What each test layer may honestly claim, and how to run it |
| [`docs/visual-review.md`](docs/visual-review.md) | States rendered and looked at, with defects found |
| [`docs/shortcuts.md`](docs/shortcuts.md) | Every keyboard route, and the ones that do not exist yet |
| [`docs/adr/`](docs/adr/) | Decision records for the choices that are expensive to reverse |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | Every dependency and its licence |

## Known limitations

Written honestly, and kept current as the milestones land.

- **Milestones 1–7 are complete.** Projects, boards, columns with work-in-progress limits, the full
  task editor, search, filters and undo. Nothing in the interface is a placeholder or a dead
  control.
- **There is no export or import yet, and backups are manual.** Your data is a plain SQLite file you
  can copy; "Back up now" in Settings makes a snapshot. Automatic retention and JSON export/import
  are milestone 9.
- **Task descriptions render a restricted subset of markdown.** No raw HTML, no remote images, and
  links open in your browser rather than inside the app. That is deliberate, not an omission.
- **Pointer drag works but is not covered by an automated test.** Tasks can be dragged with the
  mouse, picked up and moved with the keyboard, or moved from the actions menu. The keyboard and
  menu routes are tested end to end; the mouse gesture is not, because the test driver cannot
  synthesise a drag dnd-kit recognises. See [`docs/testing.md`](docs/testing.md) — it is a real gap,
  not a formality.
- **Backup retention is not yet enforced.** Automatic pruning to the 10 most recent lands in
  milestone 9; until then nothing is deleted at all, which errs in the safe direction.
- **Windows and Linux are unverified.** Nothing platform-specific has been written, but nothing has
  been built or run there either.
- **End-to-end tests use WebdriverIO, not Playwright.** Apple ships no WebDriver for WKWebView, so
  Playwright cannot drive the packaged app on macOS. See
  [ADR-0008](docs/adr/0008-e2e-webdriverio-on-macos.md).
- **Two dependency overrides are in force**, both worked around rather than fixed upstream, and both
  explained in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). One `npm audit` advisory
  (`brace-expansion`) remains open and unfixable without breaking ESLint; it affects development
  tooling only and none of it ships.
- **ESLint is pinned to 9.x**, because `eslint-plugin-jsx-a11y` does not yet support ESLint 10.
  Accessibility linting was judged more valuable than the newer major version.
- **TypeScript is pinned to 6.0.x**, because `typescript-eslint` supports `<6.1.0`. TypeScript 7 is
  current, but type-aware linting is worth more than being on the newest compiler.
- **The native window cannot be driven by hand-written automation outside the test harness** —
  `osascript`/System Events is refused Accessibility permission in this environment. Screenshots of
  the real window do work, and WebdriverIO drives it for tests, which together cover what matters.
- File references store paths, not copies. Moving a referenced file breaks the link, by design —
  the application shows a clear "missing" state rather than pretending otherwise.
  See [ADR-0007](docs/adr/0007-local-file-references.md).

## Licence

MIT. Third-party licences are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
