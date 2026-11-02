import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tempDir } from "./temp-dirs.js";
import { KIT_ROOT, render } from "../bin/autonomous-install.mjs";
import { DEFAULT_CONFIG, clearConfigCache } from "../scripts/autonomous-config.mjs";
import {
  evaluateLiveState,
  evaluateNoYieldGate,
  filterOperationalWarnings,
  objectiveId,
  validateCheckpoint,
} from "../scripts/live-state.mjs";

const config = DEFAULT_CONFIG;

function task(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    kind: "feature",
    status: "in_progress",
    approved: true,
    owner: "router",
    dependsOn: [],
    acceptance: ["it works"],
    evidence: [],
    blockers: [],
    nextAction: "next",
    ...overrides,
  };
}

function ownerOnly(id, reason, { kind = "owner_only", ...overrides } = {}) {
  return task(id, {
    status: "blocked",
    owner: null,
    blockers: [reason],
    yieldBlocker: { kind, reason },
    ...overrides,
  });
}

// The checkpoint a fresh install writes: the shipped template, rendered the way the installer does.
const TEMPLATE_CHECKPOINT = render(
  readFileSync(join(KIT_ROOT, "template", "work", "CHECKPOINT.md"), "utf8"),
  { FIRST_TASK_ID: "TASK-001", PROJECT_NAME: "Demo", DATE: "2026-10-11" },
);

function checkpoint({
  objective = "TASK-001: the milestone.",
  queue = ["| TASK-001 | | | |"],
  log = [],
} = {}) {
  return [
    "# Checkpoint",
    "",
    "## Primary objective",
    "",
    objective,
    "",
    "## Queue",
    "",
    "| Step | Waits on | Who, which files | Status |",
    "|---|---|---|---|",
    ...queue,
    "",
    "## Log",
    "",
    ...log,
    "",
  ].join("\n");
}

describe("checkpoint", () => {
  it("accepts the template checkpoint", () => {
    expect(validateCheckpoint(TEMPLATE_CHECKPOINT, { items: [task("TASK-001")], config })).toEqual(
      [],
    );
  });

  it("reports a missing heading, and a queue placed below the log", () => {
    const items = [task("TASK-001")];
    const noLog = TEMPLATE_CHECKPOINT.replace(/## Log[\s\S]*$/, "");
    expect(validateCheckpoint(noLog, { items, config })).toContain(
      'work/CHECKPOINT.md: missing the "## Log" section; the dated log goes last, under exactly that heading.',
    );
    const queueLast =
      "# Checkpoint\n\n## Primary objective\n\nTASK-001.\n\n## Log\n\n## Queue\n\nTASK-001\n";
    expect(validateCheckpoint(queueLast, { items, config })).toContain(
      'work/CHECKPOINT.md: missing the "## Queue" section above "## Log".',
    );
  });

  it("reports an objective that names no item", () => {
    expect(validateCheckpoint(checkpoint(), { items: [], config })).toContain(
      "work/CHECKPOINT.md: the primary objective TASK-001 has no item in work/items.",
    );
    const errors = validateCheckpoint(checkpoint({ objective: "Ship the parser." }), {
      items: [task("TASK-001")],
      config,
    });
    expect(
      errors.some((error) =>
        error.includes('"## Primary objective" does not start with a task id'),
      ),
    ).toBe(true);
  });

  it("reports an open item with no queue row, and a queue id with no item", () => {
    const items = [
      task("TASK-001"),
      task("TASK-002", { status: "ready", owner: null }),
      task("TASK-003", { status: "done", evidence: ["work/runs/x.json"] }),
      task("TASK-004", { status: "ready", owner: null, approved: false }),
    ];
    const errors = validateCheckpoint(
      checkpoint({ queue: ["| TASK-001 | | | |", "| Review TASK-404 | | | |"] }),
      { items, config },
    );
    expect(errors).toEqual([
      "work/CHECKPOINT.md: the queue names TASK-404, which has no item in work/items.",
      'work/CHECKPOINT.md: TASK-002 is approved and not done but has no row under "## Queue".',
    ]);
  });

  it("lets the log grow but bounds the part above it", () => {
    const items = [task("TASK-001")];
    const longLog = Array.from({ length: 400 }, (_, i) => `- 2026-10-11: finished step ${i}.`);
    expect(validateCheckpoint(checkpoint({ log: longLog }), { items, config })).toEqual([]);
    const longQueue = Array.from({ length: 250 }, (_, i) => `| step ${i} | | | open |`);
    const errors = validateCheckpoint(checkpoint({ queue: ["| TASK-001 | | | |", ...longQueue] }), {
      items,
      config,
    });
    expect(
      errors.some((error) => error.includes('lines above "## Log" exceed the bound of 220')),
    ).toBe(true);
  });

  it("takes the objective only from the task id that starts the primary objective", () => {
    const objective = (line) => objectiveId(checkpoint({ objective: line }), { config });
    expect(objectiveId(TEMPLATE_CHECKPOINT, { config })).toBe("TASK-001");
    expect(objective("TASK-002 replaces TASK-001.")).toBe("TASK-002");
    expect(objective("**TASK-003 — ship the parser.**")).toBe("TASK-003");
    // A done predecessor named first must not pass for the objective.
    expect(objective("Builds on TASK-001: TASK-002 ships the parser.")).toBeNull();
    expect(objective("No id here.")).toBeNull();
    expect(objectiveId("# Checkpoint\n\n## Queue\n\nTASK-001\n", { config })).toBeNull();
  });

  it("reads only work/CHECKPOINT.md from disk", () => {
    clearConfigCache();
    const root = tempDir("autonomous-checkpoint-");
    const items = [task("TASK-001")];
    expect(evaluateLiveState({ root, items }).errors).toEqual(["work/CHECKPOINT.md: missing."]);
    mkdirSync(join(root, "work"), { recursive: true });
    writeFileSync(join(root, "work", "CHECKPOINT.md"), TEMPLATE_CHECKPOINT, "utf8");
    const live = evaluateLiveState({ root, items });
    expect(live.errors).toEqual([]);
    expect(live.primaryObjective).toBe("TASK-001");
    clearConfigCache();
  });
});

describe("no-yield gate", () => {
  const liveState = (overrides = {}) => ({
    errors: [],
    config,
    primaryObjective: "TASK-001",
    ...overrides,
  });

  it("never allows yielding while the checkpoint is invalid", () => {
    const result = evaluateNoYieldGate({
      items: [task("TASK-001")],
      liveState: liveState({ errors: ["broken"] }),
    });
    expect(result.allowYield).toBe(false);
    expect(result.reasonCode).toBe("checkpoint_invalid");
  });

  it("continues when the checkpoint names no objective item", () => {
    for (const primaryObjective of [null, "TASK-404"]) {
      const result = evaluateNoYieldGate({
        items: [ownerOnly("TASK-001", "the owner must create the account")],
        liveState: liveState({ primaryObjective }),
      });
      expect(result.allowYield).toBe(false);
      expect(result.reasonCode).toBe("primary_objective_missing");
    }
  });

  it("continues while approved work is active", () => {
    const result = evaluateNoYieldGate({ items: [task("TASK-001")], liveState: liveState() });
    expect(result.allowYield).toBe(false);
    expect(result.reasonCode).toBe("approved_work_remains");
  });

  it("continues with claimable work while the objective waits on the owner, unpaused", () => {
    const result = evaluateNoYieldGate({
      items: [
        ownerOnly("TASK-001", "the owner must create the account"),
        task("TASK-002", { status: "ready", owner: null }),
      ],
      liveState: liveState(),
    });
    expect(result.allowYield).toBe(false);
    expect(result.reasonCode).toBe("approved_work_remains");
    expect(result.claimableTaskIds).toEqual(["TASK-002"]);
  });

  it("allows yielding at once when the owner paused the objective, despite claimable work", () => {
    const result = evaluateNoYieldGate({
      items: [
        ownerOnly("TASK-001", "the owner paused the milestone", { kind: "owner_paused" }),
        task("TASK-002", { status: "ready", owner: null }),
        task("TASK-003"),
      ],
      liveState: liveState(),
    });
    expect(result.allowYield).toBe(true);
    expect(result.reasonCode).toBe("owner_paused");
    expect(result.reasons).toEqual(["The owner paused TASK-001: the owner paused the milestone"]);
  });

  it("continues while an open item is blocked without an exact yield blocker", () => {
    const vague = task("TASK-001", { status: "blocked", owner: null, blockers: ["waiting"] });
    const result = evaluateNoYieldGate({ items: [vague], liveState: liveState() });
    expect(result.allowYield).toBe(false);
    expect(result.reasonCode).toBe("approved_paths_not_terminally_blocked");
    expect(result.nonTerminalTaskIds).toEqual(["TASK-001"]);
  });

  it("allows yielding when the objective is done", () => {
    const done = task("TASK-001", { status: "done", evidence: ["work/runs/x.json"] });
    const result = evaluateNoYieldGate({ items: [done], liveState: liveState() });
    expect(result.allowYield).toBe(true);
    expect(result.reasonCode).toBe("primary_objective_done");
  });

  it("allows yielding when every open item has an exact owner-only or system blocker", () => {
    const result = evaluateNoYieldGate({
      items: [
        ownerOnly("TASK-001", "the owner must create the account"),
        task("TASK-002", {
          status: "blocked",
          owner: null,
          blockers: ["the CI quota resets on Monday"],
          yieldBlocker: { kind: "system_enforced", reason: "the CI quota resets on Monday" },
        }),
        task("TASK-003", { status: "ready", owner: null, approved: false }),
        task("TASK-004", { status: "done", evidence: ["work/runs/x.json"] }),
      ],
      liveState: liveState(),
    });
    expect(result.allowYield).toBe(true);
    expect(result.reasonCode).toBe("all_open_items_terminally_blocked");
    expect(result.terminalBlockers.map((blocker) => blocker.taskId)).toEqual([
      "TASK-001",
      "TASK-002",
    ]);
  });
});

describe("operational warnings", () => {
  it("counts the old-receipt warnings of done items instead of printing them", () => {
    const result = filterOperationalWarnings(
      ["TASK-900: historical receipt only.", "TASK-001: live problem."],
      new Set(["TASK-900"]),
      { config },
    );
    expect(result.warnings).toEqual(["TASK-001: live problem."]);
    expect(result.suppressed).toHaveLength(1);
  });
});
