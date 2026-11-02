#!/usr/bin/env node
// Install the autonomous kit into a project.
//
//   node bin/autonomous-install.mjs <target-directory> [options]
//
// It copies the autonomous kit scripts, hooks, and agent definitions verbatim, and the
// project scaffold (rulebook, work skeleton, living documents) with the
// placeholders filled in. Nothing existing is overwritten unless --force is
// given, and an existing .claude/settings.json is never replaced: the autonomous kit
// hooks are merged into it, after a backup under .local/backups/. The whole plan
// is worked out before anything is written, so --dry-run reports exactly what a
// real run writes. The protected files it writes are named in a support-lane
// record under work/messages/, so the project's own check passes at once.
//
// Run again in a project that has the kit, it updates it:
//
//   node bin/autonomous-install.mjs <project> --force
//
// The answers come from the project's autonomous.config.json (a flag still
// wins), the config is merged rather than replaced, and --force replaces only a
// file that still has the bytes an install record pinned for it. Anything else
// is the project's and stays; the work state and the living documents are
// neither rewritten nor restamped.
//
// Options (on a first install, any missing value is asked for when the terminal
// is interactive, and otherwise falls back to a sensible default):
//
//   --project-name "My Project"     name used in the rulebook and documents
//   --task-prefix TASK              canonical task ids become TASK-001, ...
//   --branch main                   the approved branch
//   --commit-email you@example.com  the only identity commits may carry
//   --remote-path owner/repo        the expected origin, for the autosave hook
//   --support-agent autonomous-support the subagent allowed to touch protected paths
//   --first-task TASK-001           id of the setup task the scaffold creates
//   --force                         replace files that already exist (see above)
//   --dry-run                       print the plan and change nothing
//   --no-stamp                      skip stamping the living documents it creates

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  LEGACY_AGENT_NAMES,
  LEGACY_NAMES,
  LEGACY_VERSION_KEY,
  VERSION_KEY,
  configFileName,
  configWithDefaults,
  formatJson,
  kitVersion,
} from "../scripts/autonomous-config.mjs";
import {
  evaluateDocumentationMap,
  fileSha256,
  hookCommandTargets,
  isKitPath,
  listLiveDocuments,
} from "../scripts/lane-guard.mjs";

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = join(KIT_ROOT, "template");

/** Autonomous kit files copied byte for byte. Re-running with --force updates them. */
export const KIT_FILES = Object.freeze([
  "scripts/autonomous-config.mjs",
  "scripts/work.mjs",
  "scripts/live-state.mjs",
  "scripts/lane-guard.mjs",
  "scripts/documentation.mjs",
  "scripts/verify.mjs",
  "scripts/context-hook.mjs",
  "scripts/context-hook.sh",
  "scripts/context-hook.ps1",
  ".claude/settings.json",
  ".claude/hooks/hook-support.mjs",
  ".claude/hooks/lane-guard-pretooluse.mjs",
  ".claude/hooks/commit-identity-pretooluse.mjs",
  ".claude/hooks/precompact-validate.mjs",
  ".claude/hooks/sessionstart-compact-context.mjs",
  ".claude/hooks/autosave-push-stop.mjs",
  ".claude/agents/autonomous-router.md",
  ".claude/agents/autonomous-worker.md",
  ".claude/agents/autonomous-explorer.md",
  ".codex/hooks.json",
  ".cursor/rules/agent-autonomous.mdc",
]);

/** The one autonomous kit file a project may already have for its own reasons: merged into, never replaced. */
const CLAUDE_SETTINGS = ".claude/settings.json";

/**
 * Scaffold files rendered with the answers, then written into the project.
 * `once` marks the project's own files: its work state and its living
 * documents, which carry its stamps and prose. A first install writes them when
 * missing; nothing replaces them, not even --force, and an update does not
 * write one again, so it cannot blank the queue, the lessons, the owner's
 * decisions, or a stamped page, and creates no second setup task.
 */
export const TEMPLATE_FILES = Object.freeze([
  { from: "AGENTS.md", to: "AGENTS.md" },
  { from: "CLAUDE.md", to: "CLAUDE.md" },
  { from: "autonomous.config.json", to: "autonomous.config.json" },
  { from: "CHANGELOG.md", to: "CHANGELOG.md" },
  { from: ".prettierignore", to: ".prettierignore" },
  { from: ".gitattributes", to: ".gitattributes" },
  { from: ".github/workflows/ci.yml", to: ".github/workflows/ci.yml" },
  { from: "work/CHECKPOINT.md", to: "work/CHECKPOINT.md", once: true },
  { from: "work/AGENT_CONTEXT.md", to: "work/AGENT_CONTEXT.md", once: true },
  { from: "work/DECISIONS.md", to: "work/DECISIONS.md", once: true },
  { from: "work/items/TASK.json", to: "work/items/{{FIRST_TASK_ID}}.json", once: true },
  { from: "docs/project/status.html", to: "docs/project/status.html", once: true },
  { from: "docs/project/architecture.html", to: "docs/project/architecture.html", once: true },
  { from: "docs/archive/manifest.json", to: "docs/archive/manifest.json" },
]);

export const GITIGNORE_MARKER = "# autonomous kit: private runtime state";
/** The same block's marker from before the kit was renamed. */
export const LEGACY_GITIGNORE_MARKER = "# agent harness: private runtime state";
/** What the block ignores: private runtime state, local tools, per-user Claude Code settings. */
export const GITIGNORE_LINES = Object.freeze([".local/", ".tools/", ".claude/settings.local.json"]);
export const GITIGNORE_BLOCK = `${GITIGNORE_MARKER}\n${GITIGNORE_LINES.join("\n")}\n`;

/** The rulebooks a project may already have; the autonomous kit's own copy then goes beside them. */
export const RULEBOOK_MERGE_COPIES = Object.freeze({
  "AGENTS.md": "AGENTS.autonomous.md",
  "CLAUDE.md": "CLAUDE.autonomous.md",
});

/** The type and agent of the support-lane record an install writes. */
export const INSTALL_RECORD_TYPE = "autonomous_support_result";
export const INSTALL_AGENT = "autonomous-install";
/** The installer's records under either name the kit has had. */
export const INSTALL_AGENTS = Object.freeze([INSTALL_AGENT, "harness-install"]);

export const PACKAGE_SCRIPTS = Object.freeze({
  "work:status": "node scripts/work.mjs status",
  "work:check": "node scripts/work.mjs check",
  "docs:check": "node scripts/documentation.mjs check",
  "docs:stamp": "node scripts/documentation.mjs stamp status",
});

/** The options that take a value, and the switches that take none. */
const VALUE_OPTIONS = Object.freeze([
  "project-name",
  "task-prefix",
  "branch",
  "commit-email",
  "remote-path",
  "support-agent",
  "first-task",
]);
const SWITCHES = Object.freeze(["force", "dry-run", "no-stamp", "help"]);

export function parseArguments(argv) {
  const options = { flags: {}, target: null };
  const values = [...argv];
  while (values.length) {
    const token = values.shift();
    if (!token.startsWith("-")) {
      if (options.target === null) options.target = token;
      else throw new Error(`Unexpected argument: ${token}`);
      continue;
    }
    const name = token === "-h" ? "help" : token.slice(2);
    if (SWITCHES.includes(name)) {
      options.flags[name] = true;
      continue;
    }
    // An unknown option is refused, not guessed at: reading the next word as its
    // value would turn `--verbose --dry-run` into a real install.
    if (!token.startsWith("--") || !VALUE_OPTIONS.includes(name))
      throw new Error(`Unknown option: ${token}`);
    const value = values.shift();
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Option --${name} needs a value.`);
    options.flags[name] = value;
  }
  return options;
}

function slugToName(path) {
  const name = basename(resolve(path)).replace(/[-_]+/g, " ").trim();
  return name ? name.replace(/\b\w/g, (character) => character.toUpperCase()) : "Project";
}

function defaultPrefix(projectName) {
  const letters = projectName.replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.slice(0, 4) || "TASK";
}

/**
 * Resolve every answer, asking only for what is missing and only on a TTY. In a
 * project that has the kit, its config answers instead, so an update keeps every
 * setting the project has and changes one only where a flag names it.
 */
export async function resolveAnswers(target, flags, { ask = null } = {}) {
  const raw = installedConfig(target);
  const installed = raw && configWithDefaults(raw);
  const text = (value) => (typeof value === "string" ? value : undefined);
  const projectName =
    flags["project-name"] ??
    text(installed?.project?.name) ??
    (await maybeAsk(ask, "Project name", slugToName(target)));
  const taskPrefix = (
    flags["task-prefix"] ??
    text(installed?.tasks?.idPrefix) ??
    (await maybeAsk(ask, "Task id prefix", defaultPrefix(projectName)))
  )
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  const branch =
    flags.branch ??
    text(installed?.project?.defaultBranch) ??
    (await maybeAsk(ask, "Approved branch", "main"));
  const commitEmail =
    flags["commit-email"] ??
    text(installed?.git?.commitEmail) ??
    (await maybeAsk(ask, "Commit email (blank to skip the identity check)", ""));
  const remotePath =
    flags["remote-path"] ??
    text(installed?.git?.remotePath) ??
    (await maybeAsk(ask, "Origin owner/repo (blank to skip autosave)", ""));
  const supportAgent = flags["support-agent"] ?? supportAgentOf(raw) ?? "autonomous-support";
  const firstTask = flags["first-task"] ?? `${taskPrefix || "TASK"}-001`;
  return {
    PROJECT_NAME: projectName,
    TASK_PREFIX: taskPrefix || "TASK",
    DEFAULT_BRANCH: branch || "main",
    COMMIT_EMAIL: commitEmail,
    REMOTE_PATH: remotePath,
    SUPPORT_AGENT: supportAgent,
    FIRST_TASK_ID: firstTask,
    DATE: new Date().toISOString().slice(0, 10),
  };
}

/**
 * The parsed config of a project that has the kit: null on a first install, and
 * undefined when the file is there but is no JSON object, which an update must
 * not guess around.
 */
function installedConfig(root) {
  const present = readFileIfAny(join(root, configFileName(root)));
  if (!present) return null;
  try {
    const parsed = JSON.parse(withoutBom(present.toString("utf8")));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The support agent a project's config already names, so an update keeps it. */
function supportAgentOf(config) {
  const [name] = Array.isArray(config?.lanes?.supportAgentTypes)
    ? config.lanes.supportAgentTypes
    : [];
  return typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name) ? name : null;
}

async function maybeAsk(ask, question, fallback) {
  if (!ask) return fallback;
  const answer = (await ask(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return answer || fallback;
}

export function render(text, answers) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(answers, key) ? answers[key] : match,
  );
}

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const utf8 = (text) => Buffer.from(text, "utf8");
/** Text without a leading byte-order mark, which some Windows editors write and JSON.parse rejects. */
const withoutBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** A UTC timestamp fit for a file name, such as 20261029T203000Z. */
export const fileStamp = (date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

/**
 * A support-lane record naming the protected files an autonomous kit command changed,
 * so the lane guard in `check` counts them as support work. Every kit command
 * that writes protected files writes one.
 */
export function laneRecord(agent, summary, files, now, extra = {}) {
  return utf8(
    `${JSON.stringify(
      {
        type: INSTALL_RECORD_TYPE,
        schemaVersion: 1,
        recordedAt: now.toISOString(),
        agent,
        summary,
        filesChanged: files,
        ...extra,
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * A project's own Claude Code settings with the autonomous kit's merged in. Every
 * other key, hook, and environment variable stays. The autonomous kit's own hook
 * entries, found by the hook script they run, are replaced by the package's
 * wiring, so a re-install never duplicates them, and an environment variable
 * the project already sets keeps its value. Null when the settings have a
 * shape this cannot merge into safely.
 */
export function mergeClaudeSettings(existing, kit) {
  if (!isObject(existing)) return null;
  if (existing.hooks !== undefined && !isObject(existing.hooks)) return null;
  if (existing.env !== undefined && !isObject(existing.env)) return null;
  const merged = structuredClone(existing);
  if (isObject(kit.env)) {
    merged.env = { ...(merged.env ?? {}) };
    for (const [name, value] of Object.entries(kit.env))
      if (!Object.hasOwn(merged.env, name)) merged.env[name] = value;
  }
  const targets = hookCommandTargets(kit);
  const isKitHook = (hook) =>
    typeof hook?.command === "string" && targets.some((target) => hook.command.includes(target));
  const wiring = isObject(kit.hooks) ? kit.hooks : {};
  const hooks = { ...(merged.hooks ?? {}) };
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      if (Object.hasOwn(wiring, event)) return null;
      continue;
    }
    const kept = groups.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const rest = group.hooks.filter((hook) => !isKitHook(hook));
      if (rest.length === group.hooks.length) return [group];
      return rest.length ? [{ ...group, hooks: rest }] : [];
    });
    // An event left empty only because its autonomous kit entries went is dropped; the package re-adds its own.
    if (kept.length || groups.length === 0) hooks[event] = kept;
    else delete hooks[event];
  }
  for (const [event, groups] of Object.entries(wiring))
    hooks[event] = [...(hooks[event] ?? []), ...structuredClone(groups)];
  merged.hooks = hooks;
  return merged;
}

/**
 * The installer's records in work/messages/, oldest first, each with the file it
 * came from. An update reads their pins; the uninstaller undoes what they name.
 */
export function installRecords(root) {
  const directory = join(root, "work/messages");
  if (!existsSync(directory)) return [];
  const records = [];
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    try {
      const value = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (INSTALL_AGENTS.includes(value?.agent))
        records.push({ file: `work/messages/${name}`, value });
    } catch {
      // Not a record the installer wrote.
    }
  }
  return records.sort((a, b) =>
    String(a.value.recordedAt ?? "").localeCompare(String(b.value.recordedAt ?? "")),
  );
}

/** Each file's latest pin across the install records: the bytes the kit last wrote there. */
function installedPins(root) {
  const pins = new Map();
  for (const { value } of installRecords(root))
    if (isObject(value.fileHashes))
      for (const [path, hash] of Object.entries(value.fileHashes)) pins.set(path, hash);
  return pins;
}

/**
 * Whether an update may replace a file it would change. It may when the file
 * still has the bytes the latest install pinned for it ("pinned"): it then holds
 * only what the kit wrote, so it needs no backup. Anything else is the project's
 * (changed since the install, or never written by one) and stays (null). A
 * project installed before the kit pinned its files has nothing to compare;
 * there the kit's own scripts, hooks, and agents are replaced, with a backup
 * ("unpinned"), and the rest stays.
 */
function updateRule(root, supportAgent) {
  const pins = installedPins(root);
  const kitFiles = new Set([...KIT_FILES, `.claude/agents/${supportAgent}.md`]);
  return (path) => {
    if (pins.has(path)) return fileSha256(root, path) === pins.get(path) ? "pinned" : null;
    return pins.size === 0 && kitFiles.has(path) ? "unpinned" : null;
  };
}

function readFileIfAny(path) {
  try {
    return statSync(path).isFile() ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

/** `<stem><extension>`, or `<stem>-2<extension>` and so on when that name is taken. */
function unusedPath(root, stem, extension) {
  for (let count = 1; ; count += 1) {
    const path = `${stem}${count > 1 ? `-${count}` : ""}${extension}`;
    if (!existsSync(join(root, path))) return path;
  }
}

/**
 * One planned file. `bytes` is set only for a file the install writes. With
 * --force, a file that already has those bytes is current, and one replaced
 * with different bytes keeps its previous copy under `backupDir`, unless the
 * update rule found it holds only what the kit wrote there; a file the rule
 * does not let an update replace is held as the project's own.
 */
function planFile(
  root,
  path,
  bytes,
  { force, once = false, source = null, backupDir = null, update = null },
) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return { path, action: "create", bytes, source, changes: true };
  if (once) return { path, action: "keep" };
  if (!force) return { path, action: "skip" };
  const present = readFileIfAny(absolute);
  if (present?.equals(bytes)) return { path, action: "current" };
  const rule = update ? update(path) : null;
  if (update && !rule) return { path, action: "hold" };
  const backup =
    present && backupDir && rule !== "pinned"
      ? { path: `${backupDir}/${path}`, bytes: present }
      : null;
  return {
    path,
    action: "overwrite",
    bytes,
    source,
    changes: true,
    ...(backup ? { backup } : {}),
  };
}

/** .claude/settings.json when the project has one: merged into after a backup, never replaced. */
function planClaudeSettings(root, source, now) {
  const present = readFileIfAny(join(root, CLAUDE_SETTINGS));
  let existing;
  try {
    existing = JSON.parse(withoutBom((present ?? "").toString("utf8")));
  } catch {
    existing = undefined;
  }
  const merged = mergeClaudeSettings(existing, JSON.parse(readFileSync(source, "utf8")));
  if (!merged)
    return {
      path: CLAUDE_SETTINGS,
      action: "refuse",
      note: `Warning: ${CLAUDE_SETTINGS} is not settings JSON the installer can merge into, so it is left unchanged and the autonomous kit hooks are NOT wired. Fix the file, then run the installer again.`,
    };
  if (isDeepStrictEqual(merged, existing))
    return {
      path: CLAUDE_SETTINGS,
      action: "current",
      note: `${CLAUDE_SETTINGS} already wires the autonomous kit hooks; it is left unchanged.`,
    };
  const backup = unusedPath(root, `.local/backups/claude-settings-${fileStamp(now)}`, ".json");
  return {
    path: CLAUDE_SETTINGS,
    action: "merge",
    bytes: utf8(`${JSON.stringify(merged, null, 2)}\n`),
    changes: true,
    backup: { path: backup, bytes: present },
    note: `${CLAUDE_SETTINGS} already existed, so the autonomous kit hooks and settings are merged into it and everything else in it is kept; the previous file is saved as ${backup}.`,
  };
}

function planPackageJson(root, { force }) {
  const path = "package.json";
  if (!existsSync(join(root, path))) {
    const contents = {
      name: basename(resolve(root))
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-"),
      version: "0.1.0",
      private: true,
      scripts: { ...PACKAGE_SCRIPTS },
    };
    return planFile(root, path, utf8(`${JSON.stringify(contents, null, 2)}\n`), { force });
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch {
    parsed = undefined;
  }
  if (!isObject(parsed) || (parsed.scripts !== undefined && !isObject(parsed.scripts)))
    return {
      path,
      action: "current",
      note: "package.json could not be parsed; its scripts were left alone.",
    };
  const scripts = { ...(parsed.scripts ?? {}) };
  const added = Object.keys(PACKAGE_SCRIPTS).filter((name) => scripts[name] === undefined);
  if (added.length === 0) return null;
  for (const name of added) scripts[name] = PACKAGE_SCRIPTS[name];
  return {
    path,
    action: "merge",
    bytes: utf8(`${JSON.stringify({ ...parsed, scripts }, null, 2)}\n`),
    changes: true,
    note: `package.json: added the scripts ${added.join(", ")}.`,
  };
}

function planGitignore(root) {
  const path = ".gitignore";
  const present = existsSync(join(root, path));
  const existing = present ? readFileSync(join(root, path), "utf8") : "";
  let contents;
  let added = GITIGNORE_LINES;
  const marker = [GITIGNORE_MARKER, LEGACY_GITIGNORE_MARKER].find((line) =>
    existing.includes(line),
  );
  if (marker) {
    // An earlier install's block: add only the lines it lacks, right under its marker.
    const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
    added = GITIGNORE_LINES.filter((line) => !lines.has(line));
    if (added.length === 0) return null;
    contents = existing.replace(marker, `${marker}\n${added.join("\n")}`);
  } else {
    contents = existing ? `${existing.replace(/\n*$/, "\n")}\n${GITIGNORE_BLOCK}` : GITIGNORE_BLOCK;
  }
  return {
    path,
    action: present ? "merge" : "create",
    bytes: utf8(contents),
    changes: true,
    note: `.gitignore: added ${added.join(", ")} to the ignore list.`,
  };
}

/**
 * The rendered config with every path the install left alone taken out of the
 * autonomous kit's lists: a project's own AGENTS.md, say, stays the product lane's,
 * and is not checked as the autonomous kit's rulebook.
 */
function withoutLeftAlone(bytes, leftAlone) {
  if (leftAlone.length === 0) return bytes;
  const config = JSON.parse(bytes.toString("utf8"));
  for (const key of ["protectedPaths", "referenceFiles", "instructionFiles"]) {
    if (Array.isArray(config.lanes?.[key]))
      config.lanes[key] = config.lanes[key].filter((path) => !leftAlone.includes(path));
  }
  return utf8(formatJson(config));
}

/** Where a flag's answer lives in the config, so a flag given to an update still wins. */
const FLAG_SETTINGS = Object.freeze({
  "project-name": [["project", "name"]],
  "task-prefix": [["tasks", "idPrefix"]],
  branch: [
    ["project", "defaultBranch"],
    ["autosave", "branch"],
  ],
  "commit-email": [["git", "commitEmail"]],
  "remote-path": [["git", "remotePath"]],
  "support-agent": [["lanes", "supportAgentTypes"]],
});

/**
 * `existing` with every key of `kit` it lacks, at any depth, each named in
 * `added`, except a key the defaults answer: a short config relies on those,
 * and the template's value can differ from the default (a stamp's scope ids do).
 */
function withNewKeys(existing, kit, added, defaults = DEFAULT_CONFIG, at = "") {
  const out = { ...existing };
  for (const [key, value] of Object.entries(kit)) {
    if (!Object.hasOwn(out, key)) {
      if (isObject(defaults) && Object.hasOwn(defaults, key)) continue;
      out[key] = structuredClone(value);
      added.push(`${at}${key}`);
    } else if (isObject(out[key]) && isObject(value)) {
      const below = isObject(defaults) ? defaults[key] : undefined;
      out[key] = withNewKeys(out[key], value, added, below, `${at}${key}.`);
    }
  }
  return out;
}

/**
 * The config of a project that has the kit, merged rather than replaced: every
 * setting it has keeps its value, a key the kit's version has and the defaults
 * lack is added, and a setting a flag names takes the flag's answer. A version
 * under the key's old name counts as the new key, so it is not written twice.
 */
function planConfigUpdate(root, bytes, flags) {
  const existing = installedConfig(root);
  const kit = JSON.parse(bytes.toString("utf8"));
  if (Object.hasOwn(existing, LEGACY_VERSION_KEY)) delete kit[VERSION_KEY];
  const added = [];
  const merged = withNewKeys(existing, kit, added);
  const named = Object.keys(FLAG_SETTINGS).filter((flag) => flags[flag] !== undefined);
  for (const flag of named)
    for (const [section, key] of FLAG_SETTINGS[flag])
      merged[section] = {
        ...(isObject(merged[section]) ? merged[section] : {}),
        [key]: kit[section][key],
      };
  // A new support agent's definition takes the old one's place in the lane lists.
  const [before, after] = [supportAgentOf(existing), supportAgentOf(kit)];
  if (named.includes("support-agent") && before && after && before !== after)
    for (const list of ["protectedPaths", "referenceFiles"])
      if (Array.isArray(merged.lanes?.[list]))
        merged.lanes[list] = merged.lanes[list].map((path) =>
          path === `.claude/agents/${before}.md` ? `.claude/agents/${after}.md` : path,
        );
  if (isDeepStrictEqual(merged, existing)) return null;
  return {
    path: CONFIG_FILENAME,
    action: "merge",
    bytes: utf8(formatJson(merged)),
    changes: true,
    note: `${CONFIG_FILENAME}: every setting the project has is kept${added.length ? `; added ${added.join(", ")}` : ""}${named.length ? `; set from ${named.map((flag) => `--${flag}`).join(", ")}` : ""}.`,
  };
}

/**
 * A documentation-map row for each document the project already has, so a
 * project with documents of its own passes `check` from the start. A row says
 * only that the document was there first; the owner fills in the rest.
 */
function existingDocumentRows(root, map, config) {
  const mapDirectory = posix.dirname(
    config.documentation?.statusDocument ?? "docs/project/status.html",
  );
  const { unmapped } = evaluateDocumentationMap({
    documents: listLiveDocuments({ root, config }),
    map,
    mapDirectory,
    exempt: config.documentation?.documentMapExempt ?? [],
  });
  const html = (text) => text.replace(/[&<>]/g, (character) => `&#${character.charCodeAt(0)};`);
  return unmapped
    .map((path) =>
      [
        "",
        "        <tr>",
        `          <td><a href="${posix.relative(mapDirectory, path)}">${html(path)}</a></td>`,
        "          <td>Here before the autonomous kit; say what it is for.</td>",
        "          <td>Owner.</td>",
        "          <td>Not decided yet.</td>",
        "          <td>None yet.</td>",
        "        </tr>",
      ].join("\n"),
    )
    .join("");
}

/** The project's configuration as it will be once the planned files are written. */
function plannedConfig(root, entries) {
  const planned = entries.find((entry) => entry.path === "autonomous.config.json" && entry.bytes);
  const bytes = planned?.bytes ?? readFileIfAny(join(root, configFileName(root)));
  try {
    return configWithDefaults(JSON.parse(bytes?.toString("utf8") ?? "{}"));
  } catch {
    return configWithDefaults({});
  }
}

/**
 * Everything an install writes, worked out before anything is written. A real
 * run carries the plan out and a dry run only reports it, so both report the
 * same files.
 */
export function planInstall(
  root,
  answers,
  { force = false, stamp = true, now = new Date(), renamed = [], flags = {} } = {},
) {
  const entries = [];
  const notes = [];
  const add = (entry) => {
    if (!entry) return;
    entries.push(entry);
    if (entry.note) notes.push(entry.note);
  };
  const fresh = !existsSync(join(root, configFileName(root))) && renamed.length === 0;
  const backupDir = unusedPath(root, `.local/backups/install-${fileStamp(now)}`, "");
  // An update replaces only what an install wrote and nobody has changed since.
  const update = fresh ? null : updateRule(root, answers.SUPPORT_AGENT);

  for (const path of KIT_FILES) {
    const source = join(KIT_ROOT, path);
    if (!existsSync(source)) continue;
    add(
      path === CLAUDE_SETTINGS && existsSync(join(root, path))
        ? planClaudeSettings(root, source, now)
        : planFile(root, path, readFileSync(source), { force, source, backupDir, update }),
    );
  }

  // The support agent may be renamed, so its definition is rendered rather than
  // copied, and the name in its front matter follows the file name.
  const supportSource = join(KIT_ROOT, ".claude/agents/autonomous-support.md");
  if (existsSync(supportSource)) {
    const text = readFileSync(supportSource, "utf8").replace(
      /^name: .*$/m,
      `name: ${answers.SUPPORT_AGENT}`,
    );
    add(
      planFile(root, `.claude/agents/${answers.SUPPORT_AGENT}.md`, utf8(text), {
        force,
        backupDir,
        update,
      }),
    );
  }

  for (const entry of TEMPLATE_FILES) {
    const source = join(TEMPLATE_ROOT, entry.from);
    if (!existsSync(source)) continue;
    const path = render(entry.to, answers);
    // An update writes none of the project's own files, not even one that is gone.
    if (entry.once && !fresh) {
      if (existsSync(join(root, path))) add({ path, action: "keep" });
      continue;
    }
    const text = readFileSync(source, "utf8");
    let bytes = utf8(render(text, { ...answers, DOCUMENT_ROWS: "" }));
    // The dashboard a first install writes maps the documents the project already has.
    if (entry.to === "docs/project/status.html" && !existsSync(join(root, path))) {
      const rows = existingDocumentRows(root, bytes.toString("utf8"), plannedConfig(root, entries));
      bytes = utf8(render(text, { ...answers, DOCUMENT_ROWS: rows }));
    }
    if (entry.to === CONFIG_FILENAME && !fresh) {
      add(planConfigUpdate(root, bytes, flags));
      continue;
    }
    const planned = planFile(root, path, bytes, { force, once: entry.once, backupDir, update });
    add(planned);
    // A project's own rulebook stays; the autonomous kit's goes beside it, to merge by hand.
    const mergeCopy = RULEBOOK_MERGE_COPIES[planned.path];
    if (
      mergeCopy &&
      planned.action === "skip" &&
      fresh &&
      !readFileIfAny(join(root, planned.path))?.equals(bytes)
    ) {
      const beside = planFile(root, mergeCopy, bytes, { force, backupDir });
      add({
        ...beside,
        note: beside.bytes
          ? `${planned.path} already existed, so it is left alone and the autonomous kit's version is written beside it as ${mergeCopy}. Merge ${mergeCopy} into ${planned.path}, then delete it; until then \`node scripts/work.mjs check\` lists it as a document missing from the documentation map.`
          : `${planned.path} already existed, so it is left alone; ${mergeCopy} is there from an earlier run and holds the autonomous kit's version to merge into it.`,
      });
    }
  }

  add(planPackageJson(root, { force }));
  add(planGitignore(root));

  // Files the install left alone are the project's own: on a fresh install the
  // config it writes does not list them as the autonomous kit's. An update keeps
  // the project's lists as they are.
  const configEntry = entries.find(
    (entry) => entry.path === "autonomous.config.json" && entry.bytes,
  );
  const leftAlone = entries
    .filter((entry) => entry.action === "skip" || entry.action === "refuse")
    .map((entry) => entry.path);
  if (fresh && configEntry && leftAlone.length) {
    const before = configWithDefaults(JSON.parse(configEntry.bytes.toString("utf8")));
    const unprotected = leftAlone.filter((path) => isKitPath(path, { root, config: before }));
    configEntry.bytes = withoutLeftAlone(configEntry.bytes, leftAlone);
    if (unprotected.length)
      notes.push(
        `These files already existed and were left alone, so the lane guard does not protect them as the autonomous kit's: ${unprotected.join(", ")}. Add a path back to lanes.protectedPaths in autonomous.config.json once it holds the autonomous kit's version (pass --force to replace them, with a backup).`,
      );
  }

  const held = entries.filter((entry) => entry.action === "hold").map((entry) => entry.path);
  if (held.length)
    notes.push(
      `These files changed since the install, or no install wrote them, so they are the project's and stay as they are: ${held.join(", ")}. Merge the kit's version into one by hand where you want it.`,
    );
  const backups = entries.filter((entry) => entry.backup && entry.action === "overwrite");
  if (backups.length)
    notes.push(
      `--force replaces ${backups.length} file(s) whose contents differ; their previous copies are saved under ${backupDir}/.`,
    );

  // The protected files this install changes go into a support-lane record, so
  // `check` counts them as support work before the first commit and while that
  // commit is not yet pushed. The record also pins every written file's bytes,
  // for the lane guard and for the uninstaller, so it is written last, after the
  // stamps. Only a living document this run creates is stamped: one that is
  // already there is the project's, and a restamp would both mark it reviewed
  // and pin the project's prose as the kit's, for an uninstall to remove.
  const config = plannedConfig(root, entries);
  const created = new Set(
    entries.filter((entry) => entry.action === "create").map((entry) => entry.path),
  );
  const stamped = stamp
    ? Object.entries({
        architecture: config.documentation?.architectureDocument,
        status: config.documentation?.statusDocument,
      }).filter(([, path]) => created.has(path))
    : [];
  const written = [
    ...new Set([
      ...entries.filter((entry) => entry.bytes && entry.changes).map((entry) => entry.path),
      // A renamed file is new to git even where its bytes did not change.
      ...renamed.map(({ to }) => to),
    ]),
  ];
  // The old names a rename removed are pinned as absent.
  const gone = renamed.map(({ from }) => from);
  const covered = [...written, ...gone].filter((path) => isKitPath(path, { root, config })).sort();
  // work/messages always gets the record, so it needs no placeholder.
  const gitkeeps = [];
  for (const directory of ["work/runs", "work/items"]) {
    if (existsSync(join(root, directory))) continue;
    if (entries.some((entry) => entry.bytes && entry.path.startsWith(`${directory}/`))) continue;
    gitkeeps.push(`${directory}/.gitkeep`);
  }
  if (written.length || gitkeeps.length || !existsSync(join(root, "work/messages"))) {
    const path = unusedPath(root, `work/messages/autonomous-install-${fileStamp(now)}`, ".json");
    add({
      path,
      action: "create",
      bytes: Buffer.alloc(0),
      changes: true,
      deferred: {
        covered,
        written: [...written, ...gitkeeps].sort(),
        gone,
        // The project's own files the kit merges into, which the uninstaller takes
        // its part out of. The config is the kit's file, so it is not one of them.
        merged: entries
          .filter((entry) => entry.action === "merge" && entry.bytes)
          .map((entry) => entry.path)
          .filter((path) => path !== CONFIG_FILENAME)
          .sort(),
        backups: Object.fromEntries(
          entries.filter((entry) => entry.backup).map((entry) => [entry.path, entry.backup.path]),
        ),
      },
      note: covered.length
        ? `${path} names the ${covered.length} protected file(s) this install writes, so \`node scripts/work.mjs check\` counts them as support work while their bytes are unchanged.`
        : null,
    });
  }
  for (const path of gitkeeps)
    add({ path, action: "create", bytes: Buffer.alloc(0), changes: true });
  return {
    entries,
    notes: [...new Set(notes.filter(Boolean))],
    stamped: stamped.map(([document]) => document),
    fresh,
  };
}

function carryOut(root, plan) {
  mkdirSync(root, { recursive: true });
  for (const entry of plan.entries) {
    if (!entry.bytes || entry.deferred) continue; // left alone, kept, current, refused, or the record
    if (entry.backup) {
      const backup = join(root, entry.backup.path);
      mkdirSync(dirname(backup), { recursive: true });
      writeFileSync(backup, entry.backup.bytes);
    }
    const destination = join(root, entry.path);
    mkdirSync(dirname(destination), { recursive: true });
    if (entry.source) copyFileSync(entry.source, destination);
    else writeFileSync(destination, entry.bytes);
  }
}

/** Each path's SHA-256 as it is on disk now, null for a missing file. */
export function fileHashesOf(root, paths) {
  return Object.fromEntries(paths.map((path) => [path, fileSha256(root, path)]));
}

/** Write the install record last, so the bytes it pins are the ones on disk. */
function writeInstallRecord(root, plan, now) {
  const entry = plan.entries.find((candidate) => candidate.deferred);
  if (!entry) return;
  const { covered, written, gone, merged, backups } = entry.deferred;
  const destination = join(root, entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    laneRecord(
      INSTALL_AGENT,
      "Installed the autonomous kit with bin/autonomous-install.mjs; filesChanged are the protected files it wrote, and fileHashes pin every file it wrote.",
      covered,
      now,
      { fileHashes: fileHashesOf(root, [...written, ...gone]), merged, backups },
    ),
  );
}

/**
 * Stamp the living documents this run created by running the installed copy
 * as its own process. It then reads the project's own configuration, and
 * nothing in the installer's module state leaks into the stamp.
 */
function stampDocuments(root, documents) {
  const script = join(root, "scripts/documentation.mjs");
  const failures = [];
  for (const document of documents) {
    const result = spawnSync(process.execPath, [script, "stamp", document], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0)
      failures.push(`${document}: ${(result.stderr || result.error?.message || "").trim()}`);
  }
  return failures.length === 0
    ? "Stamped the living documents against their current sources."
    : `Could not stamp the living documents (${failures.join("; ")}). Run \`node scripts/documentation.mjs stamp status\` after fixing the cause.`;
}

export async function install(target, flags = {}, { ask = null } = {}) {
  const resolved = resolve(target);
  const force = flags.force === true;
  const dryRun = flags["dry-run"] === true;
  const stamp = flags["no-stamp"] !== true;

  if (resolved === KIT_ROOT)
    throw new Error("Refusing to install the autonomous kit into its own repository.");
  const installed = installedConfig(resolved);
  const name = configFileName(resolved);
  // An update reads its answers from the config, so it does not guess around one it cannot read.
  if (installed === undefined)
    throw new Error(
      `Refusing to update: ${name} is not a JSON object the installer can read. Fix it, then run the installer again.`,
    );
  // Installing version 2 over version 1 would leave the v1 files behind under a config marked v2.
  if (installed && (kitVersion(installed) ?? 1) === 1)
    throw new Error(
      [
        `Refusing to install over a project on version 1 of the kit: its ${name} names no version, and this installer installs version 2 only.`,
      ].join(" "),
    );

  const renames = legacyRenames(resolved);
  if (renames.length && !force)
    throw new Error(
      `This project uses the kit's old names (${renames.map(({ from }) => from).join(", ")}). Run the installer again with --force: it renames them to the new names, keeping their content, and updates the kit's files, saving a copy of every file it replaces under .local/backups/.`,
    );
  const answers = await resolveAnswers(resolved, flags, { ask });
  const now = new Date();
  const renameNote = renames.length
    ? `Renamed to the kit's new names, content kept${dryRun ? " (on a real run; the plan below is worked out before the renames)" : ""}: ${renames.map(({ from, to }) => `${from} -> ${to}`).join(", ")}.`
    : null;
  if (renames.length && !dryRun) applyLegacyRenames(resolved, renames);
  const plan = planInstall(resolved, answers, { force, stamp, now, renamed: renames, flags });
  if (renameNote) plan.notes.unshift(renameNote);
  const report = {
    created: [],
    overwritten: [],
    merged: [],
    skipped: [],
    kept: [],
    held: [],
    mergeCopies: plan.entries
      .filter((entry) => Object.values(RULEBOOK_MERGE_COPIES).includes(entry.path))
      .map((entry) => entry.path),
    notes: [...plan.notes],
    answers,
    updated: !plan.fresh,
  };
  const lists = {
    create: report.created,
    overwrite: report.overwritten,
    merge: report.merged,
    skip: report.skipped,
    keep: report.kept,
    hold: report.held,
  };
  for (const entry of plan.entries) lists[entry.action]?.push(join(resolved, entry.path));
  if (dryRun) return report;

  carryOut(resolved, plan);
  if (plan.stamped.length) report.notes.push(stampDocuments(resolved, plan.stamped));
  writeInstallRecord(resolved, plan, now);
  return report;
}

/** The files of a project installed under the kit's old names, with their new names. */
export function legacyRenames(root) {
  return Object.entries(LEGACY_NAMES)
    .filter(([from, to]) => existsSync(join(root, from)) && !existsSync(join(root, to)))
    .map(([from, to]) => ({ from, to }));
}

/**
 * Rename the old files. The config keeps its content, with the old file and
 * agent names in it changed to the new ones, so its lists name files that exist.
 */
function applyLegacyRenames(root, renames) {
  for (const { from, to } of renames) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    renameSync(join(root, from), join(root, to));
  }
  const config = renames.find(({ to }) => to === CONFIG_FILENAME);
  if (!config) return;
  let text = readFileSync(join(root, CONFIG_FILENAME), "utf8");
  for (const [from, to] of Object.entries(LEGACY_NAMES))
    text = text.split(JSON.stringify(from)).join(JSON.stringify(to));
  // Only the fixed agents; the support agent keeps the name the project gave it.
  for (const [from, to] of Object.entries(LEGACY_AGENT_NAMES))
    if (from !== "harness-support")
      text = text
        .split(JSON.stringify(`.claude/agents/${from}.md`))
        .join(JSON.stringify(`.claude/agents/${to}.md`));
  writeFileSync(join(root, CONFIG_FILENAME), text);
}

/** The steps after an install or an update, naming only files and sections that exist then. */
export function nextSteps(report) {
  const number = (steps) => steps.map((step, index) => `  ${index + 1}. ${step}`);
  if (report.updated)
    return number([
      ...(report.held.length
        ? ["Merge the kit's version into a file left alone above, where you want it."]
        : []),
      "Run `node scripts/work.mjs check` and fix whatever it reports. `node scripts/documentation.mjs check` shows a living document whose sources the update changed as review due: have the support agent review it, then restamp it.",
      "Read the diff, then commit the update.",
    ]);
  const hasCopy = (name) => report.mergeCopies.includes(RULEBOOK_MERGE_COPIES[name]);
  const steps = [];
  if (hasCopy("AGENTS.md") || hasCopy("CLAUDE.md"))
    steps.push(
      `Merge ${report.mergeCopies.join(" and ")} into your own ${report.mergeCopies.map((path) => path.replace(".autonomous", "")).join(" and ")} (keep your text; add the autonomous kit's sections), then delete ${report.mergeCopies.length > 1 ? "them" : "it"}.`,
    );
  steps.push(
    hasCopy("AGENTS.md")
      ? "Then have the support agent write the Big picture section, which the merge brings into AGENTS.md, and record that change in a work/messages support result."
      : "Have the support agent write the Big picture section of AGENTS.md so it describes this project, and record that change in a work/messages support result.",
    `Replace the placeholder objective in work/CHECKPOINT.md and work/items/${report.answers.FIRST_TASK_ID}.json, and fill in work/AGENT_CONTEXT.md.`,
    "Run `node scripts/work.mjs check` and fix whatever it reports.",
    'To turn autosave on, set autosave.enabled in autonomous.config.json to true once the branch and git.remotePath are right. With the default visibilityCheck "github" it pushes only to a repository GitHub confirms is private, which needs the gh command; "none" skips that check for a remote off GitHub.',
    "Commit the autonomous kit, then start the first real task.",
  );
  return number(steps);
}

function printReport(report, target, dryRun) {
  const show = (label, paths) => {
    if (paths.length === 0) return;
    console.log(`\n${label} (${paths.length}):`);
    for (const path of paths.slice(0, 60)) console.log(`  ${relative(target, path) || path}`);
    if (paths.length > 60) console.log(`  ... and ${paths.length - 60} more`);
  };
  console.log(
    dryRun
      ? "Dry run — nothing was written."
      : report.updated
        ? "Autonomous kit updated."
        : "Autonomous kit installed.",
  );
  show("Created", report.created);
  show("Overwritten", report.overwritten);
  show("Merged into the existing file (everything else in it kept)", report.merged);
  show("Left alone (already present; pass --force to replace)", report.skipped);
  show("Kept (the project's work state and living documents; never replaced)", report.kept);
  show("Left alone (changed since the install, or no install wrote it)", report.held);
  for (const note of report.notes) console.log(`\n${note}`);
  console.log(["", "Next steps:", ...nextSteps(report), ""].join("\n"));
}

const USAGE = `Usage: node bin/autonomous-install.mjs <target-directory> [--project-name NAME] [--task-prefix PREFIX]
       [--branch BRANCH] [--commit-email EMAIL] [--remote-path owner/repo]
       [--support-agent NAME] [--first-task ID] [--force] [--dry-run] [--no-stamp]
`;

async function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (parsed.flags.help || !parsed.target) {
    process.stdout.write(USAGE);
    process.exitCode = parsed.flags.help ? 0 : 2;
    return;
  }
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    const report = await install(parsed.target, parsed.flags, {
      ask: rl ? (question) => rl.question(question) : null,
    });
    printReport(report, resolve(parsed.target), parsed.flags["dry-run"] === true);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    rl?.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}

export { KIT_ROOT, TEMPLATE_ROOT };
