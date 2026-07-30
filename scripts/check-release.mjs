/**
 * Checks the *built release artifact* for things that must not ship.
 *
 * `src-tauri/src/lib.rs` already asserts the WebDriver plugin is optional and
 * not a default feature, but that is a property of `Cargo.toml` — it proves the
 * build was configured correctly, not that the binary in front of you was built
 * that way. This reads the binary.
 *
 * Run after `npm run tauri build`:
 *
 *     node scripts/check-release.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = join(root, "src-tauri", "target", "release");
const binary = join(release, "atticus");

const problems = [];

if (!existsSync(binary)) {
  console.error(`No release binary at ${binary}. Run \`npm run tauri build\` first.`);
  process.exit(1);
}

/**
 * Strings the WebDriver plugin leaves behind when it is compiled in.
 *
 * Verified against a real `e2e` build rather than guessed: four candidates were
 * tried and only these two actually appear, so the other two would have been a
 * check of nothing dressed up as thoroughness. `--verify-markers` below re-runs
 * that check, so this list cannot rot into uselessness unnoticed.
 */
const WEBDRIVER_MARKERS = ["tauri-plugin-wdio-webdriver", "wdio-webdriver"];

/** True when `path` contains `marker` anywhere in its bytes. */
function contains(path, marker) {
  try {
    // `strings` would be nicer but is not everywhere; grep on the raw bytes is.
    execFileSync("grep", ["-q", "-a", marker, path]);
    return true;
  } catch {
    return false;
  }
}

// A detector nobody has seen detect anything is not evidence. Run against the
// end-to-end build, where the plugin *is* compiled in, every marker must fire.
if (process.argv.includes("--verify-markers")) {
  const e2eBinary = join(root, "src-tauri", "target", "e2e", "e2e", "atticus");
  if (!existsSync(e2eBinary)) {
    console.error(`No e2e binary at ${e2eBinary}. Run \`npm run e2e\` first.`);
    process.exit(1);
  }

  const missing = WEBDRIVER_MARKERS.filter((marker) => !contains(e2eBinary, marker));
  if (missing.length > 0) {
    console.error(
      `✗ These markers are absent from a build that DOES contain the WebDriver ` +
        `server: ${missing.join(", ")}. They cannot detect anything and must be ` +
        `replaced.`,
    );
    process.exit(1);
  }

  console.log(`All ${WEBDRIVER_MARKERS.length} markers fire against the e2e build, as they must.`);
  process.exit(0);
}

const found = WEBDRIVER_MARKERS.filter((marker) => contains(binary, marker));

if (found.length > 0) {
  problems.push(
    `The release binary contains WebDriver markers: ${found.join(", ")}. ` +
      "The e2e-webdriver feature must never be enabled for a release build — " +
      "it opens a listening socket that can drive the application window.",
  );
}

// Only the .dmg is bundled. Tauri still builds the .app because a dmg is made
// from one, then removes it — `targets: ["dmg"]` in `tauri.conf.json`, so that
// installing leaves one copy of the application on the machine rather than a
// loose .app beside the disk image it came out of.
//
// Matched by extension rather than by name: the filename carries the version and
// the architecture, and hardcoding either makes this fail on the next release
// for no reason.
const dmgDir = join(release, "bundle", "dmg");
const dmgs = existsSync(dmgDir) ? readdirSync(dmgDir).filter((name) => name.endsWith(".dmg")) : [];
if (dmgs.length === 0) {
  problems.push(`No .dmg in ${dmgDir}.`);
}

const looseApps = join(release, "bundle", "macos");
if (existsSync(looseApps) && readdirSync(looseApps).some((name) => name.endsWith(".app"))) {
  problems.push(
    `A .app was left in ${looseApps}. Only the .dmg is meant to ship, so a stale ` +
      `bundle here means an old build is still on disk — delete it before shipping.`,
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}

const size = (statSync(binary).size / 1_000_000).toFixed(1);
console.log(`Release binary is clean: no WebDriver server, ${size} MB.`);
console.log(`Bundle present: ${dmgs.join(", ")} (no loose .app).`);
