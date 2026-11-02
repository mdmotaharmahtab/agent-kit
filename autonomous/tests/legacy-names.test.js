// A project installed while the kit was called "harness" keeps working: the
// scripts read its old config, the lane guard treats each old file and agent
// name as its new one, and the installer, run with --force, renames the files.
import { beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { tempDir } from "./temp-dirs.js";
import { KIT_ROOT, LEGACY_GITIGNORE_MARKER, install } from "../bin/autonomous-install.mjs";
import { uninstall } from "../bin/autonomous-uninstall.mjs";
import { loadAutosaveSettings } from "../.claude/hooks/autosave-push-stop.mjs";
import {
  LEGACY_CONFIG_FILENAME,
  LEGACY_NAMES,
  clearConfigCache,
  configFileName,
  loadConfig,
} from "../scripts/autonomous-config.mjs";
import { isKitPath, supportAgentTypes } from "../scripts/lane-guard.mjs";

const ANSWERS = {
  "project-name": "Old Project",
  "task-prefix": "OLD",
  branch: "main",
  "commit-email": "old@users.noreply.github.com",
  "remote-path": "",
};

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

const OLD_VERIFY = "// scripts/verify.mjs as an older kit shipped it\n";

/**
 * A project laid out the way the kit installed it under its old name: the old
 * file names, the old names inside the config, the old .gitignore marker, the
 * old support agent and install record.
 */
async function oldProject() {
  const root = tempDir("legacy-project-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", ANSWERS["commit-email"]);
  git(root, "config", "user.name", "Old");
  git(root, "config", "commit.gpgsign", "false");
  await install(root, { ...ANSWERS, "support-agent": "harness-support" });
  for (const [from, to] of Object.entries(LEGACY_NAMES)) {
    mkdirSync(dirname(join(root, from)), { recursive: true });
    renameSync(join(root, to), join(root, from));
  }
  let config = readFileSync(join(root, LEGACY_CONFIG_FILENAME), "utf8");
  for (const [from, to] of Object.entries(LEGACY_NAMES))
    config = config.split(JSON.stringify(to)).join(JSON.stringify(from));
  config = config.replace('"name": "Old Project"', '"name": "Old Project, edited"');
  writeFileSync(join(root, LEGACY_CONFIG_FILENAME), config);
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  writeFileSync(
    join(root, ".gitignore"),
    ignore.replace("# autonomous kit: private runtime state", LEGACY_GITIGNORE_MARKER),
  );
  const [record] = readdirSync(join(root, "work/messages"));
  // An install record as the old installer wrote it: the old record type and
  // installer name, the old file names, and no pinned bytes.
  const value = JSON.parse(readFileSync(join(root, "work/messages", record), "utf8"));
  const reverse = Object.fromEntries(Object.entries(LEGACY_NAMES).map(([from, to]) => [to, from]));
  writeFileSync(
    join(root, "work/messages", record),
    JSON.stringify({
      type: "harness_support_result",
      schemaVersion: 1,
      recordedAt: value.recordedAt,
      agent: "harness-install",
      summary: "Installed the agent harness with bin/install.mjs.",
      filesChanged: value.filesChanged.map((path) => reverse[path] ?? path),
    }),
  );
  // A kit script as an older kit shipped it.
  writeFileSync(join(root, "scripts/verify.mjs"), OLD_VERIFY, "utf8");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "The kit under its old names");
  return root;
}

const check = (root) =>
  spawnSync(process.execPath, [join(root, "scripts", "work.mjs"), "check"], {
    cwd: root,
    encoding: "utf8",
  });

describe("the kit's old names", () => {
  beforeEach(() => clearConfigCache());

  it("reads harness.config.json when there is no autonomous.config.json", () => {
    const root = tempDir("legacy-config-");
    writeFileSync(
      join(root, LEGACY_CONFIG_FILENAME),
      JSON.stringify({
        tasks: { idPrefix: "OLD" },
        autosave: { enabled: true, branch: "main", visibilityCheck: "none" },
      }),
    );
    expect(configFileName(root)).toBe(LEGACY_CONFIG_FILENAME);
    expect(loadConfig({ root, reload: true }).tasks.idPrefix).toBe("OLD");
    expect(loadAutosaveSettings(root)).toMatchObject({ enabled: true, visibilityCheck: "none" });
    writeFileSync(
      join(root, "autonomous.config.json"),
      JSON.stringify({ tasks: { idPrefix: "NEW" } }),
    );
    expect(loadConfig({ root, reload: true }).tasks.idPrefix).toBe("NEW");
  });

  it("protects an old file name exactly when its new name is protected, and back", () => {
    const config = loadConfig({ root: tempDir("legacy-guard-"), reload: true });
    for (const [from, to] of Object.entries(LEGACY_NAMES)) {
      expect(isKitPath(to, { config }), to).toBe(true);
      expect(isKitPath(from, { config }), from).toBe(true);
    }
    const old = { lanes: { protectedPaths: Object.keys(LEGACY_NAMES) } };
    for (const to of Object.values(LEGACY_NAMES))
      expect(isKitPath(to, { config: old }), to).toBe(true);
  });

  it("accepts the old support agent name for the new one, and back", () => {
    expect(
      supportAgentTypes({ config: { lanes: { supportAgentTypes: ["harness-support"] } } }),
    ).toEqual(["harness-support", "autonomous-support"]);
    expect(
      supportAgentTypes({ config: { lanes: { supportAgentTypes: ["docs-keeper"] } } }),
    ).toEqual(["docs-keeper"]);
  });

  it("passes check under the old names, refuses to update without --force, and renames with it", async () => {
    // (A real old project runs its old scripts; this one has the new scripts
    // under old names, so its check is not run before the update.)
    const root = await oldProject();

    await expect(install(root, ANSWERS)).rejects.toThrow(/old names .*--force/);
    expect(existsSync(join(root, LEGACY_CONFIG_FILENAME))).toBe(true);

    // The update as the README gives it; the answers come from the project's config.
    const report = await install(root, { force: true, "no-stamp": true });
    expect(report.notes[0]).toMatch(/^Renamed to the kit's new names, content kept: /);
    // Its record pins nothing, so the kit's own files are replaced, each with a backup.
    expect(readFileSync(join(root, "scripts/verify.mjs"))).toEqual(
      readFileSync(join(KIT_ROOT, "scripts/verify.mjs")),
    );
    const backup = readdirSync(join(root, ".local/backups")).find((name) =>
      name.startsWith("install-"),
    );
    expect(readFileSync(join(root, ".local/backups", backup, "scripts/verify.mjs"), "utf8")).toBe(
      OLD_VERIFY,
    );
    for (const [from, to] of Object.entries(LEGACY_NAMES)) {
      expect(existsSync(join(root, from)), from).toBe(false);
      expect(existsSync(join(root, to)), to).toBe(true);
    }
    // The renamed config keeps the project's own values, with the new file names in it.
    const config = JSON.parse(readFileSync(join(root, "autonomous.config.json"), "utf8"));
    expect(config.project.name).toBe("Old Project, edited");
    expect(config.lanes.protectedPaths).toContain("scripts/autonomous-config.mjs");
    expect(config.lanes.protectedPaths).not.toContain("scripts/harness-config.mjs");
    // The support agent keeps the name the project gave it.
    expect(config.lanes.supportAgentTypes).toEqual(["harness-support"]);
    expect(existsSync(join(root, ".claude/agents/harness-support.md"))).toBe(true);
    expect(existsSync(join(root, ".claude/agents/autonomous-support.md"))).toBe(false);
    // The old .gitignore block is recognised, not added twice.
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toContain(LEGACY_GITIGNORE_MARKER);
    expect(ignore).not.toContain("# autonomous kit: private runtime state");

    const after = check(root);
    expect(after.status, `${after.stdout}\n${after.stderr}`).toBe(0);
  });

  it("uninstalls a project whose install record carries the old installer name", async () => {
    const root = await oldProject();
    const plan = uninstall(root, { dryRun: true });
    // A file the kit still ships byte for byte is compared with the kit's copy;
    // any other file the old record names has nothing to compare, so it stays.
    expect(plan.remove).toContain("scripts/work.mjs");
    expect(plan.left).toContainEqual({ path: "AGENTS.md", why: "no recorded bytes to compare" });
    expect(plan.left).toContainEqual({
      path: "scripts/harness-config.mjs",
      why: "no recorded bytes to compare",
    });
    expect(plan.records).toEqual([]);
  });
});
