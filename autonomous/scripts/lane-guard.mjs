// Deterministic lane guard.
//
// Autonomous kit, documentation, archive, instruction, validator, and hook maintenance
// belongs to a disjoint support lane, never to the lane that is moving the
// product forward. Prose alone does not hold, so this module makes the rule
// machine-checkable in two places:
//
//   * `node scripts/work.mjs check` fails when a protected path changed in the
//     working tree, or in commits not yet pushed to the upstream branch,
//     without a support-lane record or an item in progress or in review, owned
//     by the support agent, that names it in its `ownedPaths`;
//   * the `PreToolUse` hook in .claude/hooks/ refuses the same edit at the tool
//     call, before the byte is written.
//
// Cooperative-host threat model: this catches the accidental lapse of doing
// support work in the product lane. It is not an access-control system, and a
// recorded, expiring override under .local/runtime/ exists for a real emergency.
// Nothing here writes, moves, or deletes a repository file.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LEGACY_AGENT_NAMES,
  LEGACY_NAMES,
  loadConfig,
  taskIdExample,
  taskIdInProsePattern,
  taskIdPattern,
  withCounterparts,
} from "./autonomous-config.mjs";
import { LIVE_STATE_PATHS, isOpenItem, objectiveId } from "./live-state.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Message records that may grant coverage, by `type`; the `harness_` ones are the kit's old names. */
export const LANE_RECORD_TYPES = Object.freeze([
  "support_result",
  "autonomous_support_result",
  "harness_hygiene_result",
  "harness_support_result",
  "documentation_refresh_result",
  "security_audit_result",
]);

/** Fields on a lane record that may list the covered paths. */
export const LANE_RECORD_PATH_FIELDS = Object.freeze([
  "filesChanged",
  "changedFiles",
  "ownedPaths",
]);

export const LANE_GUARD_PATHS = Object.freeze({
  messages: "work/messages",
  override: ".local/runtime/lane-guard-override.json",
  receipts: ".local/runtime/lane-guard",
});

export const LANE_GUARD_LIMITS = Object.freeze({
  maxRecordFiles: 4096,
  maxRecordBytes: 512 * 1024,
  maxReportedPaths: 64,
  maxReceiptBytes: 16 * 1024,
});

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Protected path patterns for this project. */
export function protectedPathPatterns({ root = ROOT, config = null } = {}) {
  const resolved = config ?? loadConfig({ root });
  const patterns = resolved.lanes?.protectedPaths;
  return Array.isArray(patterns) ? patterns.filter(isText) : [];
}

/** Subagent types allowed to change protected paths. */
export function supportAgentTypes({ root = ROOT, config = null } = {}) {
  const resolved = config ?? loadConfig({ root });
  const types = resolved.lanes?.supportAgentTypes;
  // An agent under the kit's old name counts as its new counterpart, and back.
  return Array.isArray(types) ? withCounterparts(types.filter(isText), LEGACY_AGENT_NAMES) : [];
}

/** Repository-relative, forward-slashed, with no leading "./" or trailing "/". */
export function normalizeRepoPath(value, { root = ROOT } = {}) {
  if (typeof value !== "string" || value.length === 0) return null;
  const raw = value.replaceAll("\\", "/").trim();
  if (raw.length === 0) return null;
  let rel = raw;
  if (isAbsolute(value) || /^[A-Za-z]:\//.test(raw)) {
    const inside = relative(root, resolve(value));
    if (inside.startsWith("..") || isAbsolute(inside)) return null;
    rel = inside.replaceAll("\\", "/");
  }
  rel = rel.replace(/^\.\//, "").replace(/\/+$/, "");
  return rel.length === 0 ? null : rel;
}

/**
 * Translate an ownership pattern into a regular expression. `**` crosses
 * directory separators, `*` does not, a trailing `/` or `/**` covers everything
 * below the directory, and a bare directory name covers the directory itself.
 * An entry may carry a trailing parenthetical note, so only the first
 * whitespace-delimited token is treated as the pattern.
 */
export function patternToRegExp(pattern) {
  if (!isText(pattern)) return null;
  let token = pattern.trim().split(/\s+/)[0].replaceAll("\\", "/").replace(/^\.\//, "");
  if (token.length === 0) return null;
  const directoryScope = token.endsWith("/");
  if (directoryScope) token = token.replace(/\/+$/, "");
  let source = "";
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index];
    if (character === "*") {
      if (token[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  if (directoryScope) source += "(?:/.*)?";
  else if (!token.includes("*")) source += "(?:/.*)?";
  return new RegExp(`^${source}$`);
}

export function matchesPattern(path, pattern) {
  const expression = patternToRegExp(pattern);
  return expression ? expression.test(path) : false;
}

export function isKitPath(path, { root = ROOT, config = null } = {}) {
  const normalized = normalizeRepoPath(path, { root });
  if (!normalized) return false;
  // A file under the kit's old name is protected exactly when its new name is, and back.
  const names = withCounterparts([normalized], LEGACY_NAMES);
  return protectedPathPatterns({ root, config }).some((pattern) =>
    names.some((name) => matchesPattern(name, pattern)),
  );
}

/** Parse `git status --porcelain=v1 -z` output into repository-relative paths. */
export function parsePorcelainStatus(output) {
  const paths = [];
  if (typeof output !== "string" || output.length === 0) return paths;
  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename or copy is followed by its origin path in the next NUL field.
    if (code.includes("R") || code.includes("C")) {
      const origin = entries[index + 1];
      index += 1;
      if (isText(origin)) paths.push(origin.replaceAll("\\", "/"));
    }
    if (isText(path)) paths.push(path.replaceAll("\\", "/"));
  }
  return [...new Set(paths)];
}

function defaultGit(root) {
  return (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}

/**
 * Collect the changed paths worth classifying: the working tree, plus every
 * commit not yet pushed to the upstream branch. The diff runs from the merge
 * base (`@{upstream}...HEAD`, three dots), so a branch that is merely behind
 * its upstream does not report the upstream's own changes as its own.
 * `runGit(args)` must return a `spawnSync`-shaped result; it is injected so a
 * test can stub git, and so a missing git binary degrades to a visible warning.
 */
export function collectChangedPaths({ root = ROOT, runGit } = {}) {
  const git = runGit ?? defaultGit(root);
  const notes = [];
  const result = {
    workingTree: [],
    unpushed: [],
    gitAvailable: true,
    unpushedCommitsScanned: false,
    notes,
  };

  const status = safeGit(git, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!status.ok) {
    result.gitAvailable = false;
    notes.push(
      `lane guard: git status unavailable (${status.reason}); working-tree and commit scans skipped.`,
    );
    return result;
  }
  result.workingTree = parsePorcelainStatus(status.stdout);

  const diff = safeGit(git, ["diff", "--name-only", "-z", "--no-renames", "@{upstream}...HEAD"]);
  if (!diff.ok) {
    notes.push(
      `lane guard: could not compare with the upstream branch (${diff.reason}); unpushed-commit scan skipped.`,
    );
    return result;
  }
  result.unpushedCommitsScanned = true;
  result.unpushed = diff.stdout
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => path.replaceAll("\\", "/"));
  return result;
}

function safeGit(git, args) {
  let outcome;
  try {
    outcome = git(args);
  } catch (error) {
    return { ok: false, reason: error.message, stdout: "" };
  }
  if (!outcome || outcome.error)
    return { ok: false, reason: outcome?.error?.message ?? "no result", stdout: "" };
  if (outcome.status !== 0)
    return {
      ok: false,
      reason: `exit ${outcome.status}: ${(outcome.stderr ?? "").trim()}`,
      stdout: "",
    };
  return { ok: true, reason: null, stdout: outcome.stdout ?? "" };
}

/**
 * Read the support-lane records that may cover a protected path. A record counts
 * when it is a recognized lane-record type with a path list, or when it carries
 * an explicit `laneGuard.coveredPaths` array.
 */
export function readLaneRecords({ root = ROOT } = {}) {
  const directory = resolve(root, LANE_GUARD_PATHS.messages);
  const records = [];
  const notes = [];
  if (!existsSync(directory)) {
    notes.push(`lane guard: ${LANE_GUARD_PATHS.messages} is missing; no support coverage found.`);
    return { records, notes };
  }
  let names;
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch (error) {
    notes.push(`lane guard: could not list ${LANE_GUARD_PATHS.messages}: ${error.message}`);
    return { records, notes };
  }
  if (names.length > LANE_GUARD_LIMITS.maxRecordFiles) {
    notes.push(
      `lane guard: ${names.length} message records exceed the scan bound of ${LANE_GUARD_LIMITS.maxRecordFiles}; only the first ${LANE_GUARD_LIMITS.maxRecordFiles} were read.`,
    );
    names = names.slice(0, LANE_GUARD_LIMITS.maxRecordFiles);
  }
  for (const name of names) {
    const absolute = resolve(directory, name);
    let value;
    try {
      if (!statSync(absolute).isFile()) continue;
      if (statSync(absolute).size > LANE_GUARD_LIMITS.maxRecordBytes) continue;
      value = JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      continue; // A malformed or unreadable record simply grants no coverage.
    }
    const paths = laneRecordPaths(value);
    if (paths.length === 0) continue;
    const hashes = isPlainObject(value.fileHashes) ? value.fileHashes : null;
    records.push({ path: `${LANE_GUARD_PATHS.messages}/${name}`, patterns: paths, hashes });
  }
  return { records, notes };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The SHA-256 of a file's bytes, or null when there is no such file. */
export function fileSha256(root, path) {
  try {
    const absolute = resolve(root, path);
    if (!statSync(absolute).isFile()) return null;
    return createHash("sha256").update(readFileSync(absolute)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Whether a record still covers one path. A record that pins the path's bytes
 * in `fileHashes` (every record the kit's own commands write does) covers it
 * only while the file still has those bytes, or is still absent when the pin is
 * null. A record with no pin for the path vouches only for the change it travels
 * with: it covers the path while the record itself is not yet pushed (`pending`
 * holds the changed paths), and a later edit needs its own support lane.
 */
function recordStillCovers(record, path, root, pending) {
  if (!record.hashes || !Object.hasOwn(record.hashes, path)) return pending.has(record.path);
  const pinned = record.hashes[path];
  return fileSha256(root, path) === (typeof pinned === "string" ? pinned.toLowerCase() : pinned);
}

function laneRecordPaths(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const explicit = value.laneGuard?.coveredPaths;
  if (Array.isArray(explicit)) return explicit.filter(isText);
  if (!LANE_RECORD_TYPES.includes(value.type)) return [];
  const paths = [];
  for (const field of LANE_RECORD_PATH_FIELDS) {
    const candidate = value[field];
    if (Array.isArray(candidate)) paths.push(...candidate.filter(isText));
  }
  return paths;
}

/**
 * Read the items under work/items without validating them. A malformed item is
 * the queue validator's error, not this module's, so it is skipped here.
 */
export function readItems({ root = ROOT } = {}) {
  const items = [];
  const notes = [];
  try {
    const directory = resolve(root, "work/items");
    for (const name of readdirSync(directory)
      .filter((entry) => entry.endsWith(".json"))
      .sort()) {
      try {
        items.push(JSON.parse(readFileSync(resolve(directory, name), "utf8")));
      } catch {
        // A malformed task is the queue validator's error, not this one's.
      }
    }
  } catch (error) {
    notes.push(`lane guard: could not read work/items: ${error.message}`);
  }
  return { items, notes };
}

/**
 * Ownership held by the support lane: an item in progress or in review whose
 * owner is one of `lanes.supportAgentTypes` covers its `ownedPaths`. A ready,
 * blocked, or done item covers nothing.
 */
export function supportOwnership(items, { root = ROOT, config = null } = {}) {
  const support = new Set(supportAgentTypes({ root, config }));
  return (Array.isArray(items) ? items : [])
    .filter((item) => ["in_progress", "review"].includes(item?.status) && support.has(item?.owner))
    .map((item) => ({
      id: isText(item.id) ? item.id : "(unnamed item)",
      patterns: (Array.isArray(item.ownedPaths) ? item.ownedPaths : []).filter(isText),
    }));
}

/** Read the recorded, expiring manual override. An expired file grants nothing. */
export function readOverride({ root = ROOT, now = new Date() } = {}) {
  const absolute = resolve(root, LANE_GUARD_PATHS.override);
  if (!existsSync(absolute)) return { active: false, reasonCode: "absent", override: null };
  let value;
  try {
    value = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    return { active: false, reasonCode: "malformed", override: null, detail: error.message };
  }
  if (!isText(value?.reason) || !isText(value?.recordedBy))
    return { active: false, reasonCode: "incomplete", override: value };
  const expiry = Date.parse(value?.expiresAt ?? "");
  if (Number.isNaN(expiry)) return { active: false, reasonCode: "no_expiry", override: value };
  if (expiry <= now.getTime()) return { active: false, reasonCode: "expired", override: value };
  return {
    active: true,
    reasonCode: "active",
    override: {
      reason: value.reason,
      recordedBy: value.recordedBy,
      expiresAt: value.expiresAt,
      paths: Array.isArray(value.paths) ? value.paths.filter(isText) : null,
    },
  };
}

function coverageFor(path, { records, ownership, root, pending }) {
  for (const owner of ownership) {
    if (owner.patterns.some((pattern) => matchesPattern(path, pattern)))
      return { kind: "support_item", by: owner.id };
  }
  for (const record of records) {
    if (
      record.patterns.some((pattern) => matchesPattern(path, pattern)) &&
      recordStillCovers(record, path, root, pending)
    )
      return { kind: "support_record", by: record.path };
  }
  return null;
}

/**
 * Decide, for one set of candidate paths (the changes not yet pushed), which
 * protected changes lack a support lane. A record among those paths travels with
 * them. Pure: every input is supplied by the caller.
 */
export function classifyKitPaths(
  paths,
  { records = [], ownership = [], root = ROOT, config = null } = {},
) {
  const covered = [];
  const uncovered = [];
  const pending = new Set(paths.map((path) => normalizeRepoPath(path, { root })).filter(Boolean));
  const seen = new Set();
  for (const candidate of paths) {
    const path = normalizeRepoPath(candidate, { root });
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (!isKitPath(path, { root, config })) continue;
    const coverage = coverageFor(path, { records, ownership, root, pending });
    if (coverage) covered.push({ path, ...coverage });
    else uncovered.push(path);
  }
  covered.sort((a, b) => a.path.localeCompare(b.path));
  uncovered.sort((a, b) => a.localeCompare(b));
  return { covered, uncovered };
}

/**
 * Full evaluation for `node scripts/work.mjs check`. Returns errors (which fail
 * the check), warnings (which stay visible but do not fail), and the material
 * for a bounded receipt.
 */
export function evaluateLaneGuard({ root = ROOT, items = null, runGit, now = new Date() } = {}) {
  const config = loadConfig({ root });
  const errors = [];
  const warnings = [];
  let resolvedItems = items;
  if (resolvedItems === null) {
    const read = readItems({ root });
    resolvedItems = read.items;
    warnings.push(...read.notes);
  }
  const changes = collectChangedPaths({ root, runGit });
  warnings.push(...changes.notes);

  const { records, notes } = readLaneRecords({ root });
  warnings.push(...notes);
  const ownership = supportOwnership(resolvedItems, { root, config });

  const classification = classifyKitPaths([...changes.workingTree, ...changes.unpushed], {
    records,
    ownership,
    root,
    config,
  });

  const override = readOverride({ root, now });
  let overridden = [];
  let uncovered = classification.uncovered;
  if (override.active && uncovered.length > 0) {
    const scope = override.override.paths;
    overridden = scope
      ? uncovered.filter((path) => scope.some((pattern) => matchesPattern(path, pattern)))
      : [...uncovered];
    uncovered = uncovered.filter((path) => !overridden.includes(path));
    if (overridden.length > 0)
      warnings.push(
        `lane guard: manual override by ${override.override.recordedBy} (expires ${override.override.expiresAt}) permits ${overridden.length} undelegated protected path(s): ${truncate(overridden)}. Reason: ${override.override.reason}`,
      );
  } else if (override.reasonCode === "expired") {
    warnings.push("lane guard: the manual override has expired and grants nothing.");
  } else if (["malformed", "incomplete", "no_expiry"].includes(override.reasonCode)) {
    warnings.push(
      `lane guard: ${LANE_GUARD_PATHS.override} is ${override.reasonCode} and grants nothing; an override needs reason, recordedBy, and a future expiresAt.`,
    );
  }

  if (uncovered.length > 0) {
    const [supportAgent = "a support agent"] = supportAgentTypes({ root, config });
    errors.push(
      [
        `Lane guard: ${uncovered.length} protected path(s) changed without a support lane that owns them:`,
        ...uncovered.slice(0, LANE_GUARD_LIMITS.maxReportedPaths).map((path) => `  - ${path}`),
        uncovered.length > LANE_GUARD_LIMITS.maxReportedPaths
          ? `  ... and ${uncovered.length - LANE_GUARD_LIMITS.maxReportedPaths} more`
          : null,
        "Autonomous kit, documentation, archive, instruction, validator, and hook work belongs to a disjoint",
        `${supportAgent} agent. Delegate it, list these paths in the ownedPaths of an item in progress`,
        "or in review that agent owns, record the change in a work/messages support result that names",
        `them and pins their bytes in fileHashes, or record a bounded override in ${LANE_GUARD_PATHS.override}.`,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    );
  }

  return {
    errors,
    warnings,
    gitAvailable: changes.gitAvailable,
    unpushedCommitsScanned: changes.unpushedCommitsScanned,
    scannedRecords: records.length,
    supportItems: ownership.map((owner) => owner.id),
    covered: classification.covered,
    uncovered,
    overridden,
    override: override.active ? override.override : null,
  };
}

function truncate(paths) {
  const shown = paths.slice(0, LANE_GUARD_LIMITS.maxReportedPaths);
  return shown.join(", ") + (paths.length > shown.length ? ", ..." : "");
}

/**
 * Write a bounded private receipt. Receipts hold decisions and paths only:
 * never prompts, file contents, transcripts, credentials, or personal data.
 * Returns the receipt path, or null when the receipt could not be written
 * (which must never block the caller's real work).
 */
export function writeLaneGuardReceipt(body, { root = ROOT, name = null, onlyIfNew = false } = {}) {
  try {
    const directory = resolve(root, LANE_GUARD_PATHS.receipts);
    mkdirSync(directory, { recursive: true });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const fileName =
      name ??
      `${stamp}-${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 8)}.json`;
    const absolute = resolve(directory, fileName);
    if (onlyIfNew && existsSync(absolute)) return `${LANE_GUARD_PATHS.receipts}/${fileName}`;
    let text = `${JSON.stringify(body, null, 2)}\n`;
    if (Buffer.byteLength(text, "utf8") > LANE_GUARD_LIMITS.maxReceiptBytes)
      text = `${JSON.stringify({ truncated: true, recordedAt: body?.recordedAt ?? null, decision: body?.decision ?? null }, null, 2)}\n`;
    writeFileSync(absolute, text, "utf8");
    return `${LANE_GUARD_PATHS.receipts}/${fileName}`;
  } catch {
    return null;
  }
}

/**
 * Return the body of one `## ` section, or "" when the heading is absent. Used to
 * apply the stricter no-task-id rule to one section only.
 */
export function sectionBody(markdown, heading) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const start = lines.findIndex(
    (line) => /^##\s+/.test(line) && line.replace(/^##\s+/, "").trim() === heading,
  );
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s+/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * Keep the instruction files milestone-neutral. The rulebook holds what outlives
 * a milestone, and the live milestone is named only in `work/CHECKPOINT.md`. A
 * stale task id in an always-loaded instruction file is exactly the drift this
 * catches.
 *
 * Two rules, deliberately different in strictness:
 *   - the milestone-neutral section may name no task id at all;
 *   - elsewhere a task id is allowed only while it is genuinely live, meaning it
 *     is the checkpoint's primary objective or an open (approved, not done) item.
 * Pure: the caller supplies the file contents, the objective, and the open ids.
 */
export function evaluateInstructionTaskIds({
  files = {},
  primaryObjectiveTaskId = null,
  openTaskIds = [],
  section = null,
  config = null,
} = {}) {
  const resolved = config ?? loadConfig();
  const heading = section ?? resolved.lanes?.milestoneNeutralSection ?? "Big picture";
  const inProse = taskIdInProsePattern(resolved);
  const allowed = new Set(
    [primaryObjectiveTaskId, ...(Array.isArray(openTaskIds) ? openTaskIds : [])].filter(isText),
  );
  const errors = [];
  const found = [];
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== "string") continue;
    const sectionText = sectionBody(text, heading);
    const inSection = new Set(sectionText.match(inProse) ?? []);
    for (const id of inSection) {
      found.push({ path, id, where: heading });
      errors.push(
        `${path}: the "${heading}" section names ${id}. That section must stay milestone-neutral; ` +
          `the live milestone belongs in ${LIVE_STATE_PATHS.checkpoint}.`,
      );
    }
    for (const id of new Set(text.match(inProse) ?? [])) {
      if (inSection.has(id)) continue;
      found.push({ path, id, where: "body" });
      if (allowed.has(id)) continue;
      errors.push(
        `${path}: names ${id}, which is neither the checkpoint's primary objective nor an open item` +
          `${allowed.size ? ` (${[...allowed].join(", ")})` : " (none recorded)"}. ` +
          "Remove the stale task id or make the sentence milestone-neutral.",
      );
    }
  }
  return { ok: errors.length === 0, errors, found, allowed: [...allowed] };
}

/**
 * Read the instruction files, the checkpoint, and the items from disk, then
 * apply `evaluateInstructionTaskIds`. Unreadable inputs degrade to a warning so
 * this check can never be the reason a product lane stops.
 */
export function inspectInstructionTaskIds({ root = ROOT } = {}) {
  const config = loadConfig({ root });
  const warnings = [];
  const files = {};
  for (const path of config.lanes?.instructionFiles ?? []) {
    try {
      files[path] = readFileSync(resolve(root, path), "utf8");
    } catch (error) {
      warnings.push(
        `lane guard: could not read ${path} for the milestone-neutral check: ${error.message}`,
      );
    }
  }
  let primaryObjectiveTaskId = null;
  try {
    const checkpoint = readFileSync(resolve(root, LIVE_STATE_PATHS.checkpoint), "utf8");
    primaryObjectiveTaskId = objectiveId(checkpoint, { config });
  } catch (error) {
    warnings.push(`lane guard: could not read the primary objective: ${error.message}`);
  }
  const read = readItems({ root });
  warnings.push(...read.notes);
  const result = evaluateInstructionTaskIds({
    files,
    primaryObjectiveTaskId,
    openTaskIds: read.items.filter(isOpenItem).map((item) => item.id),
    config,
  });
  return { ...result, warnings };
}

// ---------------------------------------------------------------------------
// Reference freshness.
//
// The milestone-neutral check above stops the instructions naming a task that
// has moved on. This one stops the other half of the same rot: an always-loaded
// file pointing at a script, hook, runtime, or document that no longer exists.
// A fresh session believes those pointers, so a dead one costs a real detour
// before anybody notices.
// ---------------------------------------------------------------------------

/**
 * Prefixes whose contents are runtime state, not source. A path under one of
 * these is a legitimate reference to something that may not exist yet (a
 * receipt directory, an override file that is written only in an emergency).
 */
export const REFERENCE_RUNTIME_PREFIXES = Object.freeze([
  ".local/",
  "outputs/",
  "secrets/",
  "node_modules/",
]);

export const REFERENCE_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024,
  maxCandidates: 512,
});

/**
 * Pull path-like tokens out of Markdown: backtick code spans and link targets.
 * A code span is split on whitespace so `node scripts/work.mjs check` still
 * yields the script path. Everything ambiguous is dropped rather than guessed,
 * because a false failure here would block an unrelated lane.
 */
export function extractPathCandidates(markdown, { limit = REFERENCE_LIMITS.maxCandidates } = {}) {
  const text = String(markdown ?? "");
  const tokens = [];
  for (const match of text.matchAll(/`([^`\n]{1,200})`/g)) tokens.push(...match[1].split(/\s+/));
  for (const match of text.matchAll(/\]\(([^)\s]{1,200})\)/g)) tokens.push(match[1]);
  const seen = new Set();
  for (const raw of tokens) {
    if (seen.size >= limit) break;
    const token = raw.replace(/^[(<"']+/, "").replace(/[)>"',.;:]+$/, "");
    if (!token || token.includes("*") || token.includes("?") || token.includes("<")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(token) || token.startsWith("#")) continue;
    if (isAbsolute(token) || token.split("/").includes("..")) continue;
    const normalized = token.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!normalized || !/[./]/.test(normalized)) continue;
    if (!normalized.includes("/") && !/\.(md|json|mjs|js|html|ya?ml)$/i.test(normalized)) continue;
    seen.add(normalized);
  }
  return [...seen];
}

/**
 * A candidate is only checked when its first segment is a real repository entry.
 * That single rule removes the whole class of false positives — branch names,
 * owner/repo slugs, prose containing a dot — without needing a keyword list.
 */
export function shouldResolveCandidate(candidate, { root = ROOT } = {}) {
  if (REFERENCE_RUNTIME_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return false;
  const [first] = candidate.split("/");
  if (!first) return false;
  try {
    return existsSync(resolve(root, first));
  } catch {
    return false;
  }
}

/** Every `.claude/hooks/*.mjs` path named by a settings.json hook command. */
export function hookCommandTargets(settings) {
  const targets = new Set();
  const events = settings?.hooks;
  if (!events || typeof events !== "object") return [];
  for (const matchers of Object.values(events)) {
    for (const matcher of Array.isArray(matchers) ? matchers : []) {
      for (const hook of Array.isArray(matcher?.hooks) ? matcher.hooks : []) {
        if (typeof hook?.command !== "string") continue;
        for (const match of hook.command.matchAll(/\.claude\/hooks\/[A-Za-z0-9._-]+\.mjs/g))
          targets.add(match[0]);
      }
    }
  }
  return [...targets];
}

/**
 * Check that the always-loaded files and the registered hooks point at things
 * that exist. Errors are dead references; warnings are the softer signals (an
 * unreadable file, an executable hook nobody registered).
 */
export function inspectKitReferences({ root = ROOT, files = null, settings = null } = {}) {
  const config = loadConfig({ root });
  const errors = [];
  const warnings = [];
  const dead = [];
  const checked = [];

  const sources =
    files ??
    Object.fromEntries(
      (config.lanes?.referenceFiles ?? [])
        .map((path) => {
          try {
            const absolute = resolve(root, path);
            if (statSync(absolute).size > REFERENCE_LIMITS.maxFileBytes) {
              warnings.push(`lane guard: ${path} is too large to scan for dead references.`);
              return [path, null];
            }
            return [path, readFileSync(absolute, "utf8")];
          } catch (error) {
            warnings.push(
              `lane guard: could not read ${path} for the reference check: ${error.message}`,
            );
            return [path, null];
          }
        })
        .filter(([, text]) => text !== null),
    );

  for (const [path, text] of Object.entries(sources)) {
    for (const candidate of extractPathCandidates(text)) {
      if (!shouldResolveCandidate(candidate, { root })) continue;
      checked.push({ source: path, reference: candidate });
      if (!existsSync(resolve(root, candidate))) dead.push({ source: path, reference: candidate });
    }
  }
  for (const entry of dead)
    errors.push(
      `${entry.source} points at ${entry.reference}, which does not exist. Update the reference or restore the file.`,
    );

  let parsed = settings;
  if (parsed === null) {
    try {
      parsed = JSON.parse(readFileSync(resolve(root, ".claude/settings.json"), "utf8"));
    } catch (error) {
      warnings.push(`lane guard: could not read .claude/settings.json: ${error.message}`);
      parsed = null;
    }
  }
  const registered = parsed ? hookCommandTargets(parsed) : [];
  const missingHooks = registered.filter((target) => !existsSync(resolve(root, target)));
  for (const target of missingHooks)
    errors.push(
      `.claude/settings.json registers ${target}, which does not exist. A hook that cannot run is silent, not safe.`,
    );

  if (parsed) {
    try {
      const registeredSet = new Set(registered);
      for (const name of readdirSync(resolve(root, ".claude/hooks"))) {
        if (!name.endsWith(".mjs")) continue;
        const relativePath = `.claude/hooks/${name}`;
        if (registeredSet.has(relativePath)) continue;
        // A shared module has no shebang; an unregistered *hook* does.
        const head = readFileSync(resolve(root, relativePath), "utf8").slice(0, 64);
        if (head.startsWith("#!"))
          warnings.push(
            `lane guard: ${relativePath} looks like a hook but no .claude/settings.json event registers it.`,
          );
      }
    } catch (error) {
      warnings.push(`lane guard: could not list .claude/hooks: ${error.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    dead,
    missingHooks,
    checkedCount: checked.length,
  };
}

// ---------------------------------------------------------------------------
// Documentation upkeep: the changelog and the documentation map.
//
// Every document in the repository is either maintained or archived, and the
// changelog stays current. Both are objective, so both are checked rather than
// trusted.
// ---------------------------------------------------------------------------

/**
 * Every accepted task must be named in the changelog. `acceptedAt` is the only
 * signal that a task reached the owner, so a done task without one is outside
 * the rule rather than a failure.
 */
export function evaluateChangelogCoverage({
  items = [],
  changelog = "",
  requiredFrom = null,
  changelogPath = "CHANGELOG.md",
} = {}) {
  const from = requiredFrom ?? "1970-01-01";
  const text = String(changelog ?? "");
  const missing = [];
  const covered = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.status !== "done" || !isText(item?.acceptedAt)) continue;
    if (item.acceptedAt.slice(0, 10) < from) continue;
    if (!isText(item.id)) continue;
    if (text.includes(item.id)) covered.push(item.id);
    else missing.push({ id: item.id, acceptedAt: item.acceptedAt });
  }
  return {
    ok: missing.length === 0,
    missing,
    covered,
    errors: missing.map(
      (entry) =>
        `${entry.id} was accepted on ${entry.acceptedAt} but ${changelogPath} does not mention it. Add a dated plain-language entry naming ${entry.id}.`,
    ),
  };
}

/**
 * Enumerate live documents: prose (`.md`) anywhere outside the excluded trees,
 * and `.html` only under `docs/`. Application or test markup is not a document,
 * and listing it in the owner's map would be noise. In a git checkout the
 * candidates are the files git would commit (`git ls-files -co
 * --exclude-standard`), so whatever .gitignore leaves out (a virtual
 * environment, a build folder, a tool's cache) is not a document; outside one,
 * the folders are walked.
 */
export function listLiveDocuments({ root = ROOT, maxFiles = 512, config = null, runGit } = {}) {
  const resolved = config ?? loadConfig({ root });
  const excluded = new Set(resolved.documentation?.excludedSegments ?? []);
  const isDocument = (path) =>
    /\.md$/i.test(path) || (/\.html$/i.test(path) && path.startsWith("docs/"));
  const listed = safeGit(runGit ?? defaultGit(root), [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (listed.ok) {
    const paths = new Set(
      listed.stdout
        .split("\0")
        .map((path) => path.replaceAll("\\", "/"))
        .filter((path) => isDocument(path) && !path.split("/").some((part) => excluded.has(part)))
        // A tracked file deleted from the working tree is no longer a document.
        .filter((path) => existsSync(resolve(root, path))),
    );
    return [...paths].sort().slice(0, maxFiles);
  }
  const found = [];
  const walk = (relativeDir) => {
    if (found.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(resolve(root, relativeDir || "."), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (excluded.has(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (isDocument(path)) found.push(path);
    }
  };
  walk("");
  return found.sort();
}

/** Resolve a map href against the directory the map page lives in. */
export function resolveMapHref(href, { mapDirectory = "docs/project" } = {}) {
  const target = String(href ?? "")
    .split("#")[0]
    .split("?")[0]
    .replace(/\/+$/, "");
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const segments = [...mapDirectory.split("/").filter(Boolean), ...target.split("/")];
  const out = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/**
 * Every live document must appear in the documentation map, which lives in the
 * owner dashboard. A document is mapped when the page links it by a path that
 * resolves to it.
 */
export function evaluateDocumentationMap({
  documents = [],
  map = "",
  mapDirectory = "docs/project",
  mapPath = "docs/project/status.html",
  exempt = [],
} = {}) {
  const targets = [...String(map ?? "").matchAll(/href="([^"]+)"/g)]
    .map((match) => resolveMapHref(match[1], { mapDirectory }))
    .filter(Boolean);

  // A whole set of pages that share one purpose gets one row, not one row per
  // page. A row covers a directory when its href is the directory itself, or
  // that directory's index page.
  const mapped = new Set(targets);
  const mappedDirectories = new Set();
  for (const target of targets) {
    const segments = target.split("/");
    const last = segments[segments.length - 1];
    if (last === "index.html") mappedDirectories.add(segments.slice(0, -1).join("/"));
    else if (!last.includes(".")) mappedDirectories.add(target);
  }

  const unmapped = [];
  for (const document of documents) {
    if (exempt.includes(document)) continue;
    if (mapped.has(document)) continue;
    if ([...mappedDirectories].some((dir) => dir && document.startsWith(`${dir}/`))) continue;
    unmapped.push(document);
  }
  return {
    ok: unmapped.length === 0,
    unmapped,
    errors: unmapped.map(
      (document) =>
        `${document} is not in the documentation map in ${mapPath}. Add a row with its purpose, authority, update trigger, and checker, or archive it under docs/archive/ with a manifest entry.`,
    ),
  };
}

/** Read the real files and run both documentation-upkeep checks. */
export function inspectDocumentationUpkeep({ root = ROOT, items = null } = {}) {
  const config = loadConfig({ root });
  const changelogPath = config.documentation?.changelogPath ?? "CHANGELOG.md";
  const mapPath = config.documentation?.statusDocument ?? "docs/project/status.html";
  const warnings = [];
  let changelog = "";
  try {
    changelog = readFileSync(resolve(root, changelogPath), "utf8");
  } catch (error) {
    warnings.push(`lane guard: could not read ${changelogPath}: ${error.message}`);
  }
  let map = "";
  try {
    map = readFileSync(resolve(root, mapPath), "utf8");
  } catch (error) {
    warnings.push(`lane guard: could not read the documentation map: ${error.message}`);
  }
  let tasks = items;
  if (tasks === null) {
    const read = readItems({ root });
    tasks = read.items;
    warnings.push(...read.notes);
  }
  const coverage = evaluateChangelogCoverage({
    items: tasks,
    changelog,
    requiredFrom: config.documentation?.changelogRequiredFrom,
    changelogPath,
  });
  const documents = listLiveDocuments({ root, config });
  const mapping = map
    ? evaluateDocumentationMap({
        documents,
        map,
        mapDirectory: dirname(mapPath).replaceAll("\\", "/"),
        mapPath,
        exempt: config.documentation?.documentMapExempt ?? [],
      })
    : { ok: true, unmapped: [], errors: [] };
  return {
    ok: coverage.ok && mapping.ok,
    errors: [...coverage.errors, ...mapping.errors],
    warnings,
    missingChangelogEntries: coverage.missing,
    unmappedDocuments: mapping.unmapped,
    documentCount: documents.length,
  };
}

// ---------------------------------------------------------------------------
// Host-identity exposure and commit identity.
//
// This machine's username inside a committed file, as in the home path of a
// record, is not a credential, but it is personal data that should not leave the
// machine. These checks are generic on purpose: no username literal is stored in
// this file, so the guard cannot leak the value it protects. The host's names are
// resolved at runtime and count only as a whole segment of a Windows, WSL, macOS,
// or Linux home path, reported with the name replaced by "<user>". A home path of
// any other user, such as a container user's in a Dockerfile, is ordinary content.
// ---------------------------------------------------------------------------

/** Usernames that are deliberate placeholders and never an exposure. */
export const REDACTION_PLACEHOLDERS = Object.freeze([
  "<user>",
  "<username>",
  "<username-redacted>",
  "<redacted>",
  "example-user",
  "test-user",
  "runner",
  "user",
  "username",
  "%username%",
  "$user",
  "$env:username",
  "public",
  "default",
]);

/** Tracked trees whose bytes are hash-bound and must never be edited in place. */
export const PRESERVED_ARCHIVE_PREFIXES = Object.freeze(["work/archive/", "docs/archive/"]);

/**
 * The start of a user's home directory, on each platform: `C:\Users\` (any
 * drive, either slash), WSL's `/mnt/c/Users/`, macOS's `/Users/`, and Linux's
 * `/home/`. The forward-slash forms must not follow a word character, a dot, or
 * a dash, so a URL path such as `example.com/home/page` or a relative
 * `./home/x` is not mistaken for a home directory.
 */
const USER_HOME_PREFIX = String.raw`(?:(?<![\w.%-])[A-Za-z]:(?:\\{1,2}|\/)[Uu]sers(?:\\{1,2}|\/)|(?<![\w.%-])\/mnt\/[A-Za-z]\/[Uu]sers\/|(?<![\w.%-])\/Users\/|(?<![\w.%-])\/home\/)`;
/** Characters that end a path segment. */
const SEGMENT_END = String.raw`(?=[\\/"'\x60\s:*?<>|,)\]}]|$)`;

/** A host name as a whole home-directory segment, in any letter case; group 1 is the prefix. */
function hostNameInPathExpression(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(${USER_HOME_PREFIX})${escaped}${SEGMENT_END}`, "gi");
}

export const HOST_IDENTITY_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxReportedFiles: 40,
  maxFindingsPerFile: 5,
});

function isPlaceholderName(name) {
  const value = String(name);
  // A template or shell expansion such as "${USER}", "<user>", "%USERNAME%", or
  // "~" is a placeholder by construction, not an exposed identity.
  if (/[$<>{}%~*]/.test(value)) return true;
  return REDACTION_PLACEHOLDERS.includes(value.toLowerCase());
}

/** Usernames of the current host, resolved at runtime and never stored. */
export function hostIdentityCandidates() {
  const names = new Set();
  try {
    const home = basename(homedir());
    if (isText(home)) names.add(home);
  } catch {
    /* a missing home directory is not an error here */
  }
  try {
    const user = userInfo().username;
    if (isText(user)) names.add(user);
  } catch {
    /* missing user info is not an error here */
  }
  return [...names].filter((name) => !isPlaceholderName(name));
}

/**
 * Find this host's username in the home-directory paths of one text blob. Only
 * the host's own names count, and only as a whole path segment: a user named
 * "node" must not fail every file that says "node", and another user's home
 * path is not this machine's identity. Findings are returned already redacted,
 * the name replaced by "<user>", so the check output never reproduces the value
 * it protects.
 */
export function scanTextForHostIdentity(text, { hostNames = [] } = {}) {
  const findings = [];
  if (typeof text !== "string" || text.length === 0) return findings;
  const seen = new Set();
  for (const name of hostNames) {
    if (!isText(name) || isPlaceholderName(name)) continue;
    for (const match of text.matchAll(hostNameInPathExpression(name))) {
      const redacted = `${match[1]}<user>`;
      if (seen.has(redacted)) continue;
      seen.add(redacted);
      findings.push({ kind: "host_username", redactedSample: redacted });
    }
  }
  return findings.slice(0, HOST_IDENTITY_LIMITS.maxFindingsPerFile);
}

function isPreservedArchive(path) {
  return PRESERVED_ARCHIVE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Everything a commit could capture that is worth opening: tracked files that
 * `git grep` says mention a home directory, plus every non-ignored untracked
 * file. Narrowing with `git grep` keeps the check fast; if git cannot narrow,
 * the scan falls back to every tracked file.
 */
export function committableFiles({ root = ROOT, runGit } = {}) {
  const git = runGit ?? defaultGit(root);
  const notes = [];
  const files = new Set();

  const grep = (args) => {
    let outcome;
    try {
      outcome = git(args);
    } catch (error) {
      return { ok: false, reason: error.message, stdout: "" };
    }
    // git grep exits 1 with no output when nothing matched; that is a result.
    if (outcome?.status === 1 && !(outcome.stderr ?? "").trim())
      return { ok: true, reason: null, stdout: outcome.stdout ?? "" };
    return safeGit(() => outcome, args);
  };

  // A superset of what the scan matches: every home-directory form, in any case.
  const patterns = [
    ["-i", "-E", "users[\\\\/]"],
    ["-F", "/home/"],
  ];
  let narrowed = true;
  for (const flags of patterns) {
    const found = grep(["grep", "-I", "-l", "-z", ...flags, "--", "."]);
    if (!found.ok) {
      narrowed = false;
      notes.push(
        `host-identity scan: git grep unavailable (${found.reason}); scanning every tracked file.`,
      );
      break;
    }
    for (const entry of found.stdout.split("\0")) {
      if (isText(entry)) files.add(entry.replaceAll("\\", "/"));
    }
  }

  if (!narrowed) {
    files.clear();
    const tracked = safeGit(git, ["ls-files", "-z"]);
    if (!tracked.ok) {
      notes.push(`host-identity scan: git ls-files unavailable (${tracked.reason}); scan skipped.`);
      return { files: [], notes, gitAvailable: false };
    }
    for (const entry of tracked.stdout.split("\0")) {
      if (isText(entry)) files.add(entry.replaceAll("\\", "/"));
    }
  }

  const untracked = safeGit(git, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!untracked.ok)
    notes.push(
      `host-identity scan: git status unavailable (${untracked.reason}); untracked files were not scanned.`,
    );
  else for (const path of parsePorcelainStatus(untracked.stdout)) files.add(path);
  return { files: [...files].sort(), notes, gitAvailable: true };
}

/**
 * Scan every committable file for host-identity exposure. Live files produce
 * errors; preserved archive copies produce warnings, because their bytes are
 * hash-bound and their remediation is an owner-only history decision.
 */
export function evaluateHostIdentityExposure({
  root = ROOT,
  runGit,
  files = null,
  hostNames = hostIdentityCandidates(),
} = {}) {
  const errors = [];
  const warnings = [];
  let candidates = files;
  let gitAvailable = true;
  if (candidates === null) {
    const collected = committableFiles({ root, runGit });
    candidates = collected.files;
    warnings.push(...collected.notes);
    gitAvailable = collected.gitAvailable;
  }

  const exposed = [];
  const archived = [];
  for (const path of candidates) {
    const absolute = resolve(root, path);
    let text;
    try {
      if (!existsSync(absolute)) continue;
      const stats = statSync(absolute);
      if (!stats.isFile() || stats.size > HOST_IDENTITY_LIMITS.maxFileBytes) continue;
      const buffer = readFileSync(absolute);
      if (buffer.includes(0)) continue; // binary
      text = buffer.toString("utf8");
    } catch {
      continue;
    }
    // Cheap pre-filter: only the few files that mention a home directory are
    // worth running the expressions over.
    if (!/users[\\/]|\/home\//i.test(text)) continue;
    const findings = scanTextForHostIdentity(text, { hostNames });
    if (findings.length === 0) continue;
    (isPreservedArchive(path) ? archived : exposed).push({ path, findings });
  }

  if (archived.length > 0)
    warnings.push(
      `Host identity: ${archived.length} preserved archive file(s) still contain this host's username in a home-directory path (${archived
        .slice(0, HOST_IDENTITY_LIMITS.maxReportedFiles)
        .map((entry) => entry.path)
        .join(
          ", ",
        )}). Archived bytes are hash-bound and append-only; remediating them is an owner-only history decision, never an in-place edit.`,
    );

  if (exposed.length > 0)
    errors.push(
      [
        `Host identity: ${exposed.length} committable file(s) contain this host's username in a home-directory path (redacted):`,
        ...exposed
          .slice(0, HOST_IDENTITY_LIMITS.maxReportedFiles)
          .map(
            (entry) =>
              `  - ${entry.path}: ${entry.findings.map((finding) => finding.redactedSample).join("; ")}`,
          ),
        exposed.length > HOST_IDENTITY_LIMITS.maxReportedFiles
          ? `  ... and ${exposed.length - HOST_IDENTITY_LIMITS.maxReportedFiles} more`
          : null,
        'Replace the username with "<username-redacted>", add a "redaction" field to the record,',
        "and use repository-relative paths in new records. Never delete the record.",
      ]
        .filter((line) => line !== null)
        .join("\n"),
    );

  return { errors, warnings, exposed, archived, gitAvailable, scannedFiles: candidates.length };
}

/**
 * Verify that a commit made now would carry the configured identity. `git var`
 * already resolves environment overrides plus repository and global
 * configuration. An unset `git.commitEmail` disables the check.
 */
export function evaluateCommitIdentity({
  root = ROOT,
  runGit,
  commandLine = null,
  requiredEmail = null,
} = {}) {
  const config = loadConfig({ root });
  const required = (requiredEmail ?? config.git?.commitEmail ?? "").trim().toLowerCase();
  if (!required)
    return {
      ok: true,
      problems: [],
      observed: {},
      requiredEmail: null,
      skipped: "git.commitEmail is not configured",
    };
  const git = runGit ?? defaultGit(root);
  const problems = [];
  const observed = {};
  for (const [field, variable] of [
    ["author", "GIT_AUTHOR_IDENT"],
    ["committer", "GIT_COMMITTER_IDENT"],
  ]) {
    const result = safeGit(git, ["var", variable]);
    if (!result.ok) {
      problems.push(`Could not resolve the ${field} identity (${result.reason}).`);
      continue;
    }
    const email = /<([^>]*)>/.exec(result.stdout.trim())?.[1] ?? null;
    observed[field] = email;
    if (!isText(email)) problems.push(`The ${field} identity has no email address.`);
    else if (email.toLowerCase() !== required)
      problems.push(
        `The ${field} email is not ${required}; run \`git config user.email ${required}\` before committing.`,
      );
  }
  if (isText(commandLine)) {
    const override = /--author[=\s]+["']?[^"'<]*<([^>]+)>/.exec(commandLine)?.[1] ?? null;
    if (override) {
      observed.authorOverride = override;
      if (override.toLowerCase() !== required)
        problems.push(
          `The command overrides the author email with a value that is not ${required}.`,
        );
    }
    if (/(?:^|\s)(?:-c|--config-env)\s+user\.email=/.test(commandLine))
      problems.push(
        "The command sets user.email inline; commit with the configured identity instead.",
      );
  }
  return { ok: problems.length === 0, problems, observed, requiredEmail: required };
}

/** Does this shell command line create a commit? */
export function isCommitCommand(commandLine) {
  if (typeof commandLine !== "string") return false;
  // `git` must sit in command position: start of the line, or after a shell
  // separator. "echo git commit" is not a commit.
  return /(?:^|[;&|(\n]\s*)\s*git\b[^;&|\n]*\bcommit\b/.test(commandLine);
}

/** Exported for callers that want the configured task-id shape. */
export { taskIdExample, taskIdPattern };
