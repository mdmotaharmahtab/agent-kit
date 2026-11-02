// Shared helpers for the project-local Claude Code hooks.
//
// Kept deliberately small: project root resolution, stdin parsing that never
// throws, and a bounded receipt writer under .local/runtime/<area>/ (gitignored,
// same convention as the lane-guard receipts). Receipts record decisions and
// paths only - never prompts, file contents, transcripts, or credentials.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const MAX_RECEIPT_BYTES = 8 * 1024;

/**
 * True only when this module's importer is the script node was asked to run.
 * Every hook gates its `main()` on this, so tests can import the logic without
 * the hook blocking forever on a stdin that will never arrive.
 */
export function isDirectInvocation(importMetaUrl) {
  try {
    if (!process.argv[1]) return false;
    return resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }
}

export function projectRoot(hookDir) {
  return process.env.CLAUDE_PROJECT_DIR
    ? resolve(process.env.CLAUDE_PROJECT_DIR)
    : resolve(hookDir, "..", "..");
}

export async function readStdinJson() {
  try {
    if (process.stdin.isTTY) return null;
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function receiptDirectory(root, area) {
  return resolve(root, ".local", "runtime", area);
}

/** Write a bounded JSON receipt. Never throws; returns the path or null. */
export function writeHookReceipt(root, area, body, { prefix = "receipt" } = {}) {
  try {
    const directory = receiptDirectory(root, area);
    mkdirSync(directory, { recursive: true });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 8);
    const absolute = resolve(directory, `${stamp}-${prefix}-${digest}.json`);
    let text = `${JSON.stringify(body, null, 2)}\n`;
    if (Buffer.byteLength(text, "utf8") > MAX_RECEIPT_BYTES)
      text = `${JSON.stringify({ truncated: true, recordedAt: body?.recordedAt ?? null, decision: body?.decision ?? null }, null, 2)}\n`;
    writeFileSync(absolute, text, "utf8");
    return absolute;
  } catch {
    return null;
  }
}

/**
 * Read the most recent receipt in an area that satisfies `predicate`. Used by the
 * autosave hook to rate-limit itself without any external state store.
 */
export function latestReceipt(root, area, predicate = () => true) {
  try {
    const directory = receiptDirectory(root, area);
    if (!existsSync(directory)) return null;
    const names = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse();
    for (const name of names) {
      try {
        const value = JSON.parse(readFileSync(resolve(directory, name), "utf8"));
        if (predicate(value)) return value;
      } catch {
        // A corrupt receipt is skipped, never fatal.
      }
    }
    return null;
  } catch {
    return null;
  }
}
