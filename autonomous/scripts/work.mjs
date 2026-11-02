import { readdirSync, readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PACKAGE_NOTE,
  isKitPackage,
  loadConfig,
  taskIdExample,
  taskIdPattern,
  validateConfig,
} from "./autonomous-config.mjs";
import {
  LIVE_STATE_PATHS,
  evaluateNoYieldGate,
  evaluateLiveState,
  filterOperationalWarnings,
  formatLiveStateReport,
} from "./live-state.mjs";
import {
  evaluateCommitIdentity,
  evaluateHostIdentityExposure,
  evaluateLaneGuard,
  inspectDocumentationUpkeep,
  inspectKitReferences,
  inspectInstructionTaskIds,
  supportAgentTypes,
  writeLaneGuardReceipt,
} from "./lane-guard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATES = new Set(["ready", "in_progress", "review", "blocked", "done"]);

export function validateQueue(items, { config = null } = {}) {
  const resolvedConfig = config ?? loadConfig();
  const pattern = taskIdPattern(resolvedConfig);
  const example = taskIdExample(resolvedConfig);
  const errors = [];
  if (!Array.isArray(items)) return ["The queue must be an array."];
  const byId = new Map();
  for (const item of items) {
    if (!item || !pattern.test(item.id)) {
      errors.push(`Each work item needs a stable ${example} ID.`);
      continue;
    }
    if (byId.has(item.id)) errors.push(`Duplicate task: ${item.id}`);
    byId.set(item.id, item);
    if (!STATES.has(item.status)) errors.push(`${item.id}: invalid status.`);
    if (!["feature", "bug", "chore"].includes(item.kind)) errors.push(`${item.id}: invalid kind.`);
    if (typeof item.approved !== "boolean") errors.push(`${item.id}: approval must be explicit.`);
    if (
      typeof item.title !== "string" ||
      !item.title.trim() ||
      typeof item.nextAction !== "string" ||
      !item.nextAction.trim()
    )
      errors.push(`${item.id}: title and next action are required.`);
    if (
      item.owner !== null &&
      item.owner !== undefined &&
      (typeof item.owner !== "string" || !item.owner.trim())
    )
      errors.push(`${item.id}: owner must be a nonempty string or null.`);
    if (item.reviewRequired !== undefined && typeof item.reviewRequired !== "boolean")
      errors.push(`${item.id}: reviewRequired must be boolean.`);
    if (
      item.ownedPaths !== undefined &&
      (!Array.isArray(item.ownedPaths) ||
        item.ownedPaths.some((value) => typeof value !== "string" || !value.trim()))
    )
      errors.push(`${item.id}: ownedPaths must be an array of nonempty strings.`);
    for (const field of ["dependsOn", "acceptance", "evidence", "blockers"]) {
      if (!Array.isArray(item[field])) errors.push(`${item.id}: ${field} must be an array.`);
      else if (item[field].some((value) => typeof value !== "string" || !value.trim()))
        errors.push(`${item.id}: ${field} entries must be nonempty strings.`);
    }
    if (!item.acceptance?.length) errors.push(`${item.id}: acceptance criteria are required.`);
    if (["in_progress", "review"].includes(item.status) && !item.owner) {
      errors.push(`${item.id}: active work needs an owner.`);
    }
    if (["in_progress", "review", "done"].includes(item.status) && !item.approved) {
      errors.push(`${item.id}: unapproved work cannot be active or done.`);
    }
    if (item.status === "blocked" && !item.blockers?.length) {
      errors.push(`${item.id}: blocked work needs an explicit reason.`);
    }
    if (["ready", "in_progress", "review"].includes(item.status) && item.blockers?.length) {
      errors.push(`${item.id}: unresolved blockers require blocked status.`);
    }
    if (
      item.reviewRequired === false &&
      (typeof item.reviewExemption !== "string" || !item.reviewExemption.trim())
    ) {
      errors.push(`${item.id}: skipping review requires an explicit low-risk reason.`);
    }
    if (item.status === "done" && (!item.evidence?.length || item.blockers?.length)) {
      errors.push(`${item.id}: done requires evidence and no unresolved blockers.`);
    }
  }
  for (const item of byId.values()) {
    for (const id of Array.isArray(item.dependsOn) ? item.dependsOn : []) {
      if (!byId.has(id)) errors.push(`${item.id}: unknown dependency ${id}.`);
      if (
        ["in_progress", "review", "done"].includes(item.status) &&
        byId.get(id)?.status !== "done"
      ) {
        errors.push(`${item.id}: active/completed work has incomplete dependency ${id}.`);
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle at ${id}.`);
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    const dependencies = byId.get(id).dependsOn;
    for (const dep of Array.isArray(dependencies) ? dependencies : []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return errors;
}

export function validateEvidence(items, root = ROOT) {
  const errors = [];
  const warnings = [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const base = realpathSync(root);
  function evidencePath(path) {
    if (typeof path !== "string" || isAbsolute(path) || path.split(/[\\/]/).includes(".."))
      throw new Error("evidence must be a repository-relative file path");
    const resolved = realpathSync(resolve(base, path));
    const rel = relative(base, resolved);
    if (rel.startsWith("..") || isAbsolute(rel) || !statSync(resolved).isFile())
      throw new Error("evidence must be a file inside the repository");
    return resolved;
  }
  for (const item of items) {
    let commandPassed = false;
    let reviewed = false;
    const passingReceiptPaths = new Set();
    const reviewRecords = [];
    for (const path of Array.isArray(item.evidence) ? item.evidence : []) {
      try {
        const file = evidencePath(path);
        if (!path.endsWith(".json")) continue;
        const record = JSON.parse(readFileSync(file, "utf8"));
        if (record.type === "command_receipt") {
          if (!Array.isArray(record.taskIds) || !record.taskIds.includes(item.id))
            throw new Error("receipt belongs to another task");
          if (!record.checkId) throw new Error("receipt has no check ID");
          const passed =
            record.verificationPassed === true &&
            record.exitCode === 0 &&
            record.sourceUnchangedDuringCheck === true &&
            record.before?.commit === record.after?.commit &&
            record.before?.sha256 === record.after?.sha256 &&
            /^[a-f0-9]{40}$/.test(record.before?.commit || "") &&
            /^[a-f0-9]{64}$/.test(record.before?.sha256 || "");
          if (passed) {
            if (
              typeof record.outputPath !== "string" ||
              isAbsolute(record.outputPath) ||
              record.outputPath.split(/[\\/]/).includes("..") ||
              !/^[a-f0-9]{64}$/.test(record.outputSha256 || "")
            )
              throw new Error("receipt lacks output provenance");
            if (existsSync(resolve(base, record.outputPath))) {
              const output = evidencePath(record.outputPath);
              if (
                createHash("sha256").update(readFileSync(output)).digest("hex") !==
                record.outputSha256
              )
                throw new Error("receipt output hash mismatch");
            } else
              warnings.push(
                `${item.id}: private output unavailable for ${path}; historical receipt only.`,
              );
            commandPassed = true;
            passingReceiptPaths.add(path);
          }
        }
        if (
          record.type === "review" &&
          Array.isArray(record.taskIds) &&
          record.taskIds.includes(item.id)
        )
          reviewRecords.push(record);
      } catch (error) {
        errors.push(`${item.id}: ${path}: ${error.message}`);
      }
    }
    for (const record of reviewRecords) {
      const resolved =
        record.status === "changes_requested" &&
        Array.isArray(record.findings) &&
        record.findings.length > 0 &&
        record.findings.every((finding) => {
          const resolvedTask =
            finding.resolutionTaskId !== item.id &&
            byId.get(finding.resolutionTaskId)?.status === "done";
          const resolvedInline =
            finding.resolved === true &&
            typeof finding.resolution === "string" &&
            finding.resolution.trim().length > 0 &&
            typeof finding.resolutionEvidence === "string" &&
            passingReceiptPaths.has(finding.resolutionEvidence);
          return resolvedTask || resolvedInline;
        });
      reviewed ||=
        record.independent === true &&
        Boolean(record.reviewer && record.model) &&
        (record.status === "approved" || resolved);
    }
    if (item.status === "done") {
      if (!commandPassed)
        errors.push(`${item.id}: done requires a passing task-linked command receipt.`);
      if (item.reviewRequired !== false && !reviewed)
        errors.push(`${item.id}: done requires independent review with resolved findings.`);
    }
  }
  return { errors, warnings };
}

export function readyItems(items, { config = null } = {}) {
  const errors = validateQueue(items, { config });
  if (errors.length) throw new Error(errors.join("\n"));
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.filter(
    (item) =>
      item.approved &&
      item.status === "ready" &&
      !item.blockers.length &&
      item.dependsOn.every((id) => byId.get(id)?.status === "done"),
  );
}

export function availability(now = new Date(), { config = null } = {}) {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid timestamp.");
  const resolved = config ?? loadConfig();
  const timeZone = resolved.quietHours?.timeZone || "UTC";
  const startHour = Number.isInteger(resolved.quietHours?.startHour)
    ? resolved.quietHours.startHour
    : 23;
  const endHour = Number.isInteger(resolved.quietHours?.endHour) ? resolved.quietHours.endHour : 8;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const quiet =
    startHour <= endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour;
  return {
    timeZone,
    localTime: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
    quietHours: quiet,
    quietHoursPolicy: `${String(startHour).padStart(2, "0")}:00–${String(endHour).padStart(2, "0")}:00; queue non-urgent owner questions, continue approved unblocked work.`,
  };
}

export function readQueue(root = ROOT) {
  const directory = resolve(root, "work/items");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      try {
        return JSON.parse(readFileSync(resolve(directory, name), "utf8"));
      } catch (error) {
        throw new Error(`${name}: ${error.message}`);
      }
    });
}

/**
 * The operational view of the whole queue: what is moving, what can start,
 * what waits, and how much is done. A checkpoint problem is reported beside it
 * and never hides a task.
 */
export function statusView(items, live) {
  const ready = readyItems(items, { config: live.config });
  const readyIds = new Set(ready.map((item) => item.id));
  return {
    checkpoint: {
      path: LIVE_STATE_PATHS.checkpoint,
      primaryObjective: live.primaryObjective,
      valid: live.errors.length === 0,
      ...(live.errors.length ? { errors: live.errors } : {}),
    },
    active: items.filter((item) => ["in_progress", "review"].includes(item.status)),
    ready,
    blocked: items.filter((item) => item.status === "blocked"),
    waitingForDependencies: items.filter(
      (item) => item.approved && item.status === "ready" && !readyIds.has(item.id),
    ),
    unapproved: items.filter((item) => !item.approved),
    done: { count: items.filter((item) => item.status === "done").length },
  };
}

/**
 * Run the lane guard for `check`. Autonomous kit, documentation, archive, instruction,
 * validator, and hook changes must belong to a disjoint support lane. Warnings
 * are always printed; a receipt is written only when there is something to
 * record, and a receipt failure never affects the check result.
 */
function runLaneGuard(items) {
  let lane;
  try {
    lane = evaluateLaneGuard({ items });
  } catch (error) {
    console.warn(`Lane guard could not run: ${error.message}`);
    return { errors: [], warnings: [] };
  }
  for (const warning of lane.warnings) console.warn(warning);

  // Privacy: no host username or absolute user path may reach a commit, and a
  // commit must carry the configured identity rather than a personal one.
  let privacy = { errors: [], warnings: [], exposed: [] };
  try {
    privacy = evaluateHostIdentityExposure({});
  } catch (error) {
    console.warn(`Host-identity scan could not run: ${error.message}`);
  }
  for (const warning of privacy.warnings) console.warn(warning);

  let identity = { ok: true, problems: [], observed: {} };
  try {
    identity = evaluateCommitIdentity({});
  } catch (error) {
    console.warn(`Commit-identity check could not run: ${error.message}`);
  }
  const identityErrors = identity.ok ? [] : [`Commit identity: ${identity.problems.join(" ")}`];

  // The always-loaded instruction files must outlive any one milestone. A stale
  // task id there misdirects every future session, so it is an error, not a note.
  let instructions = { ok: true, errors: [], warnings: [], found: [] };
  try {
    instructions = inspectInstructionTaskIds({});
  } catch (error) {
    console.warn(`Milestone-neutral instruction check could not run: ${error.message}`);
  }
  for (const warning of instructions.warnings) console.warn(warning);
  const instructionErrors = instructions.errors.map(
    (problem) => `Milestone-neutral instructions: ${problem}`,
  );

  // The other half of instruction rot: an always-loaded file or a registered
  // hook pointing at something that no longer exists. A fresh session trusts
  // those pointers, so a dead one costs a real detour.
  let references = { ok: true, errors: [], warnings: [], dead: [], missingHooks: [] };
  try {
    references = inspectKitReferences({});
  } catch (error) {
    console.warn(`Autonomous kit reference check could not run: ${error.message}`);
  }
  for (const warning of references.warnings) console.warn(warning);
  const referenceErrors = references.errors.map(
    (problem) => `Autonomous kit references: ${problem}`,
  );

  // Every document is maintained or archived, and the changelog stays current.
  // Both halves are objective, so both are checked.
  let upkeep = {
    ok: true,
    errors: [],
    warnings: [],
    missingChangelogEntries: [],
    unmappedDocuments: [],
  };
  try {
    upkeep = inspectDocumentationUpkeep({});
  } catch (error) {
    console.warn(`Documentation upkeep check could not run: ${error.message}`);
  }
  for (const warning of upkeep.warnings) console.warn(warning);
  const upkeepErrors = upkeep.errors.map((problem) => `Documentation upkeep: ${problem}`);

  const errors = [
    ...lane.errors,
    ...privacy.errors,
    ...identityErrors,
    ...instructionErrors,
    ...referenceErrors,
    ...upkeepErrors,
  ];
  if (
    lane.uncovered.length ||
    lane.overridden.length ||
    privacy.exposed.length ||
    !identity.ok ||
    !instructions.ok ||
    !references.ok ||
    !upkeep.ok
  ) {
    const receipt = writeLaneGuardReceipt({
      kind: "work_check_lane_guard",
      recordedAt: new Date().toISOString(),
      decision: errors.length ? "fail" : "pass_with_override",
      gitAvailable: lane.gitAvailable,
      unpushedCommitsScanned: lane.unpushedCommitsScanned,
      uncovered: lane.uncovered,
      overridden: lane.overridden,
      override: lane.override,
      supportItems: lane.supportItems,
      hostIdentityExposedPaths: privacy.exposed.map((entry) => entry.path),
      commitIdentityOk: identity.ok,
      instructionTaskIdsOk: instructions.ok,
      instructionTaskIds: instructions.found,
      kitReferencesOk: references.ok,
      deadReferences: references.dead,
      missingHooks: references.missingHooks,
      documentationUpkeepOk: upkeep.ok,
      missingChangelogEntries: upkeep.missingChangelogEntries,
      unmappedDocuments: upkeep.unmappedDocuments,
    });
    if (receipt) console.warn(`Lane guard receipt: ${receipt}`);
  }
  return { ...lane, errors };
}

function main() {
  const command = process.argv[2] || "status";
  const config = loadConfig();
  if (command === "config") {
    console.log(JSON.stringify({ ...config, root: undefined }, null, 2));
    return;
  }
  if (command === "quiet") {
    console.log(
      JSON.stringify(
        availability(process.argv[3] ? new Date(process.argv[3]) : new Date(), { config }),
        null,
        2,
      ),
    );
    return;
  }
  // The package's own folder ships this script but has no queue: say so instead of failing.
  if (isKitPackage(ROOT)) {
    console.log(PACKAGE_NOTE);
    return;
  }
  const items = readQueue();
  const errors = validateQueue(items, { config });
  if (command === "check") {
    if (errors.length) throw new Error(errors.join("\n"));
    // The task checks and the autonomous kit checks (lane guard, privacy, commit
    // identity, instruction freshness, dead references) are independent lanes.
    // Returning early on the first failure let one incomplete task hide every
    // autonomous kit problem, and `check` is often the only thing a session runs. So
    // collect all of them and report together.
    const taskErrors = [];
    const evidence = validateEvidence(items);
    taskErrors.push(...evidence.errors);

    const live = evaluateLiveState({ items });
    const lane = runLaneGuard(items);
    const showAll = process.argv.includes("--all-warnings");
    const doneIds = new Set(items.filter((item) => item.status === "done").map((item) => item.id));
    const operational = showAll
      ? { warnings: evidence.warnings, suppressed: [] }
      : filterOperationalWarnings(evidence.warnings, doneIds, { config });
    for (const warning of operational.warnings) console.warn(warning);
    if (evidence.errors.length === 0)
      console.log(
        `Validated ${items.length} work items and recorded evidence. Acceptance remains an explicit coordinator judgment.`,
      );
    console.log(formatLiveStateReport(live, { suppressedWarnings: operational.suppressed.length }));

    const kitErrors = [...validateConfig(config), ...live.errors, ...lane.errors];
    if (taskErrors.length || kitErrors.length) {
      throw new Error(
        [
          ...taskErrors,
          ...(kitErrors.length
            ? [
                "Checkpoint or autonomous kit checks failed. This is the autonomous kit lane; the product lane continues.",
                ...kitErrors,
              ]
            : []),
        ].join("\n"),
      );
    }
    return;
  }
  if (errors.length) throw new Error(errors.join("\n"));
  if (command === "no-yield") {
    const live = evaluateLiveState({ items });
    const result = evaluateNoYieldGate({ items, liveState: live });
    console.log(JSON.stringify(result, null, 2));
    if (!result.allowYield) process.exitCode = 1;
    return;
  }
  if (command === "brief") {
    const item = items.find((candidate) => candidate.id === process.argv[3]);
    if (!item) throw new Error("Task ID is required and must exist.");
    console.log(JSON.stringify(item, null, 2));
    return;
  }
  if (command !== "status")
    throw new Error(
      "Usage: node scripts/work.mjs [status|check [--all-warnings]|no-yield|brief ID|quiet [ISO_TIMESTAMP]|config]",
    );
  const live = evaluateLiveState({ items });
  console.log(
    JSON.stringify(
      { ...availability(new Date(), { config }), ...statusView(items, live) },
      null,
      2,
    ),
  );
  if (live.errors.length) process.exitCode = 1;
}

/** The support agent types this project delegates protected-path work to. */
export { supportAgentTypes };

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
