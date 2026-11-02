#!/usr/bin/env node
// Claude Code SessionStart hook, matcher "compact".
//
// After compaction the session keeps a generated summary, which this project
// does not treat as authority. This hook prints the recovery context that
// `scripts/context-hook.mjs` renders for Codex - the primary objective and the
// queue from work/CHECKPOINT.md, plus the open items - so both tools recover
// from one renderer, inside the same byte budget.
//
// Failure policy: always exit 0. If the context cannot be rendered, it says so
// and points at the manual fallback.

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  isDirectInvocation,
  projectRoot,
  readStdinJson,
  writeHookReceipt,
} from "./hook-support.mjs";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

async function main() {
  const payload = await readStdinJson();
  const root = projectRoot(HOOK_DIR);
  let context;
  try {
    const renderer = await import(pathToFileURL(resolve(root, "scripts/context-hook.mjs")).href);
    context = renderer.renderRecoveryContext({
      root,
      input: payload ?? { source: "compact" },
    }).context;
  } catch (error) {
    process.stdout.write(
      `Recovery: the context could not be rendered (${error.message}). Read work/CHECKPOINT.md by hand and run \`node scripts/work.mjs check\`.\n`,
    );
    process.exit(0);
  }
  process.stdout.write(`${context}\n`);
  writeHookReceipt(
    root,
    "compaction",
    {
      kind: "sessionstart_compact_recovery",
      recordedAt: new Date().toISOString(),
      decision: "injected",
      lines: context.split("\n").length,
    },
    { prefix: "sessionstart" },
  );
  process.exit(0);
}

// Only a direct run performs the hook.
if (isDirectInvocation(import.meta.url)) {
  main().catch((error) => {
    process.stdout.write(`Recovery: hook could not run: ${error.message}\n`);
    process.exit(0);
  });
}
