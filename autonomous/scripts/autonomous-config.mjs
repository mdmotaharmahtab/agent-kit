// One configuration file for the whole autonomous kit.
//
// Every value that used to be hard-coded to one project — the task-id prefix,
// the protected path list, the support-agent name, the commit identity, the
// documents that carry a freshness stamp — is read from `autonomous.config.json`
// at the project root. Missing keys fall back to the defaults below, so a
// project can ship a three-line config and still get a working autonomous kit.
//
// The loader is deliberately forgiving: an unreadable or malformed config
// degrades to the defaults with a note rather than throwing, because every
// caller here is a check or a hook that must never be the reason work stops.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_FILENAME = "autonomous.config.json";

/**
 * Compatibility with the kit's old name. Until 2026-10 it was called "harness",
 * and the files and agents it installed carried that name. A project installed
 * then keeps working: the scripts read its old config file, the lane guard
 * treats each old path and agent as its new counterpart, and the installer,
 * run with --force, renames the old files (see LEGACY_NAMES).
 */
export const LEGACY_CONFIG_FILENAME = "harness.config.json";

/** Each installed file's old path, and the path it has now. */
export const LEGACY_NAMES = Object.freeze({
  [LEGACY_CONFIG_FILENAME]: CONFIG_FILENAME,
  "scripts/harness-config.mjs": "scripts/autonomous-config.mjs",
  ".claude/agents/harness-router.md": ".claude/agents/autonomous-router.md",
  ".claude/agents/harness-worker.md": ".claude/agents/autonomous-worker.md",
  ".claude/agents/harness-explorer.md": ".claude/agents/autonomous-explorer.md",
  ".cursor/rules/agent-harness.mdc": ".cursor/rules/agent-autonomous.mdc",
});

/** Each agent's old name, and the name it has now. */
export const LEGACY_AGENT_NAMES = Object.freeze({
  "harness-support": "autonomous-support",
  "harness-router": "autonomous-router",
  "harness-worker": "autonomous-worker",
  "harness-explorer": "autonomous-explorer",
  "harness-install": "autonomous-install",
});

/** The living documents' stamp marker under its old name, and the name it has now. */
export const LEGACY_STAMP_MARKERS = Object.freeze({ "harness-doc-state": "autonomous-doc-state" });

/** The config key that names the kit version a project is on, and its old name. */
export const VERSION_KEY = "autonomousVersion";
export const LEGACY_VERSION_KEY = "harnessVersion";

/** The kit version a parsed config names, under either key; undefined when it names none. */
export function kitVersion(config) {
  return config?.[VERSION_KEY] ?? config?.[LEGACY_VERSION_KEY];
}

/** A name together with its old or new counterpart, if it has one. */
export function withCounterparts(names, map) {
  const reverse = Object.fromEntries(Object.entries(map).map(([from, to]) => [to, from]));
  const out = new Set();
  for (const name of names) {
    out.add(name);
    if (map[name]) out.add(map[name]);
    if (reverse[name]) out.add(reverse[name]);
  }
  return [...out];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  project: {
    name: "Project",
    defaultBranch: "main",
  },
  tasks: {
    /** Uppercase prefix for canonical task ids, e.g. "TASK" gives TASK-001. */
    idPrefix: "TASK",
    /** Minimum number of digits after the prefix. */
    idDigits: 3,
  },
  git: {
    /** The only identity a commit may carry. Set at install time. */
    commitEmail: "",
    /** Host and path of the expected origin remote, for the autosave hook. */
    remoteHost: "github.com",
    remotePath: "",
    /** GitHub account the autosave hook asks about visibility as; empty uses gh's active one. */
    account: "",
  },
  lanes: {
    /** Paths only a disjoint support lane may change: by default, the autonomous kit's own files. */
    protectedPaths: kitOwnedPaths(),
    /** Subagent types allowed to change those paths. */
    supportAgentTypes: ["autonomous-support"],
    /** Always-loaded instruction files that must stay milestone-neutral. */
    instructionFiles: ["AGENTS.md", "CLAUDE.md"],
    /** Files whose path references are checked for rot. */
    referenceFiles: [
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/agents/autonomous-support.md",
      ".claude/agents/autonomous-worker.md",
      ".claude/agents/autonomous-explorer.md",
    ],
    /** Heading whose body may never name a task id at all. */
    milestoneNeutralSection: "Big picture",
  },
  documentation: {
    statusDocument: "docs/project/status.html",
    architectureDocument: "docs/project/architecture.html",
    /** Comment marker that carries the freshness stamp; its old name is read too. */
    stampMarker: "autonomous-doc-state",
    /** Sources whose change makes the status page due for review. */
    guidancePaths: ["AGENTS.md", "README.md"],
    /**
     * Named groups of sources whose change makes the architecture page due.
     * Each entry is { id, paths?, directories? }; a directory entry is
     * { path, extensions?, recursive?, optional? }.
     */
    architectureScopes: [
      {
        // The id is part of every stamp, so the default keeps the kit's old name and a
        // project stamped against the defaults stays valid; the template writes the new one.
        id: "harness-control-plane",
        paths: ["scripts/work.mjs", "scripts/live-state.mjs", "scripts/lane-guard.mjs"],
      },
      {
        id: "repository-boundary",
        paths: [".gitignore", "package.json"],
      },
    ],
    /** Accepted tasks from this date on must appear in the changelog. */
    changelogRequiredFrom: "1970-01-01",
    changelogPath: "CHANGELOG.md",
    /** Documents that need no row in the documentation map. */
    documentMapExempt: ["docs/project/status.html", "CHANGELOG.md", "LICENSE", "README.md"],
    /** Directory names never walked when listing live documents. */
    excludedSegments: [
      "node_modules",
      ".git",
      ".venv",
      ".tools",
      ".local",
      "archive",
      "outputs",
      "secrets",
      "fixtures",
      "work",
      "template",
      ".claude",
      ".codex",
      ".cursor",
      ".github",
    ],
  },
  autosave: {
    /** Off until a project turns it on deliberately. */
    enabled: false,
    /** Branch the Stop hook may commit and fast-forward push. Empty disables. */
    branch: "",
    minIntervalMinutes: 10,
    /**
     * "github": push only after GitHub, asked through `gh`, confirms the origin
     * is private. "none": skip that question (a remote off GitHub); the owner
     * then answers for the remote being private.
     */
    visibilityCheck: "github",
    allowedPrefixes: ["src/", "tests/", "scripts/", "docs/", "work/", ".claude/"],
    allowedFiles: ["AGENTS.md", "CLAUDE.md", "README.md", "CHANGELOG.md"],
  },
  quietHours: {
    timeZone: "UTC",
    startHour: 23,
    endHour: 8,
  },
  /**
   * Bounds on the part of work/CHECKPOINT.md above "## Log". The dated log
   * below it may grow; the objective and the queue above it must stay small.
   */
  checkpoint: {
    maxBytesAboveLog: 16384,
    maxLinesAboveLog: 220,
    maxSectionsAboveLog: 10,
  },
});

/**
 * The files the autonomous kit installs and manages, and so the only paths it
 * protects by default: its rulebook, its configuration, the scripts and hooks
 * it ships, and its agent definitions. A project protects more (`docs/**`, say)
 * by listing them under `lanes.protectedPaths`.
 */
export function kitOwnedPaths(supportAgent = "autonomous-support") {
  return [
    "AGENTS.md",
    "CLAUDE.md",
    "autonomous.config.json",
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
    `.claude/agents/${supportAgent}.md`,
    ".claude/agents/autonomous-worker.md",
    ".claude/agents/autonomous-explorer.md",
    ".codex/hooks.json",
    ".cursor/rules/agent-autonomous.mdc",
  ];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * JSON laid out the way Prettier lays out the template's config: objects one
 * key per line, an array of plain values on one line when it fits the width.
 */
export function formatJson(value, { printWidth = 100 } = {}) {
  const pad = (size) => " ".repeat(size);
  const plain = (entry) => entry === null || typeof entry !== "object";
  function print(entry, depth, lead, trailing) {
    if (Array.isArray(entry)) {
      if (entry.length === 0) return "[]";
      const inline = `[${entry.map((part) => JSON.stringify(part)).join(", ")}]`;
      if (entry.every(plain) && lead + inline.length + trailing <= printWidth) return inline;
      const parts = entry.map(
        (part, index) =>
          `${pad(depth + 2)}${print(part, depth + 2, depth + 2, index < entry.length - 1 ? 1 : 0)}`,
      );
      return `[\n${parts.join(",\n")}\n${pad(depth)}]`;
    }
    if (isObject(entry)) {
      const keys = Object.entries(entry);
      if (keys.length === 0) return "{}";
      const parts = keys.map(([key, part], index) => {
        const head = `${pad(depth + 2)}${JSON.stringify(key)}: `;
        return `${head}${print(part, depth + 2, head.length, index < keys.length - 1 ? 1 : 0)}`;
      });
      return `{\n${parts.join(",\n")}\n${pad(depth)}}`;
    }
    return JSON.stringify(entry);
  }
  return `${print(value, 0, 0, 0)}\n`;
}

/** Shallow-merge one level deep: sections merge, arrays and scalars replace. */
function mergeConfig(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined) continue;
    out[key] = isObject(value) && isObject(base[key]) ? { ...base[key], ...value } : value;
  }
  return out;
}

/** The values `autosave.visibilityCheck` may take. */
export const AUTOSAVE_VISIBILITY_CHECKS = Object.freeze(["github", "none"]);

/**
 * Problems with the values of a merged configuration that would make a hook
 * act on a setting it does not understand. `node scripts/work.mjs check`
 * reports each one as an error.
 */
export function validateConfig(config) {
  const problems = [];
  const check = config?.autosave?.visibilityCheck;
  if (!AUTOSAVE_VISIBILITY_CHECKS.includes(check))
    problems.push(
      `${CONFIG_FILENAME}: autosave.visibilityCheck is ${JSON.stringify(check)}; it must be one of ${AUTOSAVE_VISIBILITY_CHECKS.map((value) => `"${value}"`).join(", ")}.`,
    );
  return problems;
}

/** A parsed configuration merged over the defaults, the way `loadConfig` merges the file. */
export function configWithDefaults(raw) {
  return mergeConfig(DEFAULT_CONFIG, isObject(raw) ? raw : {});
}

let cached = null;

/**
 * The project's configuration file name: `autonomous.config.json`, or the
 * name the kit used before it was renamed, `harness.config.json`, when only
 * that one exists, so a project installed under the old names keeps working.
 */
export function configFileName(root = ROOT) {
  if (existsSync(resolve(root, CONFIG_FILENAME))) return CONFIG_FILENAME;
  if (existsSync(resolve(root, LEGACY_CONFIG_FILENAME))) return LEGACY_CONFIG_FILENAME;
  return CONFIG_FILENAME;
}

/** Read `autonomous.config.json`, or the defaults when it is absent or broken. */
export function loadConfig({ root = ROOT, reload = false } = {}) {
  if (!reload && cached && cached.root === root) return cached.config;
  const name = configFileName(root);
  const path = resolve(root, name);
  const notes = [];
  let raw = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (isObject(parsed)) raw = parsed;
      else notes.push(`${name}: expected a JSON object; using defaults.`);
    } catch (error) {
      notes.push(`${name}: ${error.message}; using defaults.`);
    }
  }
  const config = configWithDefaults(raw);
  config.notes = notes;
  config.root = root;
  cached = { root, config };
  return config;
}

/**
 * True in the agent-autonomous package's own folder, which ships these scripts
 * but is not a project that uses them: it holds the installer and the
 * template, and no `autonomous.config.json` of its own.
 */
export function isKitPackage(root = ROOT) {
  return (
    !existsSync(resolve(root, CONFIG_FILENAME)) &&
    !existsSync(resolve(root, LEGACY_CONFIG_FILENAME)) &&
    existsSync(resolve(root, "bin", "autonomous-install.mjs")) &&
    existsSync(resolve(root, "template", CONFIG_FILENAME))
  );
}

/** What the project commands print in the package's own folder instead of failing. */
export const PACKAGE_NOTE =
  "This folder is the autonomous kit package itself, not a project that uses it, so it has no work queue or living documents to check. Its own checks are `npm test`, `npm run lint`, and `npm run format:check`; install the autonomous kit into a project (`node bin/autonomous-install.mjs <project>`) to run this command there.";

export function clearConfigCache() {
  cached = null;
}

/** The canonical task-id pattern, e.g. /^TASK-\d{3,}$/. */
export function taskIdPattern(config = loadConfig()) {
  const prefix = String(config.tasks?.idPrefix ?? "TASK").replace(/[^A-Za-z0-9_]/g, "");
  const digits = Number.isInteger(config.tasks?.idDigits) ? config.tasks.idDigits : 3;
  return new RegExp(`^${prefix}-\\d{${Math.max(1, digits)},}$`);
}

/** A human example of a task id, used in error messages: "TASK-000". */
export function taskIdExample(config = loadConfig()) {
  const prefix = String(config.tasks?.idPrefix ?? "TASK");
  const digits = Number.isInteger(config.tasks?.idDigits) ? config.tasks.idDigits : 3;
  return `${prefix}-${"0".repeat(Math.max(1, digits))}`;
}

/** A global-flagged pattern for finding task ids inside prose. */
export function taskIdInProsePattern(config = loadConfig()) {
  const prefix = String(config.tasks?.idPrefix ?? "TASK").replace(/[^A-Za-z0-9_]/g, "");
  const digits = Number.isInteger(config.tasks?.idDigits) ? config.tasks.idDigits : 3;
  return new RegExp(`\\b${prefix}-\\d{${Math.max(1, digits)},}\\b`, "g");
}

export const KIT_ROOT = ROOT;
