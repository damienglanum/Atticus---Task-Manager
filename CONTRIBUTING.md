# Contributing to Atticus

Thank you for looking. Atticus is a single-user application by design, so the most useful
contributions are bug reports from real use, accessibility findings, and **Linux or Windows build
reports** — the platforms with the least mileage on them.

The one house rule, inherited from [`docs/milestones.md`](docs/milestones.md): **a failing check is
reported, not carried.** Work does not move past a red gate, and a limitation is written down rather
than rounded off.

## Contents

- [Prerequisites](#prerequisites)
- [Development](#development)
- [Tests and checks](#tests-and-checks)
- [End-to-end tests](#end-to-end-tests)
- [Build and packaging](#build-and-packaging)
- [The release workflow](#the-release-workflow)
- [Project layout](#project-layout)
- [Known constraints](#known-constraints)
- [Opening a pull request](#opening-a-pull-request)

## Prerequisites

- **Node.js** `^20.19.0 || >=22.12.0` and npm.
- **Rust** (stable). Verified with 1.97.1.
- **Xcode Command Line Tools** on macOS — `xcode-select --install`.
- On Linux, the usual WebKitGTK build dependencies:
  `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

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

That opens the desktop window with hot reload.

`npm run dev` alone serves only the web layer, where every Tauri command fails — useful for pure
styling work, useless for anything touching data.

## Tests and checks

One gate. Everything must pass before work moves on:

```bash
npm run verify
```

It runs, in order: format check → ESLint → `tsc` → Vitest → `cargo fmt --check` →
`cargo clippy -D warnings` → `cargo test` → generated-bindings drift check → MCP protocol smoke test
→ production build.

Individual steps, when you want a faster loop:

```bash
npm run lint && npm run typecheck && npm run test
```

```bash
npm run rust:test
```

`npm run rust:test` also regenerates the TypeScript type bindings in `src/lib/bindings/` from the
Rust types. `npm run bindings:check` fails the build if the committed bindings have drifted — see
[ADR-0010](docs/adr/0010-generated-type-bindings.md). Do not hand-edit anything under
`src/lib/bindings/`.

The MCP protocol surface has its own smoke test, which builds the debug executable and performs a
real stdio handshake against a throwaway profile:

```bash
npm run test:mcp-protocol
```

## End-to-end tests

```bash
npm run e2e
```

This builds a separate binary with an embedded WebDriver server, runs it against a throwaway
database in a temporary directory, and never touches your own data.

It is **not** part of `npm run verify`, because it compiles a second Rust binary. Run it before
finishing a milestone and after any change to persistence. What each layer may honestly claim is
written down in [`docs/testing.md`](docs/testing.md).

Screenshots produced by the suite land in `e2e/artifacts/visual/`, which is gitignored. The copies
used by the website live in `docs/assets/` and are committed; refreshing one means running the suite
first.

## Build and packaging

```bash
npm run tauri build
```

Produces a `.dmg` under `src-tauri/target/release/bundle/dmg/`. The `.app` is built as an
intermediate — a disk image is made from one — and then removed, so installing leaves a single copy
of the application rather than a loose bundle beside the image it came out of. The built application
runs with no dev server and no network connection beyond the update check.

```bash
npm run release:check
```

Asserts the release artifact carries no WebDriver server. `npm run release:check:markers` re-verifies
the marker list itself, so it cannot rot unnoticed.

Linux releases are built on Ubuntu 22.04 for x86_64 and produce two downloads: the portable,
self-updating `.AppImage`, and a `.deb` for Debian, Ubuntu, and derivatives.

## The release workflow

[`.github/workflows/publish-updates.yml`](.github/workflows/publish-updates.yml) builds macOS Apple
Silicon and Linux x86_64 downloads and publishes the moving `main` tag automatically on every push.
The release stays a draft until both platforms finish, so downloads never appear half-populated.

A packaged release follows signed builds from `main`: it checks at launch and every thirty minutes
while open, downloads a newer version in the background, and shows a header banner with **Restart to
update**. Debug executables deliberately do not self-update, because replacing `target/debug` would
interfere with the source build — install one release build first.

Its one-time repository setup is the updater private key, generated locally into the gitignored
`.updater-keys/` directory:

```bash
gh auth login
gh secret set TAURI_SIGNING_PRIVATE_KEY < .updater-keys/atticus.key
```

Only the public verification key is committed, in
[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json). **Losing or replacing the private key
breaks the update path for every already-installed copy**, so keep an encrypted backup of it.

## Project layout

| Path | What lives there |
|---|---|
| `src/` | React interface. `src/features/<area>/` per feature; `src/components/ui/` for shared primitives |
| `src/styles/` | `tokens.css` is the single source of colour, spacing, radius and motion values |
| `src/lib/bindings/` | **Generated** from the Rust types — never hand-edited |
| `src-tauri/src/` | Rust core: commands, domain types, SQLite persistence, migrations, MCP server |
| `e2e/` | WebdriverIO suite driving the real application window |
| `docs/` | Specification, architecture, ADRs — and the GitHub Pages site (`docs/index.html`) |
| `scripts/` | Build, release and binding-check helpers |

The GitHub Pages site is served from `docs/`, so `docs/index.html`, `docs/.nojekyll` and
`docs/assets/` are part of the published site rather than internal documentation. `prettier --check`
covers `docs/index.html`, so format it like any other source file.

## Known constraints

Recorded so nobody has to rediscover them.

- **End-to-end tests use WebdriverIO, not Playwright.** Apple ships no WebDriver for WKWebView, so
  Playwright cannot drive the packaged app on macOS. See
  [ADR-0008](docs/adr/0008-e2e-webdriverio-on-macos.md).
- **ESLint is pinned to 9.x**, because `eslint-plugin-jsx-a11y` does not yet support ESLint 10.
  Accessibility linting was judged more valuable than the newer major version.
- **TypeScript is pinned to 6.0.x**, because `typescript-eslint` supports `<6.1.0`. Type-aware
  linting is worth more than being on the newest compiler.
- **Two dependency overrides are in force**, both worked around rather than fixed upstream and both
  explained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). One `npm audit` advisory
  (`brace-expansion`) remains open and unfixable without breaking ESLint; it affects development
  tooling only and none of it ships.
- **The native window cannot be driven by hand-written automation outside the test harness** —
  `osascript`/System Events is refused Accessibility permission in the development environment here.
  Screenshots of the real window do work, and WebdriverIO drives it for tests.

User-facing limitations are in the README under
[Project status](README.md#project-status).

## Opening a pull request

1. Branch from `main`.
2. Make the change, and add or update the test that would have caught the bug.
3. Run `npm run verify` until it is green. Run `npm run e2e` too if you touched persistence,
   movement, or the task editor.
4. If the change is expensive to reverse — a schema change, a format version, a dependency with a
   licence question — add an ADR under [`docs/adr/`](docs/adr/) rather than only a commit message.
5. Describe what you changed and what you checked. "Verified by hand" is a fine answer; leaving it
   unsaid is not.

Every push to `main` publishes a release, so keep `main` green.
