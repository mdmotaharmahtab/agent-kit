// Read-only checks for the coordinator's checkpoint, and the no-yield gate.
//
// The canonical queue in work/items is the task database and stays fully
// validated by work.mjs. Beside it the coordinator keeps one hand-written file,
// work/CHECKPOINT.md: the primary objective, the queue, and the dated log. This
// module checks that file against the items and decides whether the
// coordinator may yield. Nothing here rewrites, moves, or deletes a file. Every
// failure is reported as an explicit message so a compacted session can repair
// the state by hand.
//
// Cooperative-host threat model: this guards against accidental drift, stale
// state, and unbounded accumulation. It is not an attestation system.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadConfig,
  taskIdExample,
  taskIdInProsePattern,
  taskIdPattern,
} from "./autonomous-config.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const LIVE_STATE_PATHS = Object.freeze({
  checkpoint: "work/CHECKPOINT.md",
});

/**
 * Exact reasons an item may wait. `owner_paused` is the owner's pause: on the
 * objective item it permits yielding at once. `owner_only` means the item waits
 * on the owner while other approved work goes on.
 */
export const YIELD_BLOCKER_KINDS = Object.freeze(["owner_only", "system_enforced", "owner_paused"]);

const LOG_HEADING = /^##[ \t]+Log[ \t]*\r?$/m;

function limitsFor(config) {
  return config.checkpoint ?? {};
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Approved and not done: the work the queue must show and the gate must see. */
export function isOpenItem(item) {
  return item?.approved === true && item?.status !== "done";
}

function exactYieldBlocker(item) {
  const marker = item?.yieldBlocker;
  if (item?.status !== "blocked" || !marker || typeof marker !== "object") return null;
  if (!YIELD_BLOCKER_KINDS.includes(marker.kind) || !isText(marker.reason)) return null;
  if (!Array.isArray(item.blockers) || !item.blockers.includes(marker.reason)) return null;
  return marker;
}

function claimablyReady(item, byId) {
  return (
    item?.approved === true &&
    item?.status === "ready" &&
    Array.isArray(item.blockers) &&
    item.blockers.length === 0 &&
    Array.isArray(item.dependsOn) &&
    item.dependsOn.every((id) => byId.get(id)?.status === "done")
  );
}

/**
 * Split the checkpoint at its "## Log" heading. The part above is bounded and
 * holds the sections the autonomous kit reads; the dated log below it may grow.
 */
function splitCheckpoint(text) {
  const raw = String(text ?? "");
  const log = LOG_HEADING.exec(raw);
  const above = log ? raw.slice(0, log.index) : raw;
  const lines = above.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const sections = new Map();
  let headings = 0;
  let current = null;
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      headings += 1;
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
    } else if (current) sections.get(current).push(line);
  }
  return {
    hasLog: Boolean(log),
    bytes: Buffer.byteLength(above, "utf8"),
    lines: lines.length,
    headings,
    sections,
  };
}

function taskIdsIn(lines, config) {
  return (lines ?? []).join("\n").match(taskIdInProsePattern(config)) ?? [];
}

/** The sections above "## Log", by heading: one parser for the validator and recovery. */
export function checkpointSections(text) {
  return splitCheckpoint(text).sections;
}

/**
 * The objective's task id: the id that starts the first line under
 * "## Primary objective", as in "TASK-001: ship the parser". Emphasis or a list
 * marker before it is fine. An id later in the line is not, so "Builds on
 * TASK-001: TASK-002 ..." names no objective rather than the wrong one.
 */
export function objectiveId(text, { config = null } = {}) {
  return leadingTaskId(splitCheckpoint(text).sections.get("Primary objective"), config);
}

function leadingTaskId(lines, config) {
  const first = (lines ?? []).find((line) => line.trim().length > 0) ?? "";
  const token = /^[A-Za-z0-9_]+-\d+/.exec(first.replace(/^[\s>*_`#[(-]+/, ""))?.[0];
  return token && taskIdPattern(config ?? loadConfig()).test(token) ? token : null;
}

/**
 * Check the checkpoint against the items: the three headings, the bounds above
 * the log, an objective that names a real item, a queue row for every open
 * item, and no queue row for an item that does not exist.
 */
export function validateCheckpoint(text, { items = [], config = null } = {}) {
  const resolvedConfig = config ?? loadConfig();
  const limits = limitsFor(resolvedConfig);
  const label = LIVE_STATE_PATHS.checkpoint;
  if (typeof text !== "string" || text.trim().length === 0) {
    return [`${label}: the checkpoint must not be empty.`];
  }
  const errors = [];
  const parts = splitCheckpoint(text);
  if (parts.bytes > limits.maxBytesAboveLog)
    errors.push(
      `${label}: ${parts.bytes} bytes above "## Log" exceed the bound of ${limits.maxBytesAboveLog}; move finished rows to the log.`,
    );
  if (parts.lines > limits.maxLinesAboveLog)
    errors.push(
      `${label}: ${parts.lines} lines above "## Log" exceed the bound of ${limits.maxLinesAboveLog}; move finished rows to the log.`,
    );
  if (parts.headings > limits.maxSectionsAboveLog)
    errors.push(
      `${label}: ${parts.headings} sections above "## Log" exceed the limit of ${limits.maxSectionsAboveLog}; the checkpoint is becoming a diary.`,
    );
  if (!parts.hasLog)
    errors.push(
      `${label}: missing the "## Log" section; the dated log goes last, under exactly that heading.`,
    );
  for (const name of ["Primary objective", "Queue"]) {
    if (!parts.sections.has(name))
      errors.push(`${label}: missing the "## ${name}" section above "## Log".`);
  }

  const byId = new Map(items.map((item) => [item?.id, item]));
  if (parts.sections.has("Primary objective")) {
    const objective = leadingTaskId(parts.sections.get("Primary objective"), resolvedConfig);
    if (!objective)
      errors.push(
        `${label}: "## Primary objective" does not start with a task id; begin its first line with the objective's item, as in "${taskIdExample(resolvedConfig)}: ...".`,
      );
    else if (!byId.has(objective))
      errors.push(`${label}: the primary objective ${objective} has no item in work/items.`);
  }
  if (parts.sections.has("Queue")) {
    const queued = new Set(taskIdsIn(parts.sections.get("Queue"), resolvedConfig));
    for (const id of queued) {
      if (!byId.has(id))
        errors.push(`${label}: the queue names ${id}, which has no item in work/items.`);
    }
    for (const item of items) {
      if (isOpenItem(item) && !queued.has(item.id))
        errors.push(
          `${label}: ${item.id} is approved and not done but has no row under "## Queue".`,
        );
    }
  }
  return errors;
}

/**
 * Keep operational warnings and count the history ones instead of printing
 * them. Suppression is reported as a total, never silently dropped.
 */
export function filterOperationalWarnings(warnings, historicalIds, { config = null } = {}) {
  const pattern = taskIdPattern(config ?? loadConfig());
  const leading = new RegExp(`^(${pattern.source.replace(/^\^|\$$/g, "")}):`);
  const kept = [];
  const suppressed = [];
  for (const warning of warnings) {
    const id = leading.exec(String(warning))?.[1];
    if (id && historicalIds.has(id)) suppressed.push(warning);
    else kept.push(warning);
  }
  return { warnings: kept, suppressed };
}

/**
 * Read and check work/CHECKPOINT.md. `items` is the already-read canonical
 * queue; this module never reads or rewrites work/items itself.
 */
export function evaluateLiveState({ root = ROOT, items } = {}) {
  if (!Array.isArray(items)) throw new Error("evaluateLiveState requires the canonical queue.");
  const config = loadConfig({ root });
  const path = resolve(root, LIVE_STATE_PATHS.checkpoint);
  const text = existsSync(path) ? readFileSync(path, "utf8") : null;
  const errors =
    text === null
      ? [`${LIVE_STATE_PATHS.checkpoint}: missing.`]
      : validateCheckpoint(text, { items, config });
  const parts = text === null ? null : splitCheckpoint(text);
  const primaryObjective = text === null ? null : objectiveId(text, { config });
  return {
    errors,
    config,
    limits: limitsFor(config),
    primaryObjective,
    summary: {
      primaryObjective,
      openItems: items.filter(isOpenItem).length,
      doneItems: items.filter((item) => item?.status === "done").length,
      bytesAboveLog: parts?.bytes ?? null,
      linesAboveLog: parts?.lines ?? null,
      sectionsAboveLog: parts?.headings ?? null,
    },
  };
}

/**
 * Decide whether the coordinator may yield while an approved autonomous
 * objective is live. It reads the items alone, plus the checkpoint's verdict
 * and objective. This is intentionally conservative and read-only: ambiguous
 * state means continue, never permission to stop. Three things permit a yield:
 * the objective item is done, the owner paused it, or every open item waits on
 * an exact blocker.
 */
export function evaluateNoYieldGate({ items, liveState }) {
  if (!Array.isArray(items)) throw new Error("evaluateNoYieldGate requires the canonical queue.");
  if (!liveState || typeof liveState !== "object")
    throw new Error("evaluateNoYieldGate requires the evaluated checkpoint.");

  const objectiveTaskId = liveState.primaryObjective ?? null;
  const byId = new Map(items.map((item) => [item?.id, item]));
  const objective = byId.get(objectiveTaskId);
  const result = {
    allowYield: false,
    decision: "continue",
    primaryObjective: objectiveTaskId,
    reasonCode: null,
    reasons: [],
    activeTaskIds: [],
    claimableTaskIds: [],
    nonTerminalTaskIds: [],
    terminalBlockers: [],
  };

  if (liveState.errors?.length) {
    result.reasonCode = "checkpoint_invalid";
    result.reasons.push(
      `${LIVE_STATE_PATHS.checkpoint} failed validation, so the coordinator must continue with recovery or another safe approved path.`,
    );
    return result;
  }
  if (!objectiveTaskId || !objective) {
    result.reasonCode = "primary_objective_missing";
    result.reasons.push("No valid primary objective is available; yielding is not authorized.");
    return result;
  }
  if (objective.status === "done") {
    return {
      ...result,
      allowYield: true,
      decision: "yield_allowed",
      reasonCode: "primary_objective_done",
      reasons: [`Primary objective ${objectiveTaskId} is canonically done.`],
    };
  }
  const pause = exactYieldBlocker(objective);
  if (pause?.kind === "owner_paused") {
    return {
      ...result,
      allowYield: true,
      decision: "yield_allowed",
      reasonCode: "owner_paused",
      reasons: [`The owner paused ${objectiveTaskId}: ${pause.reason}`],
    };
  }

  const open = items.filter(isOpenItem);
  result.activeTaskIds = open
    .filter((item) => ["in_progress", "review"].includes(item.status))
    .map((item) => item.id);
  result.claimableTaskIds = open
    .filter((item) => claimablyReady(item, byId))
    .map((item) => item.id);
  if (result.activeTaskIds.length || result.claimableTaskIds.length) {
    result.reasonCode = "approved_work_remains";
    if (result.activeTaskIds.length)
      result.reasons.push(`Active or review tasks: ${result.activeTaskIds.join(", ")}.`);
    if (result.claimableTaskIds.length)
      result.reasons.push(`Claimable ready tasks: ${result.claimableTaskIds.join(", ")}.`);
    return result;
  }

  for (const item of open) {
    const blocker = exactYieldBlocker(item);
    if (blocker) result.terminalBlockers.push({ taskId: item.id, ...blocker });
    else result.nonTerminalTaskIds.push(item.id);
  }
  if (result.nonTerminalTaskIds.length) {
    result.reasonCode = "approved_paths_not_terminally_blocked";
    result.reasons.push(
      `Approved open items are not terminally blocked: ${result.nonTerminalTaskIds.join(", ")}.`,
    );
    return result;
  }

  return {
    ...result,
    allowYield: true,
    decision: "yield_allowed",
    reasonCode: "all_open_items_terminally_blocked",
    reasons: [
      open.length
        ? `All ${open.length} open approved item(s) have an exact owner-only or system-enforced blocker.`
        : `No approved item is open: ${objectiveTaskId} is neither done nor approved.`,
    ],
  };
}

export function formatLiveStateReport(result, { suppressedWarnings = 0 } = {}) {
  const s = result.summary;
  const limits = result.limits ?? {};
  const lines = [
    `Checkpoint: primary objective ${s.primaryObjective ?? "unset"}; ${s.openItems} open approved item(s), ${s.doneItems} done.`,
  ];
  if (s.bytesAboveLog !== null)
    lines.push(
      `Bounds above "## Log": ${s.bytesAboveLog}/${limits.maxBytesAboveLog} bytes, ${s.linesAboveLog}/${limits.maxLinesAboveLog} lines, ${s.sectionsAboveLog}/${limits.maxSectionsAboveLog} sections.`,
    );
  if (suppressedWarnings > 0)
    lines.push(
      `Suppressed ${suppressedWarnings} old-receipt warning(s) of done items; run with --all-warnings to see them.`,
    );
  return lines.join("\n");
}
