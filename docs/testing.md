# Testing

Tests here assert behaviour a user could observe. A test that asserts a component called a
particular function, or that a hook holds a particular shape of state, is a test that fails when the
code is improved and passes when the product is broken — the opposite of what it is for.

## The layers, and what each one is allowed to claim

| Layer            | Runner                     | Runs against                        | Can honestly claim                                       |
| ---------------- | -------------------------- | ----------------------------------- | -------------------------------------------------------- |
| Rust unit        | `cargo test`               | Pure functions, in-memory SQLite    | Domain rules, validation, ordering algebra                |
| Rust integration | `cargo test`               | **Real SQLite files on disk**       | Migrations, backups, transactions, foreign keys           |
| Component        | `vitest` + Testing Library | React in jsdom, IPC replaced        | Markup, labelling, keyboard behaviour, error rendering    |
| End-to-end       | `wdio`                     | **The built binary, real database** | That the assembled product does the thing                 |

The distinction between the last two matters and is easy to blur. A component test renders the same
React tree the product ships, but jsdom has no layout, no real focus model and no Tauri. It cannot
tell you whether a dialog is visible, whether a control is reachable, or whether anything was
saved. Only the end-to-end layer can, so only it is described as end-to-end.

## Commands

```bash
npm run verify
```

Formatting, lint, types, component tests, `cargo fmt`, Clippy, Rust tests, binding drift, and the
production frontend build. This is the gate every milestone has to pass. It runs in about a minute
and does **not** include the end-to-end suite.

```bash
npm run e2e
```

Builds the frontend, builds a WebDriver-enabled binary, and runs the specs against it. Roughly 30
seconds after a warm build, a couple of minutes cold. Kept out of `verify` because it compiles a
second Rust binary; run it before finishing a milestone and after anything that touches persistence.

```bash
npm run e2e -- --spec e2e/specs/smoke.e2e.ts
npm run e2e -- --logLevel=debug
```

## How the end-to-end suite works

macOS ships no WebDriver for WKWebView, so there is nothing to point a driver at. The server is
compiled *into* the binary instead, by `tauri-plugin-wdio-webdriver`, and WebdriverIO connects to
it. See [ADR-0008](adr/0008-e2e-webdriverio-on-macos.md).

Three properties of the build under test are deliberate:

**It is not a dev build.** Tauri decides at build time whether a binary loads `devUrl` or its
embedded assets, and the switch is the `custom-protocol` feature — literally `dev = !custom_protocol`
in `tauri`'s `build.rs`. The `e2e-webdriver` feature enables it, so the suite always exercises the
frontend bundle the packaged app ships. A debug binary renders a blank window unless a Vite server
happens to be running, which is how this was discovered.

**It builds into `target/e2e`.** `tauri dev` and `cargo build` both write
`target/debug/takenkanban`. Sharing that path meant a `tauri dev` in another terminal silently
replaced the WebDriver-enabled binary between building it and running it — the resulting "the plugin
does not work" was a build-artefact collision, not a plugin problem.

**It never opens a port outside the suite.** `e2e-webdriver` is an optional Cargo feature and not a
default. `cargo build`, `tauri dev` and `tauri build` produce binaries with no WebDriver server in
them. A Rust test reads `Cargo.toml` and fails if the dependency stops being optional or if a
default feature turns it on.

### Data isolation

Every run creates an empty database in a fresh temporary directory and points the app at it with
`TAKENKANBAN_DATA_DIR`. `e2e/specs/isolation.e2e.ts` is ordered first and asserts the database was
created there — before any spec has written anything. If the environment did not reach the app, the
run fails on its first test instead of creating and deleting projects in the database you work in.

That assertion reads the filesystem rather than the path the app displays. Reading it back through
the UI was tried and is wrong twice over: WebKit's rendered-text extraction inserts the soft line
breaks of a wrapped path, and a path containing a space — `Application Support`, on this very
platform — cannot be reconstructed from rendered text at all.

### Writing specs

- Address controls by accessible name or visible label, never by class or generated id. A passing
  test is then also evidence the control is reachable by keyboard and screen reader.
- Address a dialog by its name, via `dialogNamed()`. `div[role="dialog"]` matches whichever dialog
  happens to be open; a leftover Settings dialog once satisfied an assertion about the project
  dialog closing.
- Close what you open. The application instance outlives a spec file, so a dialog left open becomes
  a later spec's mystery failure.
- Failures screenshot themselves into `e2e/artifacts/`. Look there first — an end-to-end stack trace
  says nothing about layout or state.

### A known cost

The service checks which window is focused before every element lookup, by invoking a Tauri command
through `window.__TAURI__`. This application does not expose that global (ADR-0002 keeps `invoke`
inside one module rather than on `window`, where any script on the page could reach it), so the
probe times out after five seconds — per command. `support/app.ts` calls
`browser.tauri.switchWindow("main")` once per session, which is the service's own condition for
skipping the probe, and a single-window application loses nothing by saying so. It took the suite
from over five minutes to about thirty seconds. Two five-second probes still occur immediately after
a `reloadSession()`; that is the whole of the remaining cost.

### The visual review is a spec

`e2e/specs/visual.e2e.ts` builds a populated board, asserts it at three window sizes, and writes
screenshots to `e2e/artifacts/visual/`. Two of its assertions are things only a real renderer can
answer: that every column is the same width even when one holds a very long card, and that a narrow
window scrolls the board inside itself rather than scrolling the document.

Screenshots settle for a moment before being taken. Cards carry `transition-colors`, and a shot
grabbed immediately after a theme change catches them mid-animation — which once produced a
convincing photograph of a bug that did not exist.

### Pointer drag is not covered, and why

The embedded WKWebView driver **can** dispatch pointer gestures — a `performActions` press on the
settings button opens the dialog, which was checked explicitly rather than assumed. What it cannot
do is produce a press-move-release that activates dnd-kit's sensor. Both `PointerSensor` and
`MouseSensor` were tried, with gestures from two coarse steps up to twelve fine ones with pauses.

So pointer drag is implemented and unverified end to end. That is narrower than it sounds: the
gesture is the only unverified part. Everything downstream — the drop-index calculation, the
single-flight queue, the optimistic update, the rollback, the transaction — is one code path shared
with dnd-kit's keyboard drag and with the actions-menu commands, both of which are covered. The
index arithmetic itself has eighteen unit tests in `src/features/board/reorder.test.ts`.

It is listed as a gap in the M5 acceptance criteria and in the README's known limitations, rather
than being counted as passing.

## What is not yet covered

Honest list, kept current:

- **Pointer drag** — see above.
- **The system file dialog is never opened by a test.** `ipc.pickFile` is mocked in component tests
  and not exercised end to end at all: the dialog is a native window the WebDriver session cannot
  reach. What is covered is everything either side of it — path validation and canonicalisation in
  Rust, the missing-file state, relocation, and that a cancelled dialog adds nothing.
- **Nothing measures startup time or board-render time.** The one performance target with a test is
  search: 5,000 tasks, measured at 5.2 ms against a 100 ms budget. The rest of product-spec §9 is
  measured in M10.
- No accessibility audit beyond labelling and keyboard operation of what exists.
- No performance measurements. The targets in `product-spec.md` §9 are measured in M10, not before.
- Windows and Linux are unbuilt and untested; see the README's known limitations.

### A known gap in the component layer

Component tests drive mocked handlers, so a prop derived from a mutation's `isPending` never
changes during them. That let a real bug through in M4 — the quick composer disabled itself while
saving, which blurred it and closed it — and the end-to-end run caught it instead. When a component's
behaviour depends on in-flight state, assert it end to end as well.
