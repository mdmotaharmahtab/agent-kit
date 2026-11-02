#!/usr/bin/env node
// Claude Code PreCompact hook.
//
// Compaction is the moment the checkpoint has to be trustworthy, because
// everything after it is reconstructed from files rather than from chat. This
// hook runs a deliberately cheap check - work/CHECKPOINT.md exists and is
// non-empty - and writes a bounded receipt. It never runs the full validator:
// `node scripts/work.mjs check` takes far longer than a hook budget, and a slow
// hook that blocks compaction would be worse than a stale one.
//
// Failure policy: always exit 0. A problem is reported on stdout so it is
// visible in the transcript, and recorded in the receipt. Compaction is never
// blocked by this hook. The deterministic fallback is `node scripts/work.mjs
// check` plus re-reading the "Read first" files and the checkpoint after
// compaction.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isDirectInvocation,
  projectRoot,
  readStdinJson,
  writeHookReceipt,
} from "./hook-support.mjs";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

/** The live state: the coordinator's checkpoint. */
export const LIVE_STATE_FILES = Object.freeze([{ path: "work/CHECKPOINT.md" }]);

/** Check that every live-state file exists and is non-empty, one finding per file. */
export function validateLiveStateFiles(root, files = LIVE_STATE_FILES) {
  return files.map((file) => {
    try {
      const text = readFileSync(resolve(root, file.path), "utf8");
      if (text.trim().length === 0) return { path: file.path, ok: false, problem: "file is empty" };
      return { path: file.path, ok: true, bytes: Buffer.byteLength(text, "utf8") };
    } catch (error) {
      return { path: file.path, ok: false, problem: error.message };
    }
  });
}

export function summarize(results) {
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0)
    return {
      ok: true,
      line: `PreCompact: checkpoint present (${results.map((r) => r.path).join(", ")}).`,
    };
  return {
    ok: false,
    line:
      "PreCompact: the checkpoint has a problem; compaction continues, fix it right after. " +
      failed.map((result) => `${result.path}: ${result.problem}`).join(" | "),
  };
}

async function main() {
  const payload = await readStdinJson();
  const root = projectRoot(HOOK_DIR);
  const results = validateLiveStateFiles(root);
  const summary = summarize(results);
  process.stdout.write(`${summary.line}\n`);
  writeHookReceipt(
    root,
    "compaction",
    {
      kind: "precompact_live_state",
      recordedAt: new Date().toISOString(),
      trigger: payload?.trigger ?? null,
      decision: summary.ok ? "pass" : "report",
      results,
    },
    { prefix: "precompact" },
  );
  process.exit(0);
}

// Tests import the helpers above; only a direct run performs the hook.
if (isDirectInvocation(import.meta.url)) {
  main().catch((error) => {
    process.stdout.write(
      `PreCompact: hook could not run, compaction continues: ${error.message}\n`,
    );
    process.exit(0);
  });
}
