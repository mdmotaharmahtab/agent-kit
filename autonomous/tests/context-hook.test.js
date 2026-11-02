import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { tempDir } from "./temp-dirs.js";
import { install } from "../bin/autonomous-install.mjs";
import { clearConfigCache } from "../scripts/autonomous-config.mjs";
import {
  MAX_CHECKPOINT_BYTES,
  MAX_CONTEXT_BYTES,
  MAX_STATE_FILE_BYTES,
  dispatchHook,
  extractSections,
  loadRecoveryState,
  renderContinuationDirective,
  renderRecoveryContext,
  sessionStartOutput,
} from "../scripts/context-hook.mjs";

function write(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

function checkpoint(queueRows = ["| TASK-001 | | worker, `src/**` | in progress |"]) {
  return [
    "# Checkpoint",
    "",
    "## Primary objective",
    "",
    "TASK-001: prove the parser reads real files.",
    "",
    "## Queue",
    "",
    "| Step | Waits on | Who, which files | Status |",
    "|---|---|---|---|",
    ...queueRows,
    "| Triage the review findings | TASK-001 | coordinator | open |",
    "",
    "## Log",
    "",
    "- 2026-10-11: autonomous kit installed.",
    "",
  ].join("\n");
}

function project({ withoutCheckpoint = false } = {}) {
  clearConfigCache();
  const root = tempDir("autonomous-hook-");
  write(root, "autonomous.config.json", JSON.stringify({ project: { name: "Fixture" } }));
  if (!withoutCheckpoint) write(root, "work/CHECKPOINT.md", checkpoint());
  write(
    root,
    "work/items/TASK-001.json",
    JSON.stringify({
      id: "TASK-001",
      title: "Prove the thing works",
      kind: "feature",
      status: "in_progress",
      approved: true,
      owner: "router",
      dependsOn: [],
      acceptance: ["it works"],
      evidence: [],
      blockers: [],
      nextAction: "continue",
    }),
  );
  return root;
}

describe("checkpoint sections", () => {
  it("returns the wanted sections in the requested order", () => {
    const text = "## B\n\nbeta\n\n## A\n\nalpha\n";
    expect(extractSections(text, ["A", "B"])).toBe("### A\nalpha\n\n### B\nbeta");
  });

  it("skips a section that is absent or empty", () => {
    expect(extractSections("## A\n\n## B\n\nbeta\n", ["A", "B"])).toBe("### B\nbeta");
  });
});

describe("recovery state", () => {
  it("reads the checkpoint and the items", () => {
    const state = loadRecoveryState(project());
    expect(state.objective).toBe("TASK-001");
    expect(state.tasks).toHaveLength(1);
    expect(state.queueErrors).toEqual([]);
    expect(state.notes).toEqual([]);
  });

  it("reports a missing checkpoint as a note instead of throwing", () => {
    const state = loadRecoveryState(project({ withoutCheckpoint: true }));
    expect(state.checkpoint).toBeNull();
    expect(state.objective).toBeNull();
    expect(state.notes.join(" ")).toContain("work/CHECKPOINT.md");
  });
});

describe("rendered context", () => {
  it("names the objective, the queue, and the open items", () => {
    const { context } = renderRecoveryContext({
      root: project(),
      input: { source: "compact" },
      documentationEvaluator: () => ({ due: false }),
    });
    expect(context).toContain("Fixture: bounded context recovery");
    expect(context).toContain(
      "Authority: AGENTS.md rules, work/DECISIONS.md corrections, work/items status, work/CHECKPOINT.md queue.",
    );
    expect(context).toContain("Task: TASK-001 [in_progress] Prove the thing works");
    expect(context).toContain("TASK-001: prove the parser reads real files.");
    expect(context).toContain("| Triage the review findings | TASK-001 | coordinator | open |");
    expect(context).toContain("- TASK-001 [in_progress] Prove the thing works");
    expect(context).not.toContain("autonomous kit installed");
  });

  it("stays inside the context budget", () => {
    const root = project();
    write(root, "work/CHECKPOINT.md", checkpoint([`| ${"x ".repeat(8000)} | | | |`]));
    const { context } = renderRecoveryContext({
      root,
      documentationEvaluator: () => ({ due: false }),
    });
    expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });

  it("still recovers the objective and queue when the log outgrows the read bound", () => {
    const root = project();
    const log = Array.from(
      { length: 6000 },
      (_, i) => `- 2026-10-11: finished migration step ${i}.`,
    );
    const text = `${checkpoint()}${log.join("\n")}\n`;
    expect(Buffer.byteLength(text, "utf8")).toBeGreaterThan(MAX_STATE_FILE_BYTES);
    write(root, "work/CHECKPOINT.md", text);
    const { context } = renderRecoveryContext({
      root,
      documentationEvaluator: () => ({ due: false }),
    });
    expect(context).toContain("Task: TASK-001 [in_progress] Prove the thing works");
    expect(context).toContain("| Triage the review findings | TASK-001 | coordinator | open |");
  });

  it("caps a long queue, says where the rest is, and keeps the open items", () => {
    const root = project();
    const rows = Array.from(
      { length: 80 },
      (_, i) => `| step ${i} of the long migration | | | open |`,
    );
    write(root, "work/CHECKPOINT.md", checkpoint(rows));
    const { context } = renderRecoveryContext({
      root,
      documentationEvaluator: () => ({ due: false }),
    });
    const block = context.split("## Checkpoint\n")[1].split("\n\n## Open tasks")[0];
    expect(Buffer.byteLength(block, "utf8")).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect(block).toContain("Truncated; read work/CHECKPOINT.md for the rest.");
    expect(context).toContain("- TASK-001 [in_progress] Prove the thing works");
  });

  it("survives a documentation evaluator that throws", () => {
    const { context } = renderRecoveryContext({
      root: project(),
      documentationEvaluator: () => {
        throw new Error("boom");
      },
    });
    expect(context).toContain("Primary objective");
  });
});

describe("hook dispatch", () => {
  it("returns SessionStart context and writes a receipt", () => {
    const root = project();
    const result = dispatchHook({ root, input: { hook_event_name: "SessionStart" } });
    expect(result.output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const receipts = join(root, ".local", "runtime", "context-hook");
    expect(existsSync(receipts)).toBe(true);
    expect(readdirSync(receipts).length).toBeGreaterThan(0);
  });

  it("returns a system message for compaction events", () => {
    const result = dispatchHook({
      root: project(),
      input: { hook_event_name: "PreCompact", trigger: "auto" },
      mode: "render",
    });
    expect(result.output.systemMessage).toContain("Checkpoint the current result");
  });

  it("returns additional context for a subagent start", () => {
    const result = dispatchHook({
      root: project(),
      input: { hook_event_name: "SubagentStart" },
      mode: "render",
    });
    expect(result.output.hookSpecificOutput.hookEventName).toBe("SubagentStart");
  });

  it("has a directive for every event it accepts", () => {
    for (const event of [
      "SessionStart",
      "PreCompact",
      "PostCompact",
      "SubagentStart",
      "SubagentStop",
    ]) {
      expect(renderContinuationDirective(event)).not.toBe("");
    }
    expect(renderContinuationDirective("Unknown")).toBe("");
  });

  it("exposes the SessionStart shape the hook protocol expects", () => {
    const output = sessionStartOutput({
      root: project(),
      documentationEvaluator: () => ({ due: false }),
    });
    expect(Object.keys(output)).toEqual(["hookSpecificOutput"]);
  });
});

describe("command line", () => {
  // A real project installed from the template; its own copy of the hook reads its own state.
  let root;
  beforeAll(async () => {
    root = tempDir("autonomous-cli-");
    await install(root, {
      "project-name": "Demo Project",
      "task-prefix": "DEMO",
      "no-stamp": true,
    });
  });

  const render = (input) =>
    execFileSync(process.execPath, [join(root, "scripts", "context-hook.mjs"), "render"], {
      input,
      encoding: "utf8",
    });

  it("emits one JSON object and exits 0 even on nonsense input", () => {
    expect(JSON.parse(render("not json").trim())).toEqual({});
  });

  it("renders real context for a SessionStart payload", () => {
    const stdout = render(JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }));
    const context = JSON.parse(stdout.trim()).hookSpecificOutput.additionalContext;
    expect(context).toContain("Demo Project: bounded context recovery");
    expect(context).toContain("DEMO-001: set up Demo Project and prove the autonomous kit works.");
  });
});
