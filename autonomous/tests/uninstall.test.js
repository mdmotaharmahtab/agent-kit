// The uninstaller on real temporary projects: it removes what the install
// record pins, puts back what --force replaced, takes the autonomous kit's part out of
// the files it merged into, and leaves every changed file where it is.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tempDir } from "./temp-dirs.js";
import { KIT_ROOT, install } from "../bin/autonomous-install.mjs";
import { uninstall, withoutKitSettings } from "../bin/autonomous-uninstall.mjs";
import { fileSha256 } from "../scripts/lane-guard.mjs";

const ANSWERS = {
  "project-name": "Demo Project",
  "task-prefix": "DEMO",
  branch: "main",
  "commit-email": "",
  "remote-path": "",
  "no-stamp": true,
};

/** Every file in the project, by repository path, except the private backups. */
function files(root) {
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (path === ".local") continue;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk("");
  return found.sort();
}

/** A project with files of its own, including ones the installer merges into. */
function project() {
  const root = tempDir("autonomous-uninstall-");
  const own = {
    "README.md": "# Mine\n",
    "package.json": `${JSON.stringify({ name: "mine", scripts: { test: "jest" } }, null, 2)}\n`,
    ".gitignore": "dist/\n",
    ".claude/settings.json": `${JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`,
  };
  for (const [path, text] of Object.entries(own)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return { root, own };
}

describe("uninstall", () => {
  it("returns the project to its own files, and keeps what changed since the install", async () => {
    const { root, own } = project();
    await install(root, ANSWERS);
    writeFileSync(join(root, "work/CHECKPOINT.md"), "# Our checkpoint, edited\n", "utf8");

    const plan = uninstall(root);
    expect(plan.left).toEqual([{ path: "work/CHECKPOINT.md", why: "changed since the install" }]);
    // The record of a file left behind stays, so a second run can still explain it.
    expect(plan.records).toEqual([]);
    const [record] = readdirSync(join(root, "work/messages"));
    expect(record).toMatch(/^autonomous-install-.*\.json$/);
    expect(files(root)).toEqual(
      [...Object.keys(own), "work/CHECKPOINT.md", `work/messages/${record}`].sort(),
    );
    for (const [path, text] of Object.entries(own))
      expect(JSON.stringify(readFileSync(join(root, path), "utf8")), path).toBe(
        JSON.stringify(text),
      );
    expect(existsSync(join(root, "scripts"))).toBe(false);

    // Once the changed file is gone, a second run removes the record too.
    rmSync(join(root, "work/CHECKPOINT.md"));
    expect(uninstall(root).records).toEqual([`work/messages/${record}`]);
    expect(existsSync(join(root, "work"))).toBe(false);
  });

  it("takes only the autonomous kit's part out of a merged file that changed since", async () => {
    const { root } = project();
    await install(root, ANSWERS);
    const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    settings.permissions.allow.push("Bash(pwd)");
    writeFileSync(join(root, ".claude/settings.json"), JSON.stringify(settings), "utf8");
    uninstall(root);
    expect(JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"))).toEqual({
      permissions: { allow: ["Bash(ls)", "Bash(pwd)"] },
    });
  });

  it("puts back a file of the project's own that --force replaced, even after an update", async () => {
    const { root } = project();
    writeFileSync(join(root, "AGENTS.md"), "# Our rules\n", "utf8");
    await install(root, { ...ANSWERS, force: true });
    // An update replaces the kit's copy where its pin still matches; here the pin
    // is moved to stand for an older kit version, so the update does replace it.
    writeFileSync(join(root, "AGENTS.md"), "# An older kit's rules\n", "utf8");
    const [name] = readdirSync(join(root, "work/messages"));
    const record = JSON.parse(readFileSync(join(root, "work/messages", name), "utf8"));
    record.fileHashes["AGENTS.md"] = fileSha256(root, "AGENTS.md");
    writeFileSync(join(root, "work/messages", name), JSON.stringify(record), "utf8");
    const update = await install(root, { ...ANSWERS, force: true });
    expect(update.overwritten).toContain(join(root, "AGENTS.md"));

    uninstall(root);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# Our rules\n");
    expect(existsSync(join(root, "AGENTS.autonomous.md"))).toBe(false);
  });

  it("names an unknown option and changes nothing", async () => {
    const { root } = project();
    await install(root, ANSWERS);
    const before = files(root);
    const result = spawnSync(
      process.execPath,
      [join(KIT_ROOT, "bin", "autonomous-uninstall.mjs"), root, "--verbose"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/unknown option --verbose/);
    expect(files(root)).toEqual(before);
  });

  it("changes nothing on a dry run, and refuses a project with no install record", async () => {
    const { root } = project();
    await install(root, ANSWERS);
    const before = files(root);
    const plan = uninstall(root, { dryRun: true });
    expect(plan.remove).toContain("scripts/work.mjs");
    expect(files(root)).toEqual(before);
    expect(() => uninstall(tempDir("autonomous-uninstall-"))).toThrow(/No install record/);
  });

  it("removes only the autonomous kit's hooks and settings from Claude settings", () => {
    const kit = JSON.parse(readFileSync(join(KIT_ROOT, ".claude/settings.json"), "utf8"));
    const mine = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } };
    const merged = {
      env: { ...kit.env, MY_FLAG: "1" },
      hooks: { ...kit.hooks, Stop: [...mine.hooks.Stop, ...kit.hooks.Stop] },
    };
    expect(withoutKitSettings(merged, kit)).toEqual({ ...mine, env: { MY_FLAG: "1" } });
  });
});
