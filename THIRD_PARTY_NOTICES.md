# Third-party notices

Every third-party component in this project, with its licence. Versions were read from the npm
registry and crates.io on 2026-07-30 and are recorded in `package-lock.json` and
`src-tauri/Cargo.lock`.

This file is updated whenever a dependency is added. A dependency that is not listed here has not
been approved.

## Runtime dependencies (JavaScript)

| Package | Version | Licence | Why it is here |
|---|---|---|---|
| `react` | 19.2.8 | MIT | UI runtime |
| `react-dom` | 19.2.8 | MIT | UI runtime |
| `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT | The IPC bridge to the Rust core |
| `@tauri-apps/plugin-opener` | 2.5.4 | MIT OR Apache-2.0 | Opens a file in Finder or the default app, so the webview never needs filesystem access (ADR-0007) |
| `@tauri-apps/plugin-dialog` | 2.7.2 | MIT OR Apache-2.0 | The system file picker — the only way a path enters the app |
| `@tanstack/react-query` | 5.101.4 | MIT | Read-model cache, optimistic updates and their rollback (ADR-0011) |
| `zustand` | 5.0.14 | MIT | Transient UI state only — currently just the toasts |
| `zod` | 4.4.3 | MIT | Input validation in the webview; never the security boundary (architecture §7) |
| `@radix-ui/colors` | 3.0.0 | MIT | Accessible 12-step colour scales, light/dark paired |
| `@radix-ui/react-dialog` | 1.1.23 | MIT | Modal dialog, focus trapping and restoration |
| `@radix-ui/react-alert-dialog` | 1.1.23 | MIT | Destructive confirmations — will not close on an outside click |
| `@radix-ui/react-dropdown-menu` | 2.1.24 | MIT | Every actions menu, with roving focus and typeahead |
| `@radix-ui/react-label` | 2.1.15 | MIT | Label/control association |
| `@radix-ui/react-tooltip` | 1.2.16 | MIT | Tooltips |
| `@dnd-kit/core` | 6.3.1 | MIT | Drag and drop with a keyboard sensor as a first-class citizen, not an afterthought (ADR-0005) |
| `@dnd-kit/sortable` | 10.0.0 | MIT | Sortable lists and the keyboard coordinate getter |
| `@dnd-kit/utilities` | 3.2.2 | MIT | The CSS transform helper used by the drag preview |
| `react-markdown` | 10.1.0 | MIT | Renders task descriptions. Chosen partly because it ignores raw HTML unless `rehype-raw` is added — which it is not, and must not be (US-10 AC4) |
| `remark-gfm` | 4.0.1 | MIT | Tables, task lists and strikethrough in descriptions |
| `lucide-react` | 1.28.0 | ISC | The only icon set used |
| `clsx` | 2.1.1 | MIT | Conditional class names |
| `tailwind-merge` | 3.6.0 | MIT | Resolves conflicting Tailwind classes when a component is restyled by its caller |

## Development dependencies (JavaScript)

| Package | Version | Licence | Why it is here |
|---|---|---|---|
| `vite` | 8.1.5 | MIT | Build tool and dev server |
| `@vitejs/plugin-react` | 6.0.4 | MIT | React fast refresh and JSX transform |
| `typescript` | 6.0.3 | Apache-2.0 | Pinned below 6.1 for `typescript-eslint` compatibility |
| `tailwindcss` | 4.3.3 | MIT | Utility CSS; the `@theme` block hosts our design tokens |
| `@tailwindcss/vite` | 4.3.3 | MIT | The v4 Vite integration |
| `@tauri-apps/cli` | 2.11.4 | Apache-2.0 OR MIT | `tauri dev` / `tauri build` |
| `eslint` | 9.39.5 | MIT | Pinned to 9.x for `eslint-plugin-jsx-a11y` compatibility |
| `@eslint/js` | 9.39.5 | MIT | Base ESLint rule set |
| `typescript-eslint` | 8.65.0 | MIT | Type-aware linting |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | Accessibility linting — a hard requirement, and the reason ESLint is pinned |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT | Hook correctness |
| `eslint-plugin-react-refresh` | 0.5.3 | MIT | Fast-refresh boundary warnings |
| `globals` | 17.8.0 | MIT | Environment globals for ESLint |
| `prettier` | 3.9.6 | MIT | Formatting |
| `vitest` | 4.1.10 | MIT | Unit and component test runner |
| `@vitest/coverage-v8` | 4.1.10 | MIT | Coverage |
| `jsdom` | 30.0.1 | MIT | DOM for component tests |
| `@testing-library/react` | 16.3.2 | MIT | Behaviour-focused component testing |
| `@testing-library/jest-dom` | 7.0.0 | MIT | DOM assertions |
| `@testing-library/user-event` | 14.6.1 | MIT | Realistic user interaction in tests |
| `@types/node`, `@types/react`, `@types/react-dom` | — | MIT | Type definitions |
| `@wdio/cli` | 9.30.0 | MIT | End-to-end test runner (ADR-0008) |
| `@wdio/local-runner` | 9.30.0 | MIT | Runs specs in worker processes |
| `@wdio/mocha-framework` | 9.30.0 | MIT | Test framework for the end-to-end specs |
| `@wdio/spec-reporter` | 9.29.1 | MIT | Console reporter |
| `@wdio/tauri-service` | 1.2.0 | MIT | Launches and drives the Tauri binary; the only route to automation on macOS |

### Dependency overrides

| Package | Forced to | Why |
|---|---|---|
| `serialize-javascript` | `^7.0.7` | Mocha pins `^6.0.2`; every 6.x is affected by an RCE via `RegExp.flags` and a CPU-exhaustion DoS. 7.0.5+ is patched and the API Mocha uses is unchanged. |
| `@wdio/native-utils` | `^2.5.0` | `@wdio/tauri-service` 1.2.0 imports `installMockSyncOverride`, which does not exist in the 2.4.0 it pins. Upstream packaging error; without this the service cannot be loaded at all. |

`npm audit` still reports the `brace-expansion` advisory (GHSA, DoS via unbounded expansion) across
`eslint`, `mocha` and `glob`. It is **not fixed here and cannot be**: the advisory covers every
published version up to 5.0.7, and 5.0.8 — the first patched release — is a major bump that
`@eslint/config-array` does not survive; forcing it was tried and broke `npm run lint`. The reachable
input is our own glob patterns in config files, not anything a user supplies, and none of it is in
the shipped application, which contains only `dist/` and the Rust binary.

## Rust dependencies

| Crate | Version | Licence | Why it is here |
|---|---|---|---|
| `tauri` | 2.11.5 | Apache-2.0 OR MIT | Desktop shell (ADR-0001) |
| `tauri-build` | 2.6.3 | Apache-2.0 OR MIT | Build-time codegen |
| `tauri-plugin-opener` | 2.5.4 | Apache-2.0 OR MIT | See above |
| `tauri-plugin-dialog` | 2.7.2 | Apache-2.0 OR MIT | See above |
| `serde` | 1.x | MIT OR Apache-2.0 | Serialisation across the IPC boundary |
| `serde_json` | 1.x | MIT OR Apache-2.0 | JSON for export/import |
| `thiserror` | 2.0.19 | MIT OR Apache-2.0 | The typed error enum (architecture §9) |
| `ts-rs` | 12.0.1 | MIT | Generates TypeScript types from Rust types (ADR-0010) |
| `tempfile` | 3.x | MIT OR Apache-2.0 | Isolated databases in tests (dev only) |
| `tauri-plugin-wdio-webdriver` | 1.2.0 | MIT | Embedded W3C WebDriver server. **Optional**, behind the `e2e-webdriver` feature, and absent from every build except the end-to-end one (ADR-0008) |

Transitive dependencies are resolved by `Cargo.lock` and `package-lock.json`. Their licences are
inspectable with `cargo tree` and `npm ls`.

## Planned, not yet added

Listed so the licence question is settled before the dependency lands, not after. Everything that
has since landed has moved into the tables above; this list is pruned rather than annotated, so it
always answers "what is still coming".

| Component | Licence | Milestone |
|---|---|---|
| `cmdk` 1.1.1 | MIT | M7 — command palette |

`react-day-picker` was planned for M6 and **not added**: the native `<input type="date">` is
keyboard-accessible, localised by the platform, and free, and a 40 kB dependency to replace it would
have to earn its place with more than looks.

**shadcn/ui was evaluated and not used.** Its components are copied into a project rather than
installed, and the handful this application needs — button, dialog, field, menu — came to about two
hundred lines written directly against Radix with our own tokens. Copying a larger surface to use a
fraction of it would have meant carrying code nobody here had read. Radix, which shadcn/ui is built
on, is used directly and is listed above.

## Fonts

**No font is bundled.** The interface uses the platform's `system-ui` stack, which resolves to
SF Pro on macOS. There is no font file in this repository and therefore no font licence to satisfy.

Inter was evaluated as a cross-platform alternative and its licence verified as **SIL Open Font
License 1.1** (<https://rsms.me/inter/>, accessed 2026-07-30). It is not used in v1, and would only
be revisited if Windows and Linux builds became a target.

## Design references

The products studied for interaction and information-design patterns — GitHub Projects, Plane,
Vikunja — are documented with URLs and access dates in [`docs/research.md`](docs/research.md) §7.

**No proprietary asset, icon, font, screenshot, stylesheet, or markup from any of them is included
in this repository.** Vikunja is AGPLv3; no Vikunja code is adopted, and its influence is limited
to which features were judged worth building.
