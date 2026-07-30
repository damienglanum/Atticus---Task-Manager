# ADR-0001 — Tauri 2 as the desktop shell

Date: 2026-07-30 · Status: **Accepted** · Confirmed by the user during discovery

## Context

The product must run entirely locally, with no account and no network after installation, and be
installable as a real desktop application. The user runs macOS 26.6 on Apple Silicon.

## Decision

Use **Tauri 2** (CLI 2.11.4, verified from the npm registry on 2026-07-30) with a Rust core and a
React/TypeScript webview.

## Evidence

- Tauri uses the OS webview (WKWebView on macOS) rather than bundling Chromium, so the shipped
  artefact is a fraction of an Electron equivalent and does not carry a second browser engine's
  memory cost for an app the user leaves open all day.
- Tauri 2 has a first-class capability/permission system (<https://v2.tauri.app/security/capabilities/>)
  that lets us grant the webview *no filesystem and no shell access at all*. Electron's default is
  the opposite: `nodeIntegration` and `contextIsolation` must be actively fought into shape.
- A Rust core gives us a compiled, typed boundary in which to put all SQL and validation, which is
  what makes `docs/architecture.md` §1 enforceable rather than aspirational.

## Alternatives considered

**Electron + better-sqlite3.** One language, very mature, `better-sqlite3` is synchronous and
pleasant. Rejected: bundle size and memory for a daily-use utility, and a weaker default security
posture. The single-language benefit is real but does not outweigh those for this product.

**Web app with SQLite WASM + OPFS.** No install step. Rejected: it cannot reference local files
usefully, the persistence story is browser-storage-shaped (evictable), and the brief requires a
packaged desktop application.

**Native SwiftUI.** Best possible macOS integration. Rejected: no path to the requested stack, far
larger effort, and locks out Windows/Linux permanently.

## Consequences

- Requires a Rust toolchain to build. Installed this session (1.97.1 via Homebrew `rustup`, which
  is keg-only — `/opt/homebrew/opt/rustup/bin` must be on `PATH`).
- **WKWebView is not Chromium.** CSS and JS support differ from Chrome; anything verified only in a
  browser must be re-verified in the packaged app.
- **Playwright cannot drive the app on macOS** — Apple ships no WKWebView WebDriver. This is the
  direct cause of ADR-0008.
- Two languages to maintain, and an IPC boundary that needs type discipline — addressed by ADR-0010.
