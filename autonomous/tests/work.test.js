import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../scripts/autonomous-config.mjs";
import { availability, readyItems, statusView, validateQueue } from "../scripts/work.mjs";

const config = { ...DEFAULT_CONFIG, tasks: { idPrefix: "TASK", idDigits: 3 } };

function task(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    kind: "feature",
    status: "ready",
    approved: true,
    owner: null,
    dependsOn: [],
    acceptance: ["it works"],
    evidence: [],
    blockers: [],
    nextAction: "do the thing",
    ...overrides,
  };
}

describe("queue validation", () => {
  it("accepts a well-formed queue", () => {
    expect(validateQueue([task("TASK-001")], { config })).toEqual([]);
  });

  it("requires a canonical id shaped by the configured prefix", () => {
    const errors = validateQueue([task("UN-001")], { config });
    expect(errors).toContain("Each work item needs a stable TASK-000 ID.");
  });

  it("rejects duplicate ids", () => {
    const errors = validateQueue([task("TASK-001"), task("TASK-001")], { config });
    expect(errors).toContain("Duplicate task: TASK-001");
  });

  it("refuses active work without an owner and unapproved work that is active", () => {
    const errors = validateQueue([task("TASK-001", { status: "in_progress", approved: false })], {
      config,
    });
    expect(errors).toContain("TASK-001: active work needs an owner.");
    expect(errors).toContain("TASK-001: unapproved work cannot be active or done.");
  });

  it("requires a stated reason for blocked work, and blocked status for a stated blocker", () => {
    expect(validateQueue([task("TASK-001", { status: "blocked" })], { config })).toContain(
      "TASK-001: blocked work needs an explicit reason.",
    );
    expect(validateQueue([task("TASK-001", { blockers: ["waiting"] })], { config })).toContain(
      "TASK-001: unresolved blockers require blocked status.",
    );
  });

  it("requires an explicit reason for skipping review", () => {
    const errors = validateQueue([task("TASK-001", { reviewRequired: false })], { config });
    expect(errors).toContain("TASK-001: skipping review requires an explicit low-risk reason.");
  });

  it("accepts ownedPaths only as a list of nonempty strings", () => {
    expect(validateQueue([task("TASK-001", { ownedPaths: ["docs/**"] })], { config })).toEqual([]);
    for (const ownedPaths of ["docs/**", ["docs/**", ""], [3]])
      expect(validateQueue([task("TASK-001", { ownedPaths })], { config })).toContain(
        "TASK-001: ownedPaths must be an array of nonempty strings.",
      );
  });

  it("requires evidence before a task may be done", () => {
    const errors = validateQueue([task("TASK-001", { status: "done", owner: "router" })], {
      config,
    });
    expect(errors).toContain("TASK-001: done requires evidence and no unresolved blockers.");
  });

  it("detects an unknown dependency and a dependency cycle", () => {
    expect(validateQueue([task("TASK-001", { dependsOn: ["TASK-404"] })], { config })).toContain(
      "TASK-001: unknown dependency TASK-404.",
    );
    const cycle = validateQueue(
      [
        task("TASK-001", { dependsOn: ["TASK-002"] }),
        task("TASK-002", { dependsOn: ["TASK-001"] }),
      ],
      { config },
    );
    expect(cycle.some((error) => error.startsWith("Dependency cycle at"))).toBe(true);
  });
});

describe("ready work", () => {
  it("only counts approved, unblocked work whose dependencies are done", () => {
    const items = [
      task("TASK-001", { status: "done", owner: "router", evidence: ["work/runs/x.json"] }),
      task("TASK-002", { dependsOn: ["TASK-001"] }),
      task("TASK-003", { dependsOn: ["TASK-002"] }),
      task("TASK-004", { approved: false }),
    ];
    expect(readyItems(items, { config }).map((item) => item.id)).toEqual(["TASK-002"]);
  });
});

describe("quiet hours", () => {
  it("uses the configured window and time zone", () => {
    const quiet = { ...config, quietHours: { timeZone: "UTC", startHour: 23, endHour: 8 } };
    expect(availability(new Date("2026-01-01T23:30:00Z"), { config: quiet }).quietHours).toBe(true);
    expect(availability(new Date("2026-01-01T07:30:00Z"), { config: quiet }).quietHours).toBe(true);
    expect(availability(new Date("2026-01-01T12:00:00Z"), { config: quiet }).quietHours).toBe(
      false,
    );
  });

  it("supports a window that does not wrap midnight", () => {
    const daytime = { ...config, quietHours: { timeZone: "UTC", startHour: 12, endHour: 14 } };
    expect(availability(new Date("2026-01-01T13:00:00Z"), { config: daytime }).quietHours).toBe(
      true,
    );
    expect(availability(new Date("2026-01-01T15:00:00Z"), { config: daytime }).quietHours).toBe(
      false,
    );
  });

  it("refuses an invalid timestamp", () => {
    expect(() => availability(new Date("nonsense"), { config })).toThrow(/Invalid timestamp/);
  });
});

describe("status view", () => {
  const items = [
    task("TASK-001", { status: "in_progress", owner: "router" }),
    task("TASK-002"),
    task("TASK-900", { status: "done", owner: "router", evidence: ["work/runs/x.json"] }),
  ];
  const live = { config, errors: [], primaryObjective: "TASK-001" };

  it("shows the open work and counts the done items", () => {
    const view = statusView(items, live);
    expect(view.active.map((item) => item.id)).toEqual(["TASK-001"]);
    expect(view.ready.map((item) => item.id)).toEqual(["TASK-002"]);
    expect(view.done.count).toBe(1);
    expect(view.checkpoint).toMatchObject({ primaryObjective: "TASK-001", valid: true });
  });

  it("reports an invalid checkpoint without hiding any task", () => {
    const view = statusView(items, { ...live, errors: ["broken"] });
    expect(view.checkpoint).toMatchObject({ valid: false, errors: ["broken"] });
    expect(view.active.map((item) => item.id)).toEqual(["TASK-001"]);
  });
});
