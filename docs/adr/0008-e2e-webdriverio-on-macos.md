# ADR-0008 — End-to-end tests via WebdriverIO, not Playwright

Date: 2026-07-30 · Status: **Accepted** · Escalated to and decided by the user

## Context

The requested stack names Playwright for end-to-end tests. The required E2E scenarios include
"restart and verify persistence" and "export, clear, and restore data" — scenarios that are only
meaningful against the real application with the real SQLite database.

## Decision

Use **WebdriverIO 9 + `@wdio/tauri-service` 1.2.0** (MIT, verified on npm 2026-07-30) driving the
real Tauri application, with `tauri-plugin-wdio-webdriver` registered **only** under
`#[cfg(debug_assertions)]` and `"wdio-webdriver:default"` present only in the debug capability set.
**Playwright is not used.**

## Evidence

Quoted from <https://v2.tauri.app/develop/tests/webdriver/> (accessed 2026-07-30):

> "Driven directly, only Windows and Linux are supported on desktop, as macOS has no WKWebView
> driver tool available."

> "By default the service runs an embedded WebDriver server inside your app, so no external driver
> is needed on any platform — and this is how macOS is supported."

The WebdriverIO platform-support page
(<https://webdriver.io/docs/desktop-testing/tauri/platform-support/>, accessed 2026-07-30)
confirms macOS support "natively via the embedded WebDriver provider", with no explicit
`driverProvider` configuration required, and lists the plugin, the `#[cfg(debug_assertions)]`
registration, and the capability permission as the requirements.

Apple does not ship a WebDriver implementation for WKWebView. This is a platform fact, not a
Playwright shortcoming; no configuration of Playwright can drive the packaged app on macOS.

## Alternatives considered

**Playwright against the Vite build with a faked IPC layer.** Keeps the requested stack. Rejected:
it never exercises SQLite, migrations, transactions, or restart persistence — precisely the
subsystems where a bug loses the user's data. It would also introduce a second implementation of
the data layer purely for tests, which is a second source of truth and a documented anti-pattern in
the brief.

**Both harnesses.** Offered to the user, not chosen. Would have added a fake backend adapter for
marginal additional UI coverage already provided by React Testing Library component tests.

**No E2E at all.** Rejected: nothing else verifies that the packaged application actually starts,
migrates, and persists.

## Consequences

- **A deviation from the requested stack, made deliberately and with the user's agreement.**
  Recorded here so it is never mistaken for an oversight.
- `tauri-plugin-wdio-webdriver` is young. **If it proves unreliable, that will be reported plainly
  and the affected E2E acceptance criteria marked unmet** — integration tests will not be quietly
  relabelled as end-to-end coverage.
- E2E does not exercise the release *profile*, so Milestone 10 still adds a manual smoke check of
  the packaged `.app`.

## Implementation notes (2026-07-30, after building it)

Four things differ from what this ADR originally assumed. All were found by building the thing.

**Gated on a Cargo feature, not `debug_assertions`.** The upstream guide suggests
`[target.'cfg(debug_assertions)'.dependencies]`, which Cargo does not support — `debug_assertions`
is not a target cfg. It would also mean every ordinary `tauri dev` opened a WebDriver port capable
of executing script in the app window. `e2e-webdriver` is an optional feature instead, off by
default, and a Rust test reads `Cargo.toml` and fails if that ever changes.

**No capability entry was needed.** The embedded server exposes no commands to the frontend, so
`capabilities/default.json` is untouched and there is no WebDriver permission to strip from a
release build. The check this ADR promised is therefore replaced by the manifest test above, which
protects the same property at its actual source.

**The e2e build is a production build.** `dev = !custom_protocol` in `tauri`'s `build.rs`, so a
debug binary embeds `devUrl` and renders a blank window with no Vite server running. `e2e-webdriver`
enables `tauri/custom-protocol`, which means the suite always drives the frontend bundle the
packaged app ships. `[profile.e2e]` keeps the build fast by inheriting `release` without its
optimisations.

**We pay for not exposing `window.__TAURI__`.** The service probes window focus through
`plugin:wdio|get_window_states` before every element lookup. Satisfying it would require
`withGlobalTauri: true`, a second Rust plugin, and a test-package import in the production frontend
entry point — three concessions to a test tool in shipped code, which the brief rules out and
ADR-0002 already argued against. Instead the suite marks the window as explicitly selected once per
session, the service's own condition for skipping the probe. Cost of the decision: two five-second
timeouts per session, after a `reloadSession()`.
