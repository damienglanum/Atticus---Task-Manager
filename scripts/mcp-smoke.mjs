import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pathWithCargo } from "./rust-toolchain.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const explicitExecutable = process.argv[2];
if (explicitExecutable === undefined) {
  execFileSync("cargo", ["build", "--quiet"], {
    cwd: join(repositoryRoot, "src-tauri"),
    env: { ...process.env, PATH: pathWithCargo() },
    stdio: "inherit",
  });
}
const executable = resolve(
  explicitExecutable ?? join(repositoryRoot, "src-tauri", "target", "debug", "Atticus"),
);

if (!existsSync(executable)) {
  throw new Error(
    `Atticus executable not found at ${executable}. Build that executable or pass a different path.`,
  );
}

const profile = mkdtempSync(join(tmpdir(), "atticus-mcp-smoke-"));
const processHandle = spawn(executable, ["--mcp", "--data-dir", profile], {
  cwd: repositoryRoot,
  stdio: ["pipe", "pipe", "pipe"],
});

let nextId = 1;
let stdoutBuffer = "";
let stderr = "";
const pending = new Map();

function rejectPending(error) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(error);
  }
  pending.clear();
}

processHandle.stderr.setEncoding("utf8");
processHandle.stderr.on("data", (chunk) => {
  stderr += chunk;
});

processHandle.stdout.setEncoding("utf8");
processHandle.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  for (;;) {
    const newline = stdoutBuffer.indexOf("\n");
    if (newline === -1) break;

    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      rejectPending(new Error(`MCP stdout was not JSON: ${line}`, { cause: error }));
      continue;
    }

    if (message.id === undefined) continue;
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  }
});

processHandle.on("error", rejectPending);
processHandle.on("exit", (code, signal) => {
  if (pending.size > 0) {
    rejectPending(
      new Error(
        `Atticus MCP exited before replying (code ${String(code)}, signal ${String(signal)}). ${stderr}`,
      ),
    );
  }
});

function request(method, params = {}) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Timed out waiting for ${method}. ${stderr}`));
    }, 10_000);
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
    processHandle.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

function notify(method, params = {}) {
  processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function callTool(name, args = {}) {
  return request("tools/call", { name, arguments: args });
}

async function waitForExit() {
  if (processHandle.exitCode !== null) return processHandle.exitCode;
  return new Promise((resolveExit) => {
    processHandle.once("exit", (code) => resolveExit(code));
  });
}

let failure;

try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "atticus-mcp-smoke", version: "1.0.0" },
  });
  assert.equal(initialized.serverInfo.name, "atticus");
  assert.equal(initialized.serverInfo.title, "Atticus Task Workspace");
  assert.match(initialized.instructions, /not an automatic activity logger/i);
  assert.match(initialized.instructions, /expected_updated_at/);
  assert.match(initialized.instructions, /project note for durable long-form context/i);
  assert.ok(initialized.capabilities.tools);

  notify("notifications/initialized");

  const listed = await request("tools/list");
  assert.equal(listed.tools.length, 24);
  const noteToolNames = listed.tools
    .map((tool) => tool.name)
    .filter((name) => name.includes("_note"))
    .sort();
  assert.deepEqual(noteToolNames, [
    "atticus_create_note",
    "atticus_get_note",
    "atticus_list_notes",
    "atticus_search_notes",
    "atticus_update_note",
  ]);
  assert.equal(
    listed.tools.some((tool) => tool.name === "atticus_delete_note"),
    false,
  );
  for (const tool of listed.tools) {
    assert.match(tool.name, /^atticus_[a-z_]+$/);
    assert.ok(tool.title);
    assert.ok(tool.description);
    assert.ok(tool.inputSchema);
    assert.ok(tool.outputSchema);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
    assert.equal(typeof tool.annotations.destructiveHint, "boolean");
    assert.equal(typeof tool.annotations.idempotentHint, "boolean");
    assert.equal(typeof tool.annotations.openWorldHint, "boolean");
  }

  const status = await callTool("atticus_connection_status");
  assert.equal(status.isError, false);
  assert.equal(status.structuredContent.access, "disabled");
  assert.equal(status.structuredContent.databasePath, undefined);
  assert.match(status.structuredContent.writeScope, /project notes/i);
  assert.equal(JSON.parse(status.content[0].text).access, "disabled");

  const guide = await callTool("atticus_workflow_guide");
  assert.equal(guide.isError, false);
  assert.match(guide.structuredContent.instructions, /server is passive/i);
  assert.equal(JSON.parse(guide.content[0].text).version, guide.structuredContent.version);

  const forbiddenRead = await callTool("atticus_list_workspace");
  assert.equal(forbiddenRead.isError, true);
  assert.equal(forbiddenRead.structuredContent.error.kind, "conflict");
  assert.equal(forbiddenRead.structuredContent.mutationMayHaveCommitted, false);
  assert.match(forbiddenRead.structuredContent.recovery, /AI access/i);

  const forbiddenNoteRead = await callTool("atticus_list_notes", { project_id: "opaque-id" });
  assert.equal(forbiddenNoteRead.isError, true);
  assert.equal(forbiddenNoteRead.structuredContent.error.kind, "conflict");
  assert.match(forbiddenNoteRead.structuredContent.recovery, /AI access/i);

  process.stdout.write(
    `Atticus MCP smoke test passed: initialize, ${listed.tools.length} tools, structured success, and structured permission recovery.\n`,
  );
} catch (error) {
  failure = error;
} finally {
  processHandle.stdin.end();
  const exitCode = await waitForExit();
  rmSync(profile, { recursive: true, force: true });
  if (exitCode !== 0 && failure === undefined) {
    failure = new Error(`Atticus MCP exited with code ${String(exitCode)}. ${stderr}`);
  }
}

if (failure !== undefined) throw failure;
