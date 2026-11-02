#!/usr/bin/env node
// Claude Code PreToolUse guard for commit identity.
//
// Configured in .claude/settings.json for the matcher "Bash". When the command
// would create a commit, it verifies that the effective author and committer
// email is the address configured in `autonomous.config.json` under
// `git.commitEmail`, and that the command is not overriding the identity
// inline. An unset `git.commitEmail` disables the check entirely.
//
// Failure policy matches the lane guard: a genuine violation exits 2 and blocks
// the call; any internal error exits 1, a non-blocking notice, so a bug here can
// never stop the project committing. `node scripts/work.mjs check` reports the
// same condition as a hard error, and the documented manual fallback is
// `git var GIT_AUTHOR_IDENT && git var GIT_COMMITTER_IDENT` before committing.

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CLAUDE_PROJECT_DIR
  ? resolve(process.env.CLAUDE_PROJECT_DIR)
  : resolve(HOOK_DIR, "..", "..");

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write("commit-identity guard: unreadable payload; allowing.\n");
    process.exit(1);
  }
  if (payload.tool_name !== "Bash") process.exit(0);
  const commandLine = payload.tool_input?.command;
  if (typeof commandLine !== "string") process.exit(0);

  const guard = await import(pathToFileURL(resolve(ROOT, "scripts/lane-guard.mjs")).href);
  if (!guard.isCommitCommand(commandLine)) process.exit(0);

  const identity = guard.evaluateCommitIdentity({ root: ROOT, commandLine });
  if (identity.ok) process.exit(0);

  const receipt = guard.writeLaneGuardReceipt(
    {
      kind: "pretooluse_commit_identity_block",
      recordedAt: new Date().toISOString(),
      decision: "deny",
      problems: identity.problems,
      observed: identity.observed,
      requiredEmail: identity.requiredEmail,
    },
    { root: ROOT },
  );

  process.stderr.write(
    [
      "commit-identity guard: blocked this commit.",
      ...identity.problems.map((problem) => `  - ${problem}`),
      `Every commit in this project must use ${identity.requiredEmail}.`,
      "Fix the configured identity and run the command again.",
      receipt ? `Receipt: ${receipt}` : "Receipt could not be written.",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

main().catch((error) => {
  process.stderr.write(
    `commit-identity guard: internal error, allowing the call: ${error.message}\n`,
  );
  process.exit(1);
});
