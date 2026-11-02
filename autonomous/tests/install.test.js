import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { tempDir } from "./temp-dirs.js";
import {
  GITIGNORE_MARKER,
  KIT_FILES,
  KIT_ROOT,
  TEMPLATE_FILES,
  install,
  nextSteps,
  parseArguments,
  render,
} from "../bin/autonomous-install.mjs";
import { uninstall } from "../bin/autonomous-uninstall.mjs";
import { clearConfigCache, formatJson, loadConfig } from "../scripts/autonomous-config.mjs";
import { fileSha256, hookCommandTargets, isKitPath } from "../scripts/lane-guard.mjs";

const ANSWERS = {
  "project-name": "Demo Project",
  "task-prefix": "DEMO",
  branch: "trunk",
  "commit-email": "demo@users.noreply.github.com",
  "remote-path": "demo/demo",
};

const RECORD_NAME = /^autonomous-install-\d{8}T\d{6}Z\.json$/;

function target() {
  return tempDir("autonomous-install-");
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** A git repository on the approved branch, with the configured commit identity. */
function repository(root) {
  git(root, "init", "-q", "-b", ANSWERS.branch);
  git(root, "config", "user.email", ANSWERS["commit-email"]);
  git(root, "config", "user.name", "Demo");
  git(root, "config", "commit.gpgsign", "false");
}

/** Run the installed check as a real command, so the lane guard scans a real working tree. */
function check(root) {
  return spawnSync(process.execPath, [join(root, "scripts", "work.mjs"), "check"], {
    cwd: root,
    encoding: "utf8",
  });
}

/** The installed documentation check, run as a real command. */
function documentationCheck(root) {
  return spawnSync(process.execPath, [join(root, "scripts", "documentation.mjs"), "check"], {
    cwd: root,
    encoding: "utf8",
  });
}

/** The install's record in work/messages/, parsed. */
function installRecord(root) {
  const names = readdirSync(join(root, "work/messages")).filter((name) => RECORD_NAME.test(name));
  expect(names).toHaveLength(1);
  return JSON.parse(readFileSync(join(root, "work/messages", names[0]), "utf8"));
}

const settingsPath = (root) => join(root, ".claude/settings.json");
const readSettings = (root) => JSON.parse(readFileSync(settingsPath(root), "utf8"));

describe("argument parsing", () => {
  it("separates the target from the options", () => {
    const parsed = parseArguments(["/tmp/x", "--project-name", "Demo", "--force"]);
    expect(parsed.target).toBe("/tmp/x");
    expect(parsed.flags).toMatchObject({ "project-name": "Demo", force: true });
  });

  it("refuses an option with no value and a second target", () => {
    expect(() => parseArguments(["/tmp/x", "--project-name"])).toThrow(/needs a value/);
    expect(() => parseArguments(["/tmp/x", "/tmp/y"])).toThrow(/Unexpected argument/);
  });

  it("refuses an unknown option instead of taking the next argument as its value", () => {
    expect(() => parseArguments(["/tmp/x", "--verbose", "--dry-run"])).toThrow(
      /Unknown option: --verbose/,
    );
    expect(() => parseArguments(["-v", "/tmp/x"])).toThrow(/Unknown option: -v/);
    expect(() => parseArguments(["/tmp/x", "--branch", "--dry-run"])).toThrow(/needs a value/);
  });

  // Each command line, run as a user would, on an empty folder that must stay empty.
  const BINS = ["autonomous-install", "autonomous-uninstall"];
  it.each(BINS)("%s refuses an unknown option with its usage, and changes nothing", (bin) => {
    const root = target();
    const result = spawnSync(
      process.execPath,
      [join(KIT_ROOT, "bin", `${bin}.mjs`), "--verbose", "--dry-run", root],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toMatch(/unknown option:? --verbose/i);
    expect(result.stderr).toContain("Usage:");
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("placeholder rendering", () => {
  it("replaces known tokens and leaves unknown ones alone", () => {
    expect(render("{{PROJECT_NAME}} and {{NOPE}}", { PROJECT_NAME: "Demo" })).toBe(
      "Demo and {{NOPE}}",
    );
  });
});

describe("installation", () => {
  it("refuses to install into the autonomous kit repository itself", async () => {
    await expect(install(KIT_ROOT, ANSWERS)).rejects.toThrow(/its own repository/);
  });

  it("refuses to install over a v1 project, or over a config it cannot read", async () => {
    const root = target();
    writeFileSync(
      join(root, "autonomous.config.json"),
      JSON.stringify({ schemaVersion: 1 }),
      "utf8",
    );
    const refusal = install(root, { ...ANSWERS, force: true });
    await expect(refusal).rejects.toThrow(/version 1 of the kit/);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);

    writeFileSync(join(root, "autonomous.config.json"), "{ not json", "utf8");
    await expect(install(root, { ...ANSWERS, force: true })).rejects.toThrow(/Refusing to update/);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
  });

  it("writes the autonomous kit, the scaffold, and a valid configuration", async () => {
    const root = target();
    await install(root, { ...ANSWERS, "no-stamp": true });

    for (const path of KIT_FILES) expect(existsSync(join(root, path))).toBe(true);
    for (const entry of TEMPLATE_FILES) {
      const rendered = entry.to.replace("{{FIRST_TASK_ID}}", "DEMO-001");
      expect(existsSync(join(root, rendered))).toBe(true);
    }

    clearConfigCache();
    const config = loadConfig({ root, reload: true });
    expect(config.project).toMatchObject({ name: "Demo Project", defaultBranch: "trunk" });
    expect(config.tasks.idPrefix).toBe("DEMO");
    expect(config.git).toMatchObject({
      commitEmail: "demo@users.noreply.github.com",
      remotePath: "demo/demo",
    });
    clearConfigCache();

    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("Demo Project");
    expect(agents).not.toContain("{{");
  });

  it("leaves no unresolved placeholder anywhere it wrote", async () => {
    const root = target();
    const report = await install(root, { ...ANSWERS, "no-stamp": true });
    for (const path of [...report.created, ...report.overwritten]) {
      if (!existsSync(path) || /\.(png|ico|gitkeep)$/.test(path)) continue;
      expect(readFileSync(path, "utf8")).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });

  it("creates the three coordination files, no board, live scope, or archive, and passes check before and after the first commit", async () => {
    const root = target();
    repository(root);
    await install(root, ANSWERS);
    for (const path of ["work/CHECKPOINT.md", "work/AGENT_CONTEXT.md", "work/DECISIONS.md"])
      expect(existsSync(join(root, path)), path).toBe(true);
    for (const path of [
      "work/CURRENT.md",
      "work/coordination.json",
      "work/live-scope.json",
      "work/archive",
    ])
      expect(existsSync(join(root, path)), path).toBe(false);
    expect(readdirSync(join(root, "work/messages"))).toEqual([expect.stringMatching(RECORD_NAME)]);
    // A new install writes the kit's new names: the version key, the stamp marker, the scope id.
    const config = JSON.parse(readFileSync(join(root, "autonomous.config.json"), "utf8"));
    expect(config.autonomousVersion).toBe(2);
    expect(JSON.stringify(config)).not.toContain("harness");
    for (const page of ["docs/project/status.html", "docs/project/architecture.html"])
      expect(readFileSync(join(root, page), "utf8")).toMatch(/^<!-- autonomous-doc-state: /);
    expect(readFileSync(join(root, ".prettierignore"), "utf8")).toMatch(/^work\/DECISIONS\.md$/m);

    // The installed check, before the autonomous kit is committed and after (the
    // stamping test below does the same for the documentation check).
    const before = check(root);
    expect(before.status, `${before.stdout}\n${before.stderr}`).toBe(0);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "Install the autonomous kit");
    const after = check(root);
    expect(after.status, `${after.stdout}\n${after.stderr}`).toBe(0);
  });

  it("passes check while the install commit is not yet pushed upstream", async () => {
    const base = tempDir("autonomous-install-upstream-");
    const remote = join(base, "remote.git");
    git(base, "init", "-q", "--bare", "-b", ANSWERS.branch, remote);
    const root = join(base, "project");
    mkdirSync(root);
    repository(root);
    git(root, "remote", "add", "origin", remote);
    writeFileSync(join(root, "README.md"), "# Demo\n", "utf8");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "Start the project");
    git(root, "push", "-q", "-u", "origin", ANSWERS.branch);

    await install(root, ANSWERS);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "Install the autonomous kit");
    const result = check(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    // The commit scan really ran: the record, not a skipped scan, covers the protected files.
    expect(result.stderr).not.toContain("unpushed-commit scan skipped");
  });

  it("names every protected file it writes in a support-lane record", async () => {
    const root = target();
    const report = await install(root, ANSWERS);
    const record = installRecord(root);
    expect(record).toMatchObject({
      type: "autonomous_support_result",
      schemaVersion: 1,
      agent: "autonomous-install",
    });
    clearConfigCache();
    const config = loadConfig({ root, reload: true });
    clearConfigCache();
    const written = report.created.map((path) => relative(root, path).replaceAll("\\", "/"));
    const protectedPaths = written.filter((path) => isKitPath(path, { root, config }));
    expect(record.filesChanged).toEqual([...protectedPaths].sort());
    expect(record.filesChanged).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "autonomous.config.json",
        ".claude/settings.json",
        "scripts/work.mjs",
      ]),
    );
    // The living documents are the project's own: installed, but not protected.
    expect(record.filesChanged).not.toContain("docs/project/status.html");
  });

  it("reports the same files on a dry run as on the real run", async () => {
    const names = (report, root) =>
      Object.fromEntries(
        ["created", "overwritten", "merged", "skipped", "kept"].map((list) => [
          list,
          report[list].map((path) =>
            relative(root, path)
              .replaceAll("\\", "/")
              .replace(/autonomous-install-\d{8}T\d{6}Z/, "autonomous-install-STAMP"),
          ),
        ]),
      );
    const dryRoot = target();
    const realRoot = target();
    const dry = names(await install(dryRoot, { ...ANSWERS, "dry-run": true }), dryRoot);
    const real = names(await install(realRoot, ANSWERS), realRoot);
    expect(dry).toEqual(real);
    expect(real.created).toContain("work/runs/.gitkeep");
    expect(real.created).not.toContain("work/items/.gitkeep");
  });

  it("merges the autonomous kit hooks into an existing .claude/settings.json and keeps everything else", async () => {
    const root = target();
    const mine = {
      permissions: { allow: ["Bash(npm test)"] },
      env: { MY_FLAG: "1" },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo my-stop" }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo my-check" }] }],
      },
    };
    const original = `${JSON.stringify(mine, null, 2)}\n`;
    mkdirSync(join(root, ".claude"));
    writeFileSync(settingsPath(root), original, "utf8");

    // --force still merges: an existing settings file is never replaced.
    const report = await install(root, { ...ANSWERS, "no-stamp": true, force: true });
    expect(report.merged).toContain(settingsPath(root));
    const merged = readSettings(root);
    const kit = JSON.parse(readFileSync(join(KIT_ROOT, ".claude/settings.json"), "utf8"));
    expect(merged.permissions).toEqual(mine.permissions);
    expect(merged.env).toEqual({ ...kit.env, MY_FLAG: "1" });
    const commands = (event) =>
      merged.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command));
    expect(commands("Stop")).toContain("echo my-stop");
    expect(commands("PreToolUse")).toContain("echo my-check");
    expect(hookCommandTargets(merged).sort()).toEqual(hookCommandTargets(kit).sort());
    const backups = readdirSync(join(root, ".local/backups"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(root, ".local/backups", backups[0]), "utf8")).toBe(original);
    expect(installRecord(root).filesChanged).toContain(".claude/settings.json");

    // A second install finds the hooks wired: nothing changes, nothing is duplicated.
    const again = await install(root, { ...ANSWERS, "no-stamp": true, force: true });
    expect(again.merged).not.toContain(settingsPath(root));
    expect(readSettings(root)).toEqual(merged);
    expect(readdirSync(join(root, ".local/backups"))).toHaveLength(1);
  });

  it("leaves an unreadable .claude/settings.json alone, even with --force, and says so", async () => {
    const root = target();
    mkdirSync(join(root, ".claude"));
    writeFileSync(settingsPath(root), "{ not json", "utf8");
    const report = await install(root, { ...ANSWERS, "no-stamp": true, force: true });
    expect(readFileSync(settingsPath(root), "utf8")).toBe("{ not json");
    expect(report.notes.join("\n")).toMatch(/settings\.json.*NOT wired/);
    expect([...report.created, ...report.overwritten, ...report.merged]).not.toContain(
      settingsPath(root),
    );
  });

  it("does not overwrite an existing file unless a first install is forced", async () => {
    const root = target();
    writeFileSync(join(root, "AGENTS.md"), "# mine\n", "utf8");
    const first = await install(root, { ...ANSWERS, "no-stamp": true });
    expect(first.skipped.some((path) => path.endsWith("AGENTS.md"))).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# mine\n");
    // A later --force is an update, which keeps a file no install wrote.
    const update = await install(root, { ...ANSWERS, "no-stamp": true, force: true });
    expect(update.held.some((path) => path.endsWith("AGENTS.md"))).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# mine\n");

    const forced = target();
    writeFileSync(join(forced, "AGENTS.md"), "# mine\n", "utf8");
    const report = await install(forced, { ...ANSWERS, "no-stamp": true, force: true });
    expect(report.overwritten.some((path) => path.endsWith("AGENTS.md"))).toBe(true);
    expect(readFileSync(join(forced, "AGENTS.md"), "utf8")).toContain("Demo Project");
  });

  it("never replaces the coordination files, the setup task, or the living documents", async () => {
    const root = target();
    await install(root, { ...ANSWERS, "no-stamp": true });
    const state = [
      "work/CHECKPOINT.md",
      "work/AGENT_CONTEXT.md",
      "work/DECISIONS.md",
      "work/items/DEMO-001.json",
      "docs/project/status.html",
      "docs/project/architecture.html",
    ];
    for (const path of state) writeFileSync(join(root, path), `the project's ${path}\n`, "utf8");
    const report = await install(root, { ...ANSWERS, "no-stamp": true, force: true });
    for (const path of state)
      expect(readFileSync(join(root, path), "utf8")).toBe(`the project's ${path}\n`);
    expect(report.kept).toHaveLength(state.length);
    // The kit has not changed since the install, so the update rewrites nothing.
    expect([...report.created, ...report.overwritten, ...report.merged]).toEqual([]);
  });

  it("changes nothing on a dry run", async () => {
    const root = target();
    const report = await install(root, { ...ANSWERS, "dry-run": true });
    expect(report.created.length).toBeGreaterThan(0);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
  });

  it("merges scripts into an existing package.json instead of replacing it", async () => {
    const root = target();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "mine", scripts: { test: "jest" } }, null, 2),
      "utf8",
    );
    await install(root, { ...ANSWERS, "no-stamp": true });
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(parsed.name).toBe("mine");
    expect(parsed.scripts.test).toBe("jest");
    expect(parsed.scripts["work:check"]).toBe("node scripts/work.mjs check");
  });

  it("adds the private runtime directories to an existing .gitignore only once", async () => {
    const root = target();
    writeFileSync(join(root, ".gitignore"), "node_modules/\n", "utf8");
    await install(root, { ...ANSWERS, "no-stamp": true });
    await install(root, { ...ANSWERS, "no-stamp": true, force: true });
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toContain("node_modules/");
    expect(ignore.match(/\.local\//g)).toHaveLength(1);
  });

  it("renames the support agent definition when asked", async () => {
    const root = target();
    await install(root, { ...ANSWERS, "no-stamp": true, "support-agent": "docs-keeper" });
    const path = join(root, ".claude/agents/docs-keeper.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("name: docs-keeper");
    clearConfigCache();
    expect(loadConfig({ root, reload: true }).lanes.supportAgentTypes).toEqual(["docs-keeper"]);
    clearConfigCache();
  });

  it("leaves a project's own rulebooks alone, writes the autonomous kit's beside them, and does not protect them", async () => {
    const root = target();
    writeFileSync(join(root, "AGENTS.md"), "# Our rules\n", "utf8");
    writeFileSync(join(root, "CLAUDE.md"), "# Our Claude notes\n", "utf8");
    const report = await install(root, { ...ANSWERS, "no-stamp": true });
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# Our rules\n");
    expect(readFileSync(join(root, "AGENTS.autonomous.md"), "utf8")).toContain(
      "## Lanes and delegation",
    );
    expect(readFileSync(join(root, "CLAUDE.autonomous.md"), "utf8")).toContain("@AGENTS.md");
    expect(report.notes.join("\n")).toMatch(/AGENTS\.md already existed.*AGENTS\.autonomous\.md/);
    const steps = nextSteps(report).join("\n");
    expect(steps).toMatch(/Merge AGENTS\.autonomous\.md and CLAUDE\.autonomous\.md/);
    expect(steps).not.toMatch(/Big picture section of AGENTS\.md/);

    clearConfigCache();
    const config = loadConfig({ root, reload: true });
    clearConfigCache();
    for (const path of ["AGENTS.md", "CLAUDE.md"]) {
      expect(isKitPath(path, { root, config }), path).toBe(false);
      expect(config.lanes.referenceFiles).not.toContain(path);
    }
    expect(isKitPath("scripts/work.mjs", { root, config })).toBe(true);
    expect(installRecord(root).filesChanged).not.toContain("AGENTS.md");
  });

  it("points the next steps at the Big picture section when it wrote the rulebook", async () => {
    const report = await install(target(), { ...ANSWERS, "no-stamp": true, "dry-run": true });
    expect(report.mergeCopies).toEqual([]);
    expect(nextSteps(report).join("\n")).toMatch(/Big picture section of AGENTS\.md/);
  });

  it("backs up every file a forced first install overwrites with different bytes", async () => {
    const root = target();
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "AGENTS.md"), "# edited\n", "utf8");
    writeFileSync(join(root, "scripts/verify.mjs"), "// edited\n", "utf8");
    writeFileSync(join(root, "scripts/work.mjs"), readFileSync(join(KIT_ROOT, "scripts/work.mjs")));
    const report = await install(root, { ...ANSWERS, "no-stamp": true, force: true });
    const [folder] = readdirSync(join(root, ".local/backups"));
    expect(folder).toMatch(/^install-\d{8}T\d{6}Z$/);
    const backups = join(root, ".local/backups", folder);
    expect(readFileSync(join(backups, "AGENTS.md"), "utf8")).toBe("# edited\n");
    expect(readFileSync(join(backups, "scripts/verify.mjs"), "utf8")).toBe("// edited\n");
    // Files --force rewrote with the same bytes need no backup.
    expect(existsSync(join(backups, "scripts/work.mjs"))).toBe(false);
    expect(report.notes.join("\n")).toContain(`saved under .local/backups/${folder}/`);
  });

  it("covers the protected files it wrote only while their bytes are unchanged", async () => {
    const root = target();
    repository(root);
    await install(root, ANSWERS);
    const record = installRecord(root);
    expect(Object.keys(record.fileHashes)).toEqual(
      expect.arrayContaining([...record.filesChanged, "work/CHECKPOINT.md"]),
    );
    expect(check(root).status).toBe(0);
    // An edit after the install is not the install's: the product lane cannot make it.
    writeFileSync(join(root, "scripts/verify.mjs"), "// changed later\n", "utf8");
    const after = check(root);
    expect(after.status).toBe(1);
    expect(after.stderr).toMatch(/Lane guard: 1 protected path\(s\)[\s\S]*scripts\/verify\.mjs/);
  });

  it("ignores the per-user Claude settings and sets line endings only for its own files", async () => {
    const root = target();
    await install(root, { ...ANSWERS, "no-stamp": true });
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toMatch(
      /^\.claude\/settings\.local\.json$/m,
    );
    const attributes = readFileSync(join(root, ".gitattributes"), "utf8");
    expect(attributes).not.toMatch(/^\*\s/m);
    expect(attributes).toMatch(/^scripts\/work\.mjs text eol=lf$/m);
  });

  it("adds a line an earlier install's .gitignore block lacks, under its marker", async () => {
    const root = target();
    writeFileSync(join(root, ".gitignore"), `dist/\n\n${GITIGNORE_MARKER}\n.local/\n.tools/\n`);
    await install(root, { ...ANSWERS, "no-stamp": true });
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toBe(
      `dist/\n\n${GITIGNORE_MARKER}\n.claude/settings.local.json\n.local/\n.tools/\n`,
    );
  });

  it("stamps the living documents so the fresh project passes its own check", async () => {
    const root = target();
    const report = await install(root, ANSWERS);
    expect(report.notes.join(" ")).toContain("Stamped the living documents");
    // Run the installed copy as a real command, so this asserts what a user
    // would see rather than what the test runner's module graph resolves to.
    const output = execFileSync(
      process.execPath,
      [join(root, "scripts", "documentation.mjs"), "check"],
      { cwd: root, encoding: "utf8" },
    );
    expect(output).toContain("Documentation: FRESH");
  });

  it("maps the documents a project already has, so check passes on an existing project", async () => {
    const root = target();
    repository(root);
    const files = {
      "README.md": "# Shop\n",
      "docs/guide.md": "# Guide\n",
      "notes/plan.md": "# Plan\n",
      // What git leaves out is not a document: a virtual environment, a cache, a build.
      ".gitignore": "venv/\n.pytest_cache/\ndocs/_build/\n",
      "venv/lib/site-packages/tool/README.md": "vendored\n",
      ".pytest_cache/README.md": "cache\n",
      "docs/_build/html/index.html": "<p>built</p>\n",
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, "utf8");
    }
    await install(root, ANSWERS);
    const status = readFileSync(join(root, "docs/project/status.html"), "utf8");
    expect(status).toContain('<a href="../guide.md">docs/guide.md</a>');
    expect(status).toContain('<a href="../../notes/plan.md">notes/plan.md</a>');
    expect(status).not.toMatch(/venv|pytest_cache|_build/);
    const result = check(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("updates a project from its own config, and keeps every file that is the project's", async () => {
    const root = target();
    repository(root);
    // Files the project had before the kit, which the install leaves alone.
    const own = {
      "CHANGELOG.md": "# Our changelog\n",
      "AGENTS.md": "# Our rules\n",
      ".gitattributes": "*.png binary\n",
      ".github/workflows/ci.yml": "name: ours\n",
    };
    for (const [path, text] of Object.entries(own)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, "utf8");
    }
    await install(root, { ...ANSWERS, "project-name": "Shop", "task-prefix": "SHOP" });
    rmSync(join(root, "AGENTS.autonomous.md")); // merged by hand, as the next steps say

    // The project protects a path of its own and changes a kit script through its
    // support lane; verify.mjs stands for a file an older kit wrote (its pin says
    // so), which the update should bring up to date.
    const configPath = join(root, "autonomous.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.lanes.protectedPaths.push("docs/**");
    writeFileSync(configPath, formatJson(config));
    writeFileSync(join(root, "scripts/context-hook.sh"), "# our change\n", "utf8");
    writeFileSync(join(root, "scripts/verify.mjs"), "// an older kit's verify.mjs\n", "utf8");
    const [name] = readdirSync(join(root, "work/messages"));
    const recordPath = join(root, "work/messages", name);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    record.fileHashes["scripts/verify.mjs"] = fileSha256(root, "scripts/verify.mjs");
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    // The pages were reviewed, and stamped, against that older script.
    for (const page of ["architecture", "status"])
      execFileSync(process.execPath, [join(root, "scripts/documentation.mjs"), "stamp", page], {
        cwd: root,
      });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "The project's own changes");

    // The update as the README gives it: no answers, only --force.
    const report = await install(root, { force: true });
    clearConfigCache();
    const updated = loadConfig({ root, reload: true });
    clearConfigCache();
    expect(updated.project.name).toBe("Shop");
    expect(updated.tasks.idPrefix).toBe("SHOP");
    expect(updated.git.commitEmail).toBe(ANSWERS["commit-email"]);
    expect(updated.lanes.protectedPaths).toContain("docs/**");
    expect(readdirSync(join(root, "work/items"))).toEqual(["SHOP-001.json"]);
    for (const [path, text] of Object.entries(own))
      expect(readFileSync(join(root, path), "utf8"), path).toBe(text);
    expect(readFileSync(join(root, "scripts/context-hook.sh"), "utf8")).toBe("# our change\n");
    expect(report.held.map((path) => relative(root, path).replaceAll("\\", "/")).sort()).toEqual(
      [...Object.keys(own), "scripts/context-hook.sh"].sort(),
    );
    // The file only the kit had written is replaced, and needs no backup.
    expect(readFileSync(join(root, "scripts/verify.mjs"))).toEqual(
      readFileSync(join(KIT_ROOT, "scripts/verify.mjs")),
    );
    expect(existsSync(join(root, ".local/backups"))).toBe(false);
    const result = check(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    // The update does not restamp, so the pages written against the old script are due for review.
    const docs = documentationCheck(root);
    expect(docs.status, docs.stdout).toBe(1);
    expect(docs.stdout).toMatch(
      /autonomous-control-plane sources changed after the recorded review/,
    );

    // A flag given to an update still wins.
    await install(root, { force: true, "no-stamp": true, "project-name": "Shop Two" });
    expect(JSON.parse(readFileSync(configPath, "utf8")).project.name).toBe("Shop Two");
  });

  it("re-run plainly, says it updated, and leaves the living documents to the project", async () => {
    const root = target();
    repository(root);
    await install(root, ANSWERS);
    const status = join(root, "docs/project/status.html");
    const prose = `${readFileSync(status, "utf8")}<p>Our progress so far.</p>\n`;
    writeFileSync(status, prose, "utf8");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "Our status");

    const rerun = spawnSync(
      process.execPath,
      [join(KIT_ROOT, "bin/autonomous-install.mjs"), root],
      {
        encoding: "utf8",
      },
    );
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(rerun.stdout).toMatch(/^Autonomous kit updated\./);
    expect(rerun.stdout).toMatch(/commit the update/);
    expect(rerun.stdout).not.toMatch(/placeholder objective|Big picture/);
    // Not restamped, so not pinned as the kit's: an uninstall leaves the page alone.
    expect(readFileSync(status, "utf8")).toBe(prose);
    const plan = uninstall(root, { dryRun: true });
    expect(plan.remove).not.toContain("docs/project/status.html");
    expect(plan.left).toContainEqual({
      path: "docs/project/status.html",
      why: "changed since the install",
    });
  });

  it("updates a short config without adding the keys its defaults answer", async () => {
    const root = target();
    await install(root, { ...ANSWERS, "no-stamp": true });
    const configPath = join(root, "autonomous.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    delete config.documentation;
    writeFileSync(configPath, formatJson(config));
    for (const page of ["architecture", "status"])
      execFileSync(process.execPath, [join(root, "scripts/documentation.mjs"), "stamp", page], {
        cwd: root,
      });
    expect(documentationCheck(root).status).toBe(0);

    await install(root, { force: true });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).not.toHaveProperty("documentation");
    const docs = documentationCheck(root);
    expect(docs.status, docs.stdout).toBe(0);
  });

  it("updates a project installed before the rename without writing a second version key", async () => {
    const root = target();
    await install(root, { ...ANSWERS, "no-stamp": true });
    const configPath = join(root, "autonomous.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const { autonomousVersion, ...rest } = config;
    writeFileSync(configPath, formatJson({ harnessVersion: autonomousVersion, ...rest }));
    await install(root, { "no-stamp": true, force: true });
    const after = JSON.parse(readFileSync(configPath, "utf8"));
    expect(after.harnessVersion).toBe(2);
    expect(after).not.toHaveProperty("autonomousVersion");
  });
});
