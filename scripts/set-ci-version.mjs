#!/usr/bin/env node
/** Gives every automatic release a real, monotonically increasing SemVer. */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const version = process.argv[2];

if (version === undefined || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-ci-version.mjs <semver>");
  process.exit(2);
}

for (const relative of ["package.json", "src-tauri/tauri.conf.json"]) {
  const path = resolve(root, relative);
  const document = JSON.parse(readFileSync(path, "utf8"));
  document.version = version;
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

const cargoPath = resolve(root, "src-tauri", "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
const nextCargo = cargo.replace(/(^\[package\][\s\S]*?^version = ")[^"]+("$)/m, `$1${version}$2`);
if (nextCargo === cargo) {
  throw new Error("Could not locate [package].version in src-tauri/Cargo.toml");
}
writeFileSync(cargoPath, nextCargo);

console.log(`CI build version set to ${version}`);
