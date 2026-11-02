import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { tempDir } from "./temp-dirs.js";
import { DEFAULT_CONFIG, clearConfigCache } from "../scripts/autonomous-config.mjs";
import {
  classifyKitPaths,
  collectChangedPaths,
  evaluateChangelogCoverage,
  evaluateCommitIdentity,
  evaluateDocumentationMap,
  evaluateHostIdentityExposure,
  evaluateInstructionTaskIds,
  evaluateLaneGuard,
  extractPathCandidates,
  hookCommandTargets,
  inspectInstructionTaskIds,
  isCommitCommand,
  isKitPath,
  listLiveDocuments,
  matchesPattern,
  normalizeRepoPath,
  parsePorcelainStatus,
  readOverride,
  resolveMapHref,
  scanTextForHostIdentity,
  sectionBody,
  supportOwnership,
} from "../scripts/lane-guard.mjs";

const config = DEFAULT_CONFIG;

function item(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    kind: "chore",
    status: "in_progress",
    approved: true,
    owner: "autonomous-support",
    dependsOn: [],
    acceptance: ["it works"],
    evidence: [],
    blockers: [],
    nextAction: "next",
    ...overrides,
  };
}

function gitStub(responses) {
  return (args) => {
    const key = args.join(" ");
    for (const [prefix, value] of Object.entries(responses)) {
      if (key.startsWith(prefix)) return { status: 0, stdout: value, stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unhandled" };
  };
}

describe("path patterns", () => {
  it("matches directory scopes and single-segment wildcards", () => {
    expect(matchesPattern("docs/project/status.html", "docs/**")).toBe(true);
    expect(matchesPattern("docs/project/status.html", "docs/*")).toBe(false);
    expect(matchesPattern("scripts/work.mjs", "scripts/")).toBe(true);
    expect(matchesPattern("scripts/work.mjs", "scripts")).toBe(true);
    expect(matchesPattern("scriptsy/work.mjs", "scripts")).toBe(false);
  });

  it("ignores a trailing parenthetical note on an ownership entry", () => {
    expect(matchesPattern("src/app.js", "src/** (only the header)")).toBe(true);
  });

  it("normalizes separators and rejects paths outside the repository", () => {
    expect(normalizeRepoPath("./docs\\project\\status.html")).toBe("docs/project/status.html");
    expect(normalizeRepoPath("C:/elsewhere/file.md", { root: "C:/repo" })).toBeNull();
  });

  it("uses the configured protected list", () => {
    expect(isKitPath("AGENTS.md", { config })).toBe(true);
    expect(isKitPath("src/app.js", { config })).toBe(false);
    const narrow = { ...config, lanes: { ...config.lanes, protectedPaths: ["src/**"] } };
    expect(isKitPath("AGENTS.md", { config: narrow })).toBe(false);
    expect(isKitPath("src/app.js", { config: narrow })).toBe(true);
  });
});

describe("changed paths", () => {
  it("parses porcelain output including a rename's origin", () => {
    const output = "R  new.md\0old.md\0 M docs/a.md\0?? untracked.md\0";
    expect(parsePorcelainStatus(output)).toEqual(["old.md", "new.md", "docs/a.md", "untracked.md"]);
  });

  it("degrades to a note when git is unavailable", () => {
    const result = collectChangedPaths({ runGit: () => ({ status: 128, stderr: "no repo" }) });
    expect(result.gitAvailable).toBe(false);
    expect(result.notes[0]).toMatch(/git status unavailable/);
  });

  it("scans only the commits not yet pushed, even when the branch is behind its upstream", () => {
    // Real repositories: a stub would only pin the command, not what git does with it.
    const base = tempDir("autonomous-upstream-");
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
    const remote = join(base, "remote.git");
    git(base, "init", "-q", "--bare", "-b", "main", remote);
    const clone = (name) => {
      const path = join(base, name);
      git(base, "clone", "-q", remote, path);
      git(path, "config", "user.email", "test@example.com");
      git(path, "config", "user.name", "Test");
      return path;
    };
    const commit = (repo, file) => {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), "x\n", "utf8");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", file);
    };
    const local = clone("local");
    commit(local, "README.md");
    git(local, "push", "-q", "-u", "origin", "main");
    const other = clone("other");
    commit(other, "docs/theirs.md");
    git(other, "push", "-q", "origin", "main");
    git(local, "fetch", "-q", "origin");
    commit(local, "scripts/mine.mjs");

    const result = collectChangedPaths({ root: local });
    expect(result.unpushedCommitsScanned).toBe(true);
    expect(result.unpushed).toEqual(["scripts/mine.mjs"]);
  });

  it("says in one line that the commit scan was skipped without an upstream", () => {
    const result = collectChangedPaths({ runGit: gitStub({ status: " M docs/a.md\0" }) });
    expect(result.workingTree).toEqual(["docs/a.md"]);
    expect(result.unpushedCommitsScanned).toBe(false);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatch(/unpushed-commit scan skipped/);
  });
});

describe("coverage", () => {
  it("counts a support agent's in-progress item as coverage, and nothing else", () => {
    const ownership = supportOwnership(
      [
        item("TASK-001", { ownedPaths: ["CLAUDE.md"] }),
        item("TASK-002", {
          status: "done",
          evidence: ["work/runs/x.json"],
          ownedPaths: ["scripts/**"],
        }),
        item("TASK-003", { owner: "router", ownedPaths: ["AGENTS.md"] }),
      ],
      { config },
    );
    // docs/a.md is the project's own document, not an autonomous kit file, so it needs no coverage.
    const result = classifyKitPaths(["CLAUDE.md", "scripts/work.mjs", "AGENTS.md", "docs/a.md"], {
      ownership,
      config,
    });
    expect(result.covered).toEqual([{ path: "CLAUDE.md", kind: "support_item", by: "TASK-001" }]);
    expect(result.uncovered).toEqual(["AGENTS.md", "scripts/work.mjs"]);
  });

  it("counts a support record that names the path while the record travels with the change", () => {
    const records = [{ path: "work/messages/r.json", patterns: ["scripts/**"] }];
    const pending = classifyKitPaths(["scripts/work.mjs", "work/messages/r.json"], {
      records,
      config,
    });
    expect(pending.covered[0].kind).toBe("support_record");
    // Once the record is pushed, a later edit is not the one it vouched for.
    const later = classifyKitPaths(["scripts/work.mjs"], { records, config });
    expect(later.uncovered).toEqual(["scripts/work.mjs"]);
  });

  it("counts a record that pins the bytes only while the file still has them", () => {
    const root = tempDir("autonomous-pins-");
    writeFileSync(join(root, "AGENTS.md"), "# Rules\n", "utf8");
    // A pin in either letter case, as sha256sum or PowerShell's Get-FileHash prints it.
    const pin = createHash("sha256").update("# Rules\n").digest("hex").toUpperCase();
    const records = [
      { path: "work/messages/r.json", patterns: ["AGENTS.md"], hashes: { "AGENTS.md": pin } },
    ];
    expect(classifyKitPaths(["AGENTS.md"], { records, root, config }).uncovered).toEqual([]);
    writeFileSync(join(root, "AGENTS.md"), "# Rules, edited later\n", "utf8");
    expect(classifyKitPaths(["AGENTS.md"], { records, root, config }).uncovered).toEqual([
      "AGENTS.md",
    ]);
  });
});

describe("override", () => {
  function overrideFixture(body) {
    const root = tempDir("autonomous-override-");
    mkdirSync(join(root, ".local", "runtime"), { recursive: true });
    writeFileSync(
      join(root, ".local", "runtime", "lane-guard-override.json"),
      JSON.stringify(body),
      "utf8",
    );
    return root;
  }

  it("accepts a complete, unexpired override", () => {
    const root = overrideFixture({
      reason: "incident",
      recordedBy: "owner",
      expiresAt: "2099-01-01T00:00:00.000Z",
      paths: ["docs/**"],
    });
    expect(readOverride({ root }).active).toBe(true);
  });

  it("grants nothing once expired or incomplete", () => {
    const expired = overrideFixture({
      reason: "incident",
      recordedBy: "owner",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(readOverride({ root: expired })).toMatchObject({ active: false, reasonCode: "expired" });
    const incomplete = overrideFixture({ reason: "incident" });
    expect(readOverride({ root: incomplete })).toMatchObject({
      active: false,
      reasonCode: "incomplete",
    });
  });
});

describe("full lane-guard evaluation", () => {
  it("fails an undelegated protected change and names the support agent", () => {
    clearConfigCache();
    const root = tempDir("autonomous-lane-");
    writeFileSync(
      join(root, "autonomous.config.json"),
      JSON.stringify({ lanes: { supportAgentTypes: ["my-support"] } }),
      "utf8",
    );
    const result = evaluateLaneGuard({
      root,
      items: [],
      runGit: gitStub({ status: " M AGENTS.md\0" }),
    });
    expect(result.uncovered).toEqual(["AGENTS.md"]);
    expect(result.errors[0]).toContain("my-support");
    clearConfigCache();
  });

  it("fails a later edit that a pushed support record without pins once covered", () => {
    clearConfigCache();
    const root = tempDir("autonomous-lane-");
    mkdirSync(join(root, "work", "messages"), { recursive: true });
    writeFileSync(
      join(root, "work", "messages", "support.json"),
      JSON.stringify({ type: "support_result", filesChanged: ["AGENTS.md"] }),
      "utf8",
    );
    const changed = (status) =>
      evaluateLaneGuard({ root, items: [], runGit: gitStub({ status, "diff --name-only": "" }) });
    expect(changed(" M AGENTS.md\0?? work/messages/support.json\0").errors).toEqual([]);
    expect(changed(" M AGENTS.md\0").uncovered).toEqual(["AGENTS.md"]);
    clearConfigCache();
  });

  it("passes a protected change that an in-progress support item owns", () => {
    clearConfigCache();
    const root = tempDir("autonomous-lane-");
    const result = evaluateLaneGuard({
      root,
      items: [item("TASK-001", { ownedPaths: ["AGENTS.md"] })],
      runGit: gitStub({ status: " M AGENTS.md\0" }),
    });
    expect(result.errors).toEqual([]);
    expect(result.supportItems).toEqual(["TASK-001"]);
    clearConfigCache();
  });
});

describe("milestone-neutral instructions", () => {
  const files = {
    "AGENTS.md": "## Big picture\n\nWe ship TASK-001.\n\n## Rules\n\nSee TASK-900.\n",
  };

  it("refuses any task id in the milestone-neutral section", () => {
    const result = evaluateInstructionTaskIds({
      files,
      primaryObjectiveTaskId: "TASK-001",
      openTaskIds: ["TASK-001"],
      config,
    });
    expect(
      result.errors.some((error) => error.includes('"Big picture" section names TASK-001')),
    ).toBe(true);
  });

  it("allows a live task id elsewhere but not a stale one", () => {
    const result = evaluateInstructionTaskIds({
      files: { "AGENTS.md": "## Rules\n\nSee TASK-001 and TASK-900.\n" },
      primaryObjectiveTaskId: "TASK-001",
      openTaskIds: ["TASK-001"],
      config,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("TASK-900");
  });

  it("takes the live ids from the checkpoint's objective and the open items", () => {
    clearConfigCache();
    const root = tempDir("autonomous-instructions-");
    mkdirSync(join(root, "work", "items"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "## Rules\n\nSee TASK-001, TASK-002, TASK-003.\n");
    writeFileSync(join(root, "CLAUDE.md"), "@AGENTS.md\n");
    writeFileSync(
      join(root, "work", "CHECKPOINT.md"),
      "# Checkpoint\n\n## Primary objective\n\nTASK-001.\n\n## Queue\n\n## Log\n",
    );
    for (const entry of [
      item("TASK-001", { status: "done", evidence: ["work/runs/x.json"] }),
      item("TASK-002", { status: "ready", owner: null }),
      item("TASK-003", { status: "done", evidence: ["work/runs/x.json"] }),
    ])
      writeFileSync(join(root, "work", "items", `${entry.id}.json`), JSON.stringify(entry));
    const result = inspectInstructionTaskIds({ root });
    expect(result.allowed.sort()).toEqual(["TASK-001", "TASK-002"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("names TASK-003");
    clearConfigCache();
  });

  it("extracts one section body", () => {
    expect(sectionBody("## A\n\nalpha\n\n## B\n\nbeta\n", "A").trim()).toBe("alpha");
  });
});

describe("reference freshness", () => {
  it("pulls path-like tokens out of code spans and links", () => {
    const found = extractPathCandidates(
      "run `node scripts/work.mjs check`, see [the map](docs/project/status.html) and `npm`",
    );
    expect(found).toContain("scripts/work.mjs");
    expect(found).toContain("docs/project/status.html");
    expect(found).not.toContain("npm");
  });

  it("collects every hook command target from settings", () => {
    const targets = hookCommandTargets({
      hooks: {
        Stop: [{ hooks: [{ command: "exec node .claude/hooks/autosave-push-stop.mjs" }] }],
      },
    });
    expect(targets).toEqual([".claude/hooks/autosave-push-stop.mjs"]);
  });
});

describe("documentation upkeep", () => {
  it("requires a changelog entry for an accepted task", () => {
    const result = evaluateChangelogCoverage({
      items: [
        { id: "TASK-001", status: "done", acceptedAt: "2026-02-02T00:00:00Z" },
        { id: "TASK-002", status: "done", acceptedAt: "2020-01-01T00:00:00Z" },
        { id: "TASK-003", status: "done" },
      ],
      changelog: "nothing here",
      requiredFrom: "2026-01-01",
    });
    expect(result.missing.map((entry) => entry.id)).toEqual(["TASK-001"]);
  });

  it("maps a document through a directory row", () => {
    const result = evaluateDocumentationMap({
      documents: ["docs/course/lesson-1.md", "docs/project/architecture.html"],
      map: '<a href="../course/index.html">Course</a><a href="architecture.html">Arch</a>',
    });
    expect(result.unmapped).toEqual([]);
  });

  it("reports an unmapped document", () => {
    const result = evaluateDocumentationMap({ documents: ["docs/stray.md"], map: "" });
    expect(result.unmapped).toEqual(["docs/stray.md"]);
  });

  it("resolves an href against the map's own directory", () => {
    expect(resolveMapHref("../../AGENTS.md")).toBe("AGENTS.md");
    expect(resolveMapHref("https://example.com")).toBeNull();
  });

  it("lists prose anywhere and HTML only under docs/", () => {
    const root = tempDir("autonomous-docs-");
    mkdirSync(join(root, "docs", "project"), { recursive: true });
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "README.md"), "x", "utf8");
    writeFileSync(join(root, "docs", "project", "status.html"), "x", "utf8");
    writeFileSync(join(root, "index.html"), "x", "utf8");
    writeFileSync(join(root, "node_modules", "junk.md"), "x", "utf8");
    expect(listLiveDocuments({ root, config })).toEqual(["README.md", "docs/project/status.html"]);
  });

  it("in a git checkout, lists only the documents git would commit", () => {
    const root = tempDir("autonomous-docs-git-");
    execFileSync("git", ["init", "-q"], { cwd: root });
    for (const [path, text] of [
      [".gitignore", "venv/\n.pytest_cache/\ndocs/_build/\n"],
      ["README.md", "x"],
      ["docs/guide.md", "x"],
      ["docs/page.html", "x"],
      ["venv/lib/tool/README.md", "x"],
      [".pytest_cache/README.md", "x"],
      ["docs/_build/html/index.html", "x"],
    ]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, "utf8");
    }
    expect(listLiveDocuments({ root, config })).toEqual([
      "README.md",
      "docs/guide.md",
      "docs/page.html",
    ]);
  });
});

describe("privacy and identity", () => {
  it("reports this host's home path with the name redacted", () => {
    // Assembled at run time so this file does not itself contain a literal
    // home path for the same scan to find.
    const name = "jdoe";
    const findings = scanTextForHostIdentity(`C:\\Users\\${name}\\project\\file.txt`, {
      hostNames: [name],
    });
    expect(findings[0].redactedSample).toBe("C:\\Users\\<user>");
    expect(JSON.stringify(findings)).not.toContain(name);
  });

  it("reports macOS, Linux, and WSL home paths too, but not URL or relative paths", () => {
    const name = "jdoe";
    const scan = (text) => scanTextForHostIdentity(text, { hostNames: [name] });
    for (const [text, sample] of [
      [`/Users/${name}/project`, "/Users/<user>"],
      [`/home/${name}/project`, "/home/<user>"],
      [`/mnt/c/users/${name}/project`, "/mnt/c/users/<user>"],
      [`c:/users/${name}/project`, "c:/users/<user>"],
    ])
      expect(scan(text)[0]?.redactedSample, text).toBe(sample);
    expect(scan(`see https://example.com/home/${name}`)).toEqual([]);
    expect(scan(`./home/${name} and src/Users/${name}.js`)).toEqual([]);
  });

  it("leaves another user's home path alone, such as a container's", () => {
    // A Dockerfile's working folder names the image's user, not this machine's.
    const [image, other] = ["node", "someone"];
    const dockerfile = `FROM node:22\nWORKDIR /home/${image}/app\nCOPY . /Users/${other}/x\n`;
    expect(scanTextForHostIdentity(dockerfile, { hostNames: ["jdoe"] })).toEqual([]);
    expect(scanTextForHostIdentity(dockerfile)).toEqual([]);
  });

  it("counts the host's name only as a whole home-directory segment", () => {
    // A user named "node" must not fail every file that mentions node.
    // Paths are assembled at run time, so this file holds no home path itself.
    const name = "node";
    const hostNames = [name];
    const kinds = (text) => scanTextForHostIdentity(text, { hostNames }).map((f) => f.kind);
    expect(
      scanTextForHostIdentity("run node scripts/work.mjs; node_modules", { hostNames }),
    ).toEqual([]);
    expect(kinds(`/opt/${name}/bin and /home/${name}js/x`)).not.toContain("host_username");
    expect(kinds(`/home/${name}/app`)).toContain("host_username");
    expect(kinds(`C:\\USERS\\${"Node"}\\app`)).toContain("host_username");
  });

  it("ignores deliberate placeholders", () => {
    expect(scanTextForHostIdentity("C:\\Users\\<username-redacted>\\x")).toEqual([]);
    expect(scanTextForHostIdentity("/mnt/c/Users/${USER}/x")).toEqual([]);
  });

  it("treats an archived exposure as a warning, not an error", () => {
    const root = tempDir("autonomous-privacy-");
    mkdirSync(join(root, "docs", "archive"), { recursive: true });
    const name = "jdoe";
    writeFileSync(join(root, "docs", "archive", "old.md"), `C:\\Users\\${name}\\x`, "utf8");
    const result = evaluateHostIdentityExposure({
      root,
      files: ["docs/archive/old.md"],
      hostNames: [name],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toContain("preserved archive file");
  });

  it("blocks a commit whose identity is not the configured one", () => {
    const result = evaluateCommitIdentity({
      requiredEmail: "you@example.com",
      runGit: gitStub({ "var GIT_AUTHOR_IDENT": "Someone <other@example.com> 1 +0000" }),
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("you@example.com");
  });

  it("skips the check when no identity is configured", () => {
    const result = evaluateCommitIdentity({
      requiredEmail: "",
      root: tempDir("autonomous-identity-"),
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBeTruthy();
  });

  it("recognizes a commit command only in command position", () => {
    expect(isCommitCommand("git commit -m 'x'")).toBe(true);
    expect(isCommitCommand("cd x && git commit -m 'x'")).toBe(true);
    expect(isCommitCommand("echo git commit")).toBe(false);
  });

  it("flags an inline identity override", () => {
    const result = evaluateCommitIdentity({
      requiredEmail: "you@example.com",
      commandLine: 'git -c user.email=other@example.com commit -m "x"',
      runGit: gitStub({
        "var GIT_AUTHOR_IDENT": "You <you@example.com> 1 +0000",
        "var GIT_COMMITTER_IDENT": "You <you@example.com> 1 +0000",
      }),
    });
    expect(result.ok).toBe(false);
  });
});
