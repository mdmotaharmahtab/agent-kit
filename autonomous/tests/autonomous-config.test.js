import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tempDir } from "./temp-dirs.js";
import { KIT_FILES, KIT_ROOT, render } from "../bin/autonomous-install.mjs";
import {
  DEFAULT_CONFIG,
  clearConfigCache,
  kitOwnedPaths,
  loadConfig,
  taskIdExample,
  taskIdInProsePattern,
  taskIdPattern,
  validateConfig,
} from "../scripts/autonomous-config.mjs";
import { isKitPath } from "../scripts/lane-guard.mjs";

function fixture(config) {
  const root = tempDir("autonomous-config-");
  if (config !== undefined)
    writeFileSync(join(root, "autonomous.config.json"), JSON.stringify(config), "utf8");
  return root;
}

describe("autonomous kit configuration", () => {
  beforeEach(() => clearConfigCache());

  it("falls back to the defaults when the file is absent", () => {
    const config = loadConfig({ root: fixture(), reload: true });
    expect(config.tasks.idPrefix).toBe(DEFAULT_CONFIG.tasks.idPrefix);
    expect(config.notes).toEqual([]);
  });

  it("reports a malformed file as a note instead of throwing", () => {
    const root = tempDir("autonomous-config-");
    writeFileSync(join(root, "autonomous.config.json"), "{ not json", "utf8");
    const config = loadConfig({ root, reload: true });
    expect(config.notes[0]).toMatch(/autonomous\.config\.json/);
    expect(config.tasks.idPrefix).toBe("TASK");
  });

  it("merges one level deep so a partial section keeps its defaults", () => {
    const config = loadConfig({
      root: fixture({ tasks: { idPrefix: "ABC" }, project: { name: "Demo" } }),
      reload: true,
    });
    expect(config.tasks.idPrefix).toBe("ABC");
    expect(config.tasks.idDigits).toBe(3);
    expect(config.project.defaultBranch).toBe("main");
  });

  it("builds the task id pattern from the configured prefix and width", () => {
    const config = loadConfig({
      root: fixture({ tasks: { idPrefix: "MYP", idDigits: 4 } }),
      reload: true,
    });
    expect(taskIdPattern(config).test("MYP-0001")).toBe(true);
    expect(taskIdPattern(config).test("MYP-001")).toBe(false);
    expect(taskIdPattern(config).test("OTH-0001")).toBe(false);
    expect(taskIdExample(config)).toBe("MYP-0000");
  });

  it("refuses regex metacharacters in the prefix", () => {
    const config = loadConfig({ root: fixture({ tasks: { idPrefix: "A.*B" } }), reload: true });
    expect(taskIdPattern(config).source).toBe("^AB-\\d{3,}$");
  });

  it("accepts only the known autosave visibility checks", () => {
    expect(validateConfig(loadConfig({ root: fixture(), reload: true }))).toEqual([]);
    expect(
      validateConfig(
        loadConfig({ root: fixture({ autosave: { visibilityCheck: "none" } }), reload: true }),
      ),
    ).toEqual([]);
    const problems = validateConfig(
      loadConfig({ root: fixture({ autosave: { visibilityCheck: "off" } }), reload: true }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('autosave.visibilityCheck is "off"');
  });

  it("finds task ids in prose with the global pattern", () => {
    const config = loadConfig({ root: fixture({ tasks: { idPrefix: "ZZ" } }), reload: true });
    const found = "fixes ZZ-101 and ZZ-102, not QQ-103".match(taskIdInProsePattern(config));
    expect(found).toEqual(["ZZ-101", "ZZ-102"]);
  });
});

describe("default protected paths", () => {
  it("are exactly the files the autonomous kit installs and manages", () => {
    const installed = [
      "AGENTS.md",
      "CLAUDE.md",
      "autonomous.config.json",
      ...KIT_FILES,
      ".claude/agents/docs-keeper.md",
    ];
    expect([...kitOwnedPaths("docs-keeper")].sort()).toEqual([...installed].sort());
    expect(DEFAULT_CONFIG.lanes.protectedPaths).toEqual(kitOwnedPaths("autonomous-support"));
  });

  it("are the same in the template, named after the project's support agent", () => {
    const template = readFileSync(join(KIT_ROOT, "template", "autonomous.config.json"), "utf8");
    const config = JSON.parse(render(template, { SUPPORT_AGENT: "docs-keeper" }));
    expect(config.lanes.protectedPaths).toEqual(kitOwnedPaths("docs-keeper"));
  });

  it("leave the project's own documents, scripts, and Claude files to the product lane", () => {
    const config = DEFAULT_CONFIG;
    for (const path of [
      "AGENTS.md",
      "autonomous.config.json",
      "scripts/work.mjs",
      ".codex/hooks.json",
    ])
      expect(isKitPath(path, { config }), path).toBe(true);
    for (const path of [
      "docs/guide.md",
      "scripts/build.sh",
      ".claude/commands/ship.md",
      "src/a.js",
    ])
      expect(isKitPath(path, { config }), path).toBe(false);
  });
});
