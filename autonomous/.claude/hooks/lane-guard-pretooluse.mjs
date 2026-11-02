#!/usr/bin/env node
// Claude Code PreToolUse lane guard for protected paths.
//
// Configured in .claude/settings.json for the matcher "Edit|Write|MultiEdit".
// It reads the hook payload from stdin and refuses an edit to any path listed
// in `autonomous.config.json` under `lanes.protectedPaths` unless the call carries
// a support-lane marker:
//
//   1. the payload identifies a subagent whose `agent_type` is one of
//      `lanes.supportAgentTypes` (Claude Code sets `agent_id`/`agent_type` only
//      for subagent tool calls), or
//   2. an item under work/items that is in progress or in review, and owned by
//      one of those support agents, lists the target path in its `ownedPaths`,
//      or
//   3. a recorded, unexpired override exists at
//      .local/runtime/lane-guard-override.json.
//
// Failure policy: a genuine violation exits 2, which blocks the tool call and
// hands stderr back to the model. Any internal error exits 1 instead, which
// Claude Code treats as a non-blocking notice, so a bug in this hook can never
// wedge the project; `node scripts/work.mjs check` remains the deterministic
// backstop that still fails on the same condition.
//
// Receipts under .local/runtime/lane-guard/ record decisions and paths only.
// They never contain prompts, file contents, transcripts, or credentials.

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CLAUDE_PROJECT_DIR
  ? resolve(process.env.CLAUDE_PROJECT_DIR)
  : resolve(HOOK_DIR, "..", "..");

const GUARDED_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function targetPaths(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return [];
  const paths = [];
  for (const key of ["file_path", "filePath", "notebook_path", "path"]) {
    if (typeof toolInput[key] === "string") paths.push(toolInput[key]);
  }
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (edit && typeof edit.file_path === "string") paths.push(edit.file_path);
    }
  }
  return [...new Set(paths)];
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write("lane guard: unreadable hook payload; allowing the call.\n");
    process.exit(1);
  }

  const guard = await import(pathToFileURL(resolve(ROOT, "scripts/lane-guard.mjs")).href);
  const {
    isKitPath,
    normalizeRepoPath,
    matchesPattern,
    readItems,
    readOverride,
    supportAgentTypes,
    supportOwnership,
    writeLaneGuardReceipt,
  } = guard;

  if (!GUARDED_TOOLS.has(payload.tool_name)) process.exit(0);

  const kitTargets = targetPaths(payload.tool_input)
    .map((path) => normalizeRepoPath(path, { root: ROOT }))
    .filter((path) => path && isKitPath(path, { root: ROOT }));
  if (kitTargets.length === 0) process.exit(0);

  const allowedTypes = new Set(supportAgentTypes({ root: ROOT }));
  const agentType = typeof payload.agent_type === "string" ? payload.agent_type : null;
  if (agentType && allowedTypes.has(agentType)) process.exit(0);

  const ownership = supportOwnership(readItems({ root: ROOT }).items, { root: ROOT });
  const unowned = kitTargets.filter(
    (path) =>
      !ownership.some((owner) => owner.patterns.some((pattern) => matchesPattern(path, pattern))),
  );
  if (unowned.length === 0) process.exit(0);

  const override = readOverride({ root: ROOT });
  if (override.active) {
    const scope = override.override.paths;
    const stillBlocked = scope
      ? unowned.filter((path) => !scope.some((pattern) => matchesPattern(path, pattern)))
      : [];
    if (stillBlocked.length === 0) {
      writeLaneGuardReceipt(
        {
          kind: "pretooluse_override_used",
          recordedAt: new Date().toISOString(),
          decision: "allow",
          tool: payload.tool_name,
          paths: unowned,
          override: {
            recordedBy: override.override.recordedBy,
            expiresAt: override.override.expiresAt,
            reason: override.override.reason,
          },
          agentType,
        },
        { root: ROOT },
      );
      process.stderr.write(
        `lane guard: allowed by the recorded override from ${override.override.recordedBy} (expires ${override.override.expiresAt}).\n`,
      );
      process.exit(0);
    }
  }

  const receipt = writeLaneGuardReceipt(
    {
      kind: "pretooluse_block",
      recordedAt: new Date().toISOString(),
      decision: "deny",
      tool: payload.tool_name,
      paths: unowned,
      agentType,
      isSubagent: typeof payload.agent_id === "string",
      supportItems: ownership.map((owner) => owner.id),
    },
    { root: ROOT },
  );

  const [supportAgent = "a support"] = [...allowedTypes];
  process.stderr.write(
    [
      `lane guard: blocked ${payload.tool_name} on protected path(s): ${unowned.join(", ")}.`,
      "Autonomous kit, documentation, archive, instruction, validator, and hook work belongs to a disjoint",
      `${supportAgent} subagent, not to the product lane. Delegate this change to it, or list these`,
      `paths in the ownedPaths of an item in progress or in review that ${supportAgent} owns,`,
      "or record a bounded, expiring override in .local/runtime/lane-guard-override.json.",
      receipt ? `Receipt: ${receipt}` : "Receipt could not be written.",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

main().catch((error) => {
  process.stderr.write(`lane guard: internal error, allowing the call: ${error.message}\n`);
  process.exit(1);
});
