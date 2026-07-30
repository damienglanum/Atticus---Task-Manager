# Research log

All entries were accessed on **2026-07-30** unless stated otherwise. Every claim below is
traceable to a URL that was actually fetched during this session. Where a fetch **failed**,
that is recorded as a failure rather than papered over — no inspiration is claimed from a
source that was not read.

Version numbers were read from the npm registry / crates.io API on 2026-07-30, not from
memory.

---

## 1. Dependency versions verified from registries

| Package | Version read | Licence | Source URL |
|---|---|---|---|
| `@tauri-apps/cli` | 2.11.4 | Apache-2.0 / MIT | <https://registry.npmjs.org/@tauri-apps/cli/latest> |
| `react` | 19.2.8 | MIT | <https://registry.npmjs.org/react/latest> |
| `vite` | 8.1.5 (engines: node ^20.19 \|\| >=22.12) | MIT | <https://registry.npmjs.org/vite/latest> |
| `tailwindcss` | 4.3.3 | MIT | <https://registry.npmjs.org/tailwindcss/latest> |
| `@dnd-kit/core` | 6.3.1 | MIT | <https://registry.npmjs.org/@dnd-kit/core/latest> |
| `@dnd-kit/sortable` | 10.0.0 (peer `@dnd-kit/core ^6.3.0`) | MIT | <https://registry.npmjs.org/@dnd-kit/sortable/latest> |
| `@dnd-kit/react` | 0.5.0 — pre-1.0 | MIT | <https://registry.npmjs.org/@dnd-kit/react/latest> |
| `zod` | 4.4.3 | MIT | <https://registry.npmjs.org/zod/latest> |
| `vitest` | 4.1.10 | MIT | <https://registry.npmjs.org/vitest/latest> |
| `@playwright/test` | 1.62.0 | Apache-2.0 | <https://registry.npmjs.org/@playwright/test/latest> |
| `lucide-react` | 1.27.0 | ISC | <https://registry.npmjs.org/lucide-react/latest> |
| `cmdk` | 1.1.1 | MIT | <https://registry.npmjs.org/cmdk/latest> |
| `react-day-picker` | 10.0.1 | MIT | <https://registry.npmjs.org/react-day-picker/latest> |
| `zustand` | 5.0.14 | MIT | <https://registry.npmjs.org/zustand/latest> |
| `@tanstack/react-query` | 5.101.4 | MIT | <https://registry.npmjs.org/@tanstack/react-query/latest> |
| `@radix-ui/react-dialog` | 1.1.23 | MIT | <https://registry.npmjs.org/@radix-ui/react-dialog/latest> |
| `react-markdown` | 10.1.0 | MIT | <https://registry.npmjs.org/react-markdown/latest> |
| `@wdio/tauri-service` | 1.2.0 (peer `webdriverio ^9`) | MIT | <https://registry.npmjs.org/@wdio/tauri-service/latest> |
| `rusqlite` (crate) | 0.40.1 | MIT | <https://crates.io/api/v1/crates/rusqlite> |

**Adopted:** all of the above except `@dnd-kit/react` and (pending decision) `@tanstack/react-query`.

**Rejected — `@dnd-kit/react` 0.5.0.** It is the next-generation dnd-kit package but is still
pre-1.0. The mature, documented, widely-deployed line is `@dnd-kit/core` 6.3.1 +
`@dnd-kit/sortable` 10.0.0, and the accessibility documentation (below) describes that line.
Shipping a daily-use app on a pre-1.0 drag-and-drop core is not justified by any feature we need.

**Rejected — `zustand` for server state.** Adopted only for transient UI state (open dialogs,
filter draft, drag overlay), per the brief. Persisted data has exactly one source of truth: SQLite.

---

## 2. Tauri 2

### 2.1 Capabilities and permissions
Source: <https://v2.tauri.app/security/capabilities/>

- Capability files live in `src-tauri/capabilities/` as JSON or TOML and are enabled by default
  unless restricted in `tauri.conf.json`.
- Fields: `identifier`, `windows` (window labels, `["*"]` for all), `permissions` (array of
  permission strings), optional `platforms`, optional `remote`.
- Documented behaviour: *"Windows and WebViews which are part of more than one capability
  effectively merge the security boundaries and permissions of all involved capabilities."*

**Adopted:** a single `main` capability listing only the permissions actually used. No wildcard
window targeting.

### 2.2 Filesystem scopes
Source: <https://v2.tauri.app/plugin/file-system/>

- Scopes are declared per-permission with `allow` / `deny` path lists; documented rule:
  *"deny take precedence over allow so if a path is denied by a scope, it will be blocked at
  runtime even if it is allowed by another scope."*
- Path variables available include `$APPDATA`, `$APPLOCALDATA`, `$APPCONFIG`, `$APPLOG`,
  `$HOME`, `$DOCUMENT`, `$DOWNLOAD`, `$DESKTOP`, `$TEMP` and others.
- Runtime scope extension exists via the Rust `FsExt` trait: `app.fs_scope().allow_directory(...)`.
- macOS note recorded in the docs: no write access to `$RESOURCES` by default.

**Adopted:** the app's own database and backups live under `$APPDATA`. Arbitrary user files are
**never** read by the webview — see §2.3 and ADR-0007.

**Rejected:** granting `fs:default` or any broad `$HOME` read scope to the frontend. The frontend
gets no general filesystem read permission at all.

### 2.3 Content Security Policy
Source: <https://v2.tauri.app/security/csp/>

- CSP is set in `tauri.conf.json` and *"is only enabled if set on the Tauri configuration file"* —
  there is no useful implicit default, it must be written explicitly.
- Tauri appends its own nonces and hashes at compile time to bundled assets automatically.
- Guidance for local-only apps: restrict to `'self'` plus the custom `asset:` protocol, and avoid
  remote content entirely.

**Adopted:** an explicit restrictive CSP with no remote origins, since the product requirement is
zero network dependency after installation.

### 2.4 The official SQL plugin — evaluated and rejected
Source: <https://v2.tauri.app/plugin/sql/>

- Supports SQLite/MySQL/PostgreSQL; migrations are Rust structs with unique version numbers and
  Up/Down direction; *"all migrations are executed within a transaction"*.
- The JS API surface is `load` / `execute` / `select` / `close` with `$1`-style parameters.

**Rejected for this project.** The plugin's model puts raw SQL strings in the frontend and exposes
`execute` to the webview. That directly conflicts with two requirements in the brief: a single
validation boundary, and Tauri commands that validate input and return typed errors. It also
offers no documented explicit transaction-control API, which we need for atomic multi-row task
moves. **Adopted instead:** typed Tauri commands backed by `rusqlite` 0.40.1 in Rust, with the SQL
never leaving the backend. The plugin's migration design (monotonic integer versions, each applied
inside a transaction) is a good pattern and is adopted, reimplemented locally. See ADR-0002 and
ADR-0003.

---

## 3. End-to-end testing on macOS — a real constraint

Sources:
- <https://v2.tauri.app/develop/tests/webdriver/>
- <https://webdriver.io/docs/desktop-testing/tauri/platform-support/>
- <https://github.com/danielraffel/tauri-webdriver> (background on why the gap exists)
- <https://danielraffel.me/2026/02/14/i-built-a-webdriver-for-wkwebview-tauri-apps-on-macos/>

Findings, quoted from the Tauri docs:

> "Driven directly, only Windows and Linux are supported on desktop, as macOS has no WKWebView
> driver tool available."

> "By default the service runs an embedded WebDriver server inside your app, so no external driver
> is needed on any platform — and this is how macOS is supported."

The WebdriverIO platform-support matrix confirms macOS via an embedded provider, requiring:
- `cargo add tauri-plugin-wdio-webdriver` in `src-tauri`
- registration behind `#[cfg(debug_assertions)]`
- `"wdio-webdriver:default"` in the capability permissions
- no explicit `driverProvider` configuration (it auto-detects on macOS)

**Consequence: Playwright cannot drive the packaged Tauri app on macOS.** Apple ships no WebDriver
for WKWebView. This is a genuine conflict with the requested stack and is escalated as a decision,
not silently resolved. Options and the recommendation are in `docs/design-decisions.md` §Testing
and ADR-0008.

---

## 4. Accessibility references

### 4.1 dnd-kit accessibility
Source: <https://dndkit.com/guides/accessibility> (the `docs.dndkit.com` host 301-redirects here)

- Draggables get `role="button"`, `aria-roledescription="draggable"`, and `aria-describedby`
  pointing at instruction text.
- Default instructions: *"To pick up a draggable item, press space or enter. While dragging, use
  arrow keys to move the item. Press space or enter again to drop, or escape to cancel."*
  Customisable via `screenReaderInstructions` on `<DndContext>`.
- Live-region `announcements` fire on drag start / over / end / cancel and are customisable.
  The docs explicitly recommend **position-based wording** ("position 2 of 5") over raw indices.
- `KeyboardSensor` is enabled by default: Space/Enter to pick up and drop, arrow keys to move,
  Escape to cancel. Arrow keys move 25px by default; `useSortable` ships an augmented coordinate
  getter that jumps to the next sortable element instead.

**Adopted:** dnd-kit's sensors, plus custom `screenReaderInstructions` and `announcements` written
in board vocabulary ("Moved *Fix login bug* to In Progress, position 2 of 5"). **Not adopted as
sufficient on its own:** dnd-kit keyboard dragging still requires the user to find and focus the
card. We additionally ship an explicit "Move task…" command (menu + shortcut) so drag is never the
only path — required by the brief and by WCAG 2.2.

### 4.2 Rearrangeable list pattern
Source: <https://www.w3.org/WAI/ARIA/apg/patterns/listbox/examples/listbox-rearrangeable/>

- `role="listbox"` / `role="option"`, `aria-activedescendant` to move a virtual cursor while DOM
  focus stays on the container, `aria-selected`, `tabindex="0"` on the container.
- Move actions bound to Alt+Arrow and surfaced via `aria-keyshortcuts`.
- Live regions give *"confirmation of completed actions"*.
- Keyboard focus styling must be visually distinct from selection styling.

**Adopted:** `aria-keyshortcuts` on the move controls, live-region confirmation after every move,
and visually distinct focus vs. selection treatment in the design tokens.

**Rejected:** modelling a column as a `listbox` with `aria-activedescendant`. Our cards are
composite widgets containing their own interactive controls (checkbox, menu button), which the
`option` role forbids. We use a roving-tabindex list of composite cards instead, and borrow the
pattern's *announcement* and *shortcut* conventions rather than its roles.

### 4.3 Modal dialog pattern
Source: <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (or `aria-label`).
- Focus moves into the dialog on open and returns to the invoking element on close.
- Escape closes; Tab/Shift+Tab cycle within the dialog only.
- For destructive actions, initial focus should go to the **least** destructive control.

**Adopted:** Radix Dialog / AlertDialog implement trapping, restoration and Escape. We add the
"focus the safe option first" rule to our confirmation dialog, which Radix does not decide for us.

---

## 5. SQLite

Source: <https://www.sqlite.org/foreignkeys.html>

- `PRAGMA foreign_keys = ON;` — documented default is **off** (`0`) for backwards compatibility,
  and it is a **per-connection** setting, not a property of the database file.
- Cannot be toggled inside a multi-statement transaction.
- Supported `ON DELETE` actions: NO ACTION, RESTRICT, SET NULL, SET DEFAULT, CASCADE.

**Adopted:** every connection sets `PRAGMA foreign_keys = ON` at open time, verified by an
integration test that asserts the pragma reads back as 1 and that a violating insert fails.
This is exactly the kind of setting that silently degrades if only configured once by hand.

---

## 6. Styling and component sources

### 6.1 Tailwind CSS v4
Source: <https://tailwindcss.com/docs/upgrade-guide>

- v4 uses the dedicated `@tailwindcss/vite` plugin for Vite projects.
- Configuration is CSS-first: `@import "tailwindcss";` plus a `@theme { --color-…: … }` block.
  JS config files still work but are no longer auto-detected and need an explicit `@config`.

**Adopted:** CSS-first `@theme`. This is a good fit for the requirement to define design tokens,
because the tokens become real CSS custom properties usable outside Tailwind too.

### 6.2 shadcn/ui
Source: <https://ui.shadcn.com/docs/installation/vite>

- Install `tailwindcss` + `@tailwindcss/vite`, set `@/*` path alias in both `tsconfig.json` and
  `tsconfig.app.json` and in `vite.config.ts`, then `shadcn@latest init` and `shadcn@latest add`.
- shadcn/ui is not a dependency — it copies component source into the repo (MIT).

**Adopted:** shadcn/ui as a source of Radix-wired, accessible component *source code* we own and
restyle with our own tokens. Licence: MIT, recorded in `THIRD_PARTY_NOTICES.md`.

**Rejected:** building a second in-house design-system layer on top of shadcn/Radix. The tokens
live in CSS; the components stay close to upstream so they remain reviewable and updatable.

---

## 7. Product references studied

These were studied for **interaction and information-design patterns only**. No markup, CSS,
imagery, icon, or font from any of them is copied into this project.

### 7.1 GitHub Projects — successfully read
Source: <https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/changing-the-layout-of-a-view>

- Columns are defined by choosing a *field* as the column field — Status, or any single-select or
  iteration field.
- Dragging an item between columns *"adjust[s] the value of those items to match the column"* —
  i.e. the column is a projection of a field, not a container.

**Adopted (conceptually):** a task's column membership is authoritative data (`tasks.column_id`),
and moving a card is a write to that field plus its position — not a mutation of a client-side
array. **Rejected:** configurable group-by fields for v1; our columns are first-class user-created
records with names, WIP limits and order, which better matches a personal workflow than a
projection over an enum.

### 7.2 Plane — successfully read
Source: <https://docs.plane.so/core-concepts/issues/overview>

- Work items carry: sequential identifier, title, description, type, state, priority, assignees,
  labels, start/due dates, time estimates, parent/sub-item hierarchy, dependencies, relations,
  links, attachments, timestamps.
- Layouts: List, Board, Calendar, Timeline.

**Adopted:** the sequential per-project human-readable identifier (e.g. `KAN-14`). It is genuinely
useful for referring to a task in a commit message and costs one integer column. Also adopted:
distinguishing *labels* (many, user-defined, coloured) from *priority* (one, fixed scale).
**Rejected:** assignees, dependencies, relations, cycles, modules, customers, work-item types.
Assignees and collaboration features are explicitly out of scope for a single-user local app, per
the brief. Dependencies are deferred to a later milestone.

### 7.3 Vikunja — successfully read
Sources: <https://vikunja.io/features/>

- Kanban view, labels, priorities, due dates, attachments, filters and **saved filters**, relations.
- Licence stated on the page: **AGPLv3**.

**Adopted (conceptually):** saved filters. A personal board accumulates views like "due this week"
or "blocked, high priority", and re-typing a filter every day is friction. Recorded as a v1 feature.
**Rejected:** any code reuse. Vikunja is AGPLv3; this project does not adopt AGPL-licensed code, so
Vikunja informed *what features matter*, and nothing else. The `vikunja.io/docs/what-is-vikunja/`
URL returned 404 and was not read.

### 7.4 Linear — partially read, low yield
Source: <https://linear.app/method>

The page fetched successfully but is a navigation hub; it yielded only that Linear favours writing
*issues* over user stories, and organises around Direction / Building. The attempted
`https://linear.app/docs/keyboard-shortcuts` returned **404 and was not read**.

**Honest statement:** I did **not** obtain substantive interaction documentation from Linear. This
project therefore claims **no** design lineage from Linear. The keyboard-first conventions used
here (`⌘K` command palette, single-key shortcuts on a focused item, `?` for shortcut help) are
drawn from the WAI-ARIA APG and from long-standing desktop convention, not from a Linear source I
can cite. Any resemblance is convergence on common conventions, and the design brief explicitly
forbids copying Linear wholesale.

### 7.5 Height and Notion — not read
- `https://height.app/` — fetch failed (socket closed). **Not read; nothing adopted.**
- `https://www.notion.com/help/kanban-boards` — **404. Not read; nothing adopted.**

No inspiration is claimed from either product. If these are important references, they should be
re-attempted; the brief's requirement is satisfied by the three references that *were* read
(GitHub Projects, Plane, Vikunja) plus the W3C and vendor documentation above.

---

## 8. Ordering strategy research

Sources:
- <https://www.npmjs.com/package/fractional-indexing>
- <https://github.com/rocicorp/fractional-indexing>
- <https://www.npmjs.com/package/fractional-indexing-jittered>
- <https://github.com/sqliteai/fractional-indexing>

Findings: fractional indexing assigns lexicographically sortable string keys so a move rewrites
**one** row (O(1)) instead of renumbering the list. Two documented downsides: keys grow in length
when repeatedly inserting into the same narrow interval, so long-running systems *"need a
rebalancing step that periodically rewrites the ordering keys"*; and jitter is recommended to avoid
collisions **between concurrent writers**.

**Rejected for v1.** The collision-avoidance benefit exists to serve multiple concurrent writers —
we have exactly one, on one machine, with no sync. Meanwhile the unbounded-key-growth failure mode
requires a rebalancer that is itself a source of bugs. **Adopted instead:** transactional dense
integer reindexing scoped to a single column, enforced by a `UNIQUE(column_id, position)` index so
that a duplicate or gap is impossible at the database level rather than merely unlikely. A column
holds tens to low hundreds of tasks; rewriting them inside one local SQLite transaction is
sub-millisecond. Full reasoning, the two-phase update that avoids intermediate UNIQUE collisions,
and the measured threshold at which we would revisit this are in **ADR-0004**.

---

## 9. Licence summary for anything incorporated

| Item | Licence | How it is used |
|---|---|---|
| shadcn/ui component source | MIT | Source copied into `src/components/ui/`, restyled |
| Radix UI primitives | MIT | npm dependency |
| dnd-kit (`core`, `sortable`, `utilities`) | MIT | npm dependency |
| Lucide icons (`lucide-react`) | ISC | npm dependency; the only icon set used |
| cmdk | MIT | npm dependency (command palette) |
| react-day-picker | MIT | npm dependency (date picker) |
| Zod, Zustand, TanStack Query, react-markdown | MIT | npm dependencies |
| rusqlite | MIT | Cargo dependency |
| Tauri | Apache-2.0 / MIT | Desktop shell |
| Inter (if bundled) | SIL OFL 1.1 | Font — **licence to be re-verified before bundling** |

No proprietary asset, icon, font, screenshot, or stylesheet from Linear, Trello, Height, Plane,
Vikunja, GitHub, or Notion is included in this repository.

**Outstanding licence check:** the Inter font licence has *not* been verified from an official URL
in this session. It must be confirmed at <https://rsms.me/inter/> or the GitHub repository before
the font is bundled, or the app must fall back to system fonts. Tracked as a risk.

---

## 10. Environment facts established locally

| Fact | Value | How established |
|---|---|---|
| OS | macOS 26.6, arm64 | `sw_vers`, `uname -m` |
| Node / npm | 24.18.0 / 11.16.0 | `node -v`, `npm -v` |
| Xcode Command Line Tools | `/Library/Developer/CommandLineTools` | `xcode-select -p` |
| Rust | 1.97.1, cargo 1.97.1 | installed this session via Homebrew `rustup` (keg-only) |

Note: Homebrew's `rustup` formula is **keg-only** and no longer ships `rustup-init`. The toolchain
lives at `~/.rustup` and `rustup` itself at `/opt/homebrew/opt/rustup/bin`. This must be on `PATH`
for `tauri build` to find `cargo` — documented in `README.md` prerequisites.
