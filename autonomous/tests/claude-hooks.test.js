import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { tempDir } from "./temp-dirs.js";
import {
  DEFAULT_SETTINGS,
  commitMessage,
  evaluateAutosave,
  isAllowedPath,
  isExpectedOrigin,
  isSecretPath,
  loadAutosaveSettings,
  makeGitRunner,
  parseStatusPaths,
  performAutosave,
  quietSpawnOptions,
} from "../.claude/hooks/autosave-push-stop.mjs";
import { summarize, validateLiveStateFiles } from "../.claude/hooks/precompact-validate.mjs";

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const settings = {
  ...DEFAULT_SETTINGS,
  enabled: true,
  branch: "main",
  remotePath: "owner/repo",
  requiredEmail: "you@example.com",
};

function gitStub(overrides = {}) {
  const calls = [];
  const responses = {
    "rev-parse --abbrev-ref HEAD": "main\n",
    "remote get-url origin": "https://github.com/owner/repo.git\n",
    "remote get-url --push --all origin": "https://github.com/owner/repo.git\n",
    "config user.email": "you@example.com\n",
    "status --porcelain=v1": " M docs/a.md\0",
    ...overrides,
  };
  const git = (args) => {
    calls.push(args.join(" "));
    const key = args.join(" ");
    for (const [prefix, value] of Object.entries(responses)) {
      if (key.startsWith(prefix))
        return typeof value === "object" ? value : { status: 0, stdout: value, stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unhandled" };
  };
  git.calls = calls;
  return git;
}

/** A gh that answers one visibility, and holds a token only for `token`'s account. */
function ghStub(visibility, { token = null, missing = false } = {}) {
  const calls = [];
  const gh = (args, { env = {} } = {}) => {
    calls.push({ args: args.join(" "), env });
    if (missing) return { status: 1, stdout: "", stderr: "", missing: true };
    if (args[0] === "auth")
      return token
        ? { status: 0, stdout: `${token}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "no oauth token found" };
    if (args[0] === "repo" && visibility)
      return { status: 0, stdout: JSON.stringify({ visibility }), stderr: "" };
    return { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
  };
  gh.calls = calls;
  return gh;
}

/** A temporary project with the autonomous kit scripts, the way an install lays them out. */
function installedProject(files = {}) {
  const root = tempDir("autonomous-hooks-");
  cpSync(join(KIT_ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents, "utf8");
  }
  return root;
}

function runHook(name, root, payload) {
  return spawnSync(process.execPath, [join(KIT_ROOT, ".claude", "hooks", name)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
}

function item(id, overrides = {}) {
  return JSON.stringify({
    id,
    title: "Refresh the docs",
    kind: "chore",
    status: "in_progress",
    approved: true,
    owner: "autonomous-support",
    dependsOn: [],
    acceptance: ["fresh"],
    evidence: [],
    blockers: [],
    nextAction: "edit",
    ownedPaths: ["docs/**"],
    ...overrides,
  });
}

describe("autosave settings", () => {
  it("is disabled when there is no configuration", () => {
    const root = tempDir("autonomous-autosave-");
    expect(loadAutosaveSettings(root).enabled).toBe(false);
  });

  it("reads the branch, identity, and allowlist from the project config", () => {
    const root = tempDir("autonomous-autosave-");
    writeFileSync(
      join(root, "autonomous.config.json"),
      JSON.stringify({
        autosave: { enabled: true, branch: "work", minIntervalMinutes: 5 },
        git: { commitEmail: "me@example.com", remotePath: "me/repo" },
      }),
      "utf8",
    );
    expect(loadAutosaveSettings(root)).toMatchObject({
      enabled: true,
      branch: "work",
      minIntervalMs: 300000,
      requiredEmail: "me@example.com",
      remotePath: "me/repo",
    });
  });
});

describe("autosave safety", () => {
  it("recognizes secret-shaped paths", () => {
    for (const path of [
      ".env",
      ".env.local",
      "config/api.key",
      "a/secrets/x.json",
      "deploy.pem",
      ".local/x",
      "id_rsa",
      "home/.ssh/id_ed25519",
      "credentials.json",
      "config/credential.txt",
      "api-key.txt",
      "apikey.txt",
      "private_key.json",
      "keys/deploy.txt",
      "secrets.yml",
      "client_secret.json",
      "github-token.txt",
      "token.json",
      "auth_tokens/a.txt",
      ".npmrc",
      "passwords.txt",
    ])
      expect(isSecretPath(path), path).toBe(true);
    for (const path of [
      "docs/a.md",
      "src/keyboard.ts",
      "notes/monkey.md",
      "src/tokenizer.py",
      "docs/keynote.md",
      "src/secretary.js",
      "src/turkey/recipe.md",
    ])
      expect(isSecretPath(path), path).toBe(false);
  });

  it("stages only allowlisted paths", () => {
    expect(isAllowedPath("docs/a.md", settings)).toBe(true);
    expect(isAllowedPath("package.json", settings)).toBe(true);
    expect(isAllowedPath("AGENTS.md", settings)).toBe(true);
    expect(isAllowedPath("somewhere/else.txt", settings)).toBe(false);
    expect(isAllowedPath("work/private/notes.md", settings)).toBe(false);
    // Per-user Claude Code settings stay local even though .claude/ is allowlisted.
    expect(isAllowedPath(".claude/settings.json", settings)).toBe(true);
    expect(isAllowedPath(".claude/settings.local.json", settings)).toBe(false);
  });

  it("accepts https, ssh, and scp forms of the one expected remote", () => {
    expect(isExpectedOrigin("https://github.com/owner/repo.git", settings)).toBe(true);
    expect(isExpectedOrigin("git@github.com:owner/repo", settings)).toBe(true);
    expect(isExpectedOrigin("https://github.com/someone/else", settings)).toBe(false);
    expect(isExpectedOrigin("https://github.com/owner/repo", { ...settings, remotePath: "" })).toBe(
      false,
    );
  });

  it("parses a rename's origin path out of porcelain output", () => {
    expect(parseStatusPaths("R  new.md\0old.md\0 M docs/a.md\0")).toEqual([
      "old.md",
      "new.md",
      "docs/a.md",
    ]);
  });
});

describe("autosave decision", () => {
  it("pushes when everything lines up", () => {
    const decision = evaluateAutosave({ git: gitStub(), gh: ghStub("PRIVATE"), settings });
    expect(decision).toMatchObject({ action: "push", paths: ["docs/a.md"] });
  });

  it("refuses when disabled, on the wrong branch, or with the wrong identity", () => {
    expect(evaluateAutosave({ git: gitStub(), settings: DEFAULT_SETTINGS }).reason).toContain(
      "disabled",
    );
    expect(
      evaluateAutosave({
        git: gitStub({ "rev-parse --abbrev-ref HEAD": "feature\n" }),
        settings,
      }).reason,
    ).toContain("branch is feature");
    expect(
      evaluateAutosave({ git: gitStub({ "config user.email": "other@example.com\n" }), settings })
        .reason,
    ).toContain("commit identity is other@example.com");
  });

  it("refuses outright when a changed path looks sensitive", () => {
    const decision = evaluateAutosave({
      git: gitStub({ "status --porcelain=v1": " M docs/a.md\0?? .env\0" }),
      settings,
    });
    expect(decision.action).toBe("skip");
    expect(decision.secrets).toEqual([".env"]);
  });

  it("respects the minimum interval", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const decision = evaluateAutosave({
      git: gitStub(),
      settings,
      now,
      lastPushedAt: "2026-01-01T11:55:00Z",
    });
    expect(decision.reason).toContain("last autosave was 5 min ago");
  });

  it("refuses during a merge", () => {
    const decision = evaluateAutosave({
      git: gitStub({ "rev-parse --verify --quiet MERGE_HEAD": "abc\n" }),
      settings,
    });
    expect(decision.reason).toBe("a merge is in progress");
  });

  it("skips when nothing changed or nothing is allowlisted", () => {
    expect(
      evaluateAutosave({ git: gitStub({ "status --porcelain=v1": "" }), settings }).reason,
    ).toBe("nothing to save");
    expect(
      evaluateAutosave({
        git: gitStub({ "status --porcelain=v1": " M elsewhere/x.txt\0" }),
        settings,
      }).reason,
    ).toContain("allowlist");
  });
});

describe("autosave repository visibility", () => {
  it("reads the visibility check from the config, github by default", () => {
    const root = tempDir("autonomous-autosave-");
    writeFileSync(join(root, "autonomous.config.json"), JSON.stringify({ autosave: {} }), "utf8");
    expect(loadAutosaveSettings(root).visibilityCheck).toBe("github");
    writeFileSync(
      join(root, "autonomous.config.json"),
      JSON.stringify({ autosave: { visibilityCheck: "none" } }),
      "utf8",
    );
    expect(loadAutosaveSettings(root).visibilityCheck).toBe("none");
  });

  it("pushes without asking gh when the visibility check is none", () => {
    const gh = ghStub(null, { missing: true });
    const decision = evaluateAutosave({
      git: gitStub({
        "remote get-url origin": "https://git.example.org/owner/repo.git\n",
        "remote get-url --push --all origin": "https://git.example.org/owner/repo.git\n",
      }),
      gh,
      settings: { ...settings, remoteHost: "git.example.org", visibilityCheck: "none" },
    });
    expect(decision).toMatchObject({ action: "push", paths: ["docs/a.md"] });
    expect(gh.calls).toEqual([]);
  });

  it("still refuses an unexpected origin when the visibility check is none", () => {
    const decision = evaluateAutosave({
      git: gitStub({ "remote get-url origin": "https://github.com/someone/else.git\n" }),
      gh: null,
      settings: { ...settings, visibilityCheck: "none" },
    });
    expect(decision.reason).toBe("origin is not the expected repository");
  });

  it("skips with a plain reason on a visibility check it does not know", () => {
    const decision = evaluateAutosave({
      git: gitStub(),
      gh: ghStub("PRIVATE"),
      settings: { ...settings, visibilityCheck: "gitlab" },
    });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toBe(
      'autosave.visibilityCheck is "gitlab"; it must be "github" or "none"',
    );
  });

  it("refuses when origin pushes somewhere other than the repository it checks", () => {
    const git = gitStub({
      "remote get-url --push --all origin":
        "https://github.com/owner/repo.git\nhttps://github.com/someone/public-mirror.git\n",
    });
    const decision = evaluateAutosave({ git, gh: ghStub("PRIVATE"), settings });
    expect(decision).toMatchObject({ action: "skip", paths: [] });
    expect(decision.reason).toBe("origin pushes somewhere other than the expected repository");
  });

  it("starts every git and gh call with stdin closed and every prompt off", () => {
    const options = quietSpawnOptions("/repo", { timeout: 5000, env: { GH_TOKEN: "t" } });
    expect(options.stdio[0]).toBe("ignore");
    expect(options.env).toMatchObject({
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      GCM_INTERACTIVE: "never",
      SSH_ASKPASS_REQUIRE: "never",
      GH_PROMPT_DISABLED: "1",
      GH_TOKEN: "t",
    });
  });

  it("refuses a public repository with one plain reason", () => {
    const decision = evaluateAutosave({ git: gitStub(), gh: ghStub("PUBLIC"), settings });
    expect(decision).toMatchObject({ action: "skip", paths: [] });
    expect(decision.reason).toBe(
      "owner/repo is not confirmed private (GitHub reports it as public)",
    );
  });

  it("refuses when the visibility cannot be confirmed", () => {
    for (const [gh, reason] of [
      [null, "gh is not available"],
      [ghStub(null, { missing: true }), "gh is not installed"],
      [ghStub(null), "gh could not read the repository"],
    ]) {
      const decision = evaluateAutosave({ git: gitStub(), gh, settings });
      expect(decision.action).toBe("skip");
      expect(decision.reason).toBe(`owner/repo is not confirmed private (${reason})`);
    }
  });

  it("asks as the configured account, and refuses when that account is not signed in", () => {
    const root = tempDir("autonomous-autosave-");
    writeFileSync(
      join(root, "autonomous.config.json"),
      JSON.stringify({
        autosave: { enabled: true, branch: "main" },
        git: { commitEmail: "you@example.com", remotePath: "owner/repo", account: "owner" },
      }),
      "utf8",
    );
    const configured = loadAutosaveSettings(root);
    const gh = ghStub("PRIVATE", { token: "token-for-owner" });
    expect(evaluateAutosave({ git: gitStub(), gh, settings: configured }).action).toBe("push");
    expect(gh.calls[0].args).toBe("auth token --hostname github.com --user owner");
    expect(gh.calls[1]).toMatchObject({
      args: "repo view github.com/owner/repo --json visibility",
      env: { GH_TOKEN: "token-for-owner" },
    });

    const signedOut = evaluateAutosave({
      git: gitStub(),
      gh: ghStub("PRIVATE"),
      settings: configured,
    });
    expect(signedOut.reason).toBe(
      "owner/repo is not confirmed private (gh has no sign-in for owner)",
    );
  });
});

describe("autosave execution", () => {
  it("refuses to push when the remote moved ahead", () => {
    const git = gitStub({
      "fetch --quiet origin main": "",
      "rev-list --left-right --count": "0\t2\n",
    });
    const result = performAutosave({ git, paths: ["docs/a.md"], settings });
    expect(result.pushed).toBe(false);
    expect(result.reason).toContain("newer commits");
    expect(git.calls.some((call) => call.startsWith("push"))).toBe(false);
  });

  it("never forces, amends, or skips the project's commit hooks", () => {
    const git = gitStub({
      "fetch --quiet origin main": "",
      "rev-list --left-right --count": "1\t0\n",
      "add --": "",
      "diff --cached --name-only": "docs/a.md\n",
      commit: "",
      "push origin main:main": "",
      "rev-parse --short HEAD": "abc1234\n",
    });
    const result = performAutosave({ git, paths: ["docs/a.md"], settings });
    expect(result.pushed).toBe(true);
    expect(git.calls.join(" ")).not.toMatch(/--force|--amend|--no-verify|add -A/);
  });

  it("stops when a commit hook refuses: no push, no second try, and no hook output in the report", () => {
    const git = gitStub({
      "fetch --quiet origin main": "",
      "rev-list --left-right --count": "1\t0\n",
      "add --": "",
      "diff --cached --name-only": "docs/a.md\n",
      commit: { status: 1, stdout: "", stderr: "secret scanner: found a token" },
      "push origin main:main": "",
    });
    const result = performAutosave({ git, paths: ["docs/a.md"], settings });
    expect(result.pushed).toBe(false);
    expect(result.reason).toContain("commit hook");
    expect(result.reason).not.toContain("found a token");
    expect(git.calls.filter((call) => call.startsWith("commit"))).toHaveLength(1);
    expect(git.calls.some((call) => call.startsWith("push"))).toBe(false);
  });

  /** Real repositories, a project and its origin: a stub cannot show what git really does. */
  function savedProject() {
    const base = tempDir("autonomous-autosave-hooks-");
    const run = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    const remote = join(base, "remote.git");
    run(base, "init", "-q", "--bare", "-b", "main", remote);
    const root = join(base, "project");
    mkdirSync(root);
    run(root, "init", "-q", "-b", "main");
    for (const [key, value] of [
      ["user.email", "you@example.com"],
      ["user.name", "Test"],
      ["commit.gpgsign", "false"],
    ])
      run(root, "config", key, value);
    run(root, "remote", "add", "origin", remote);
    writeFileSync(join(root, "README.md"), "# Demo\n", "utf8");
    run(root, "add", "README.md");
    run(root, "commit", "-q", "-m", "start");
    run(root, "push", "-q", "-u", "origin", "main");
    return { base, root, remote, run };
  }

  it("commits only the allowlisted paths, and leaves a file staged by hand staged", () => {
    const { root, remote, run } = savedProject();
    writeFileSync(join(root, "notes.txt"), "staged by hand, outside the allowlist\n", "utf8");
    run(root, "add", "notes.txt");
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "a.md"), "work in progress\n", "utf8");
    const saved = performAutosave({ git: makeGitRunner(root), paths: ["docs/a.md"], settings });
    expect(saved.pushed, saved.reason).toBe(true);
    expect(run(root, "show", "--name-only", "--format=", "HEAD")).toBe("docs/a.md");
    expect(run(remote, "rev-parse", "main")).toBe(run(root, "rev-parse", "HEAD"));
    expect(run(root, "diff", "--cached", "--name-only")).toBe("notes.txt");
  });

  it("runs the project's real pre-commit hook, and saves nothing while it refuses", () => {
    const { base, root, remote, run } = savedProject();
    const hooks = join(base, "hooks");
    mkdirSync(hooks);
    run(root, "config", "core.hooksPath", hooks.replaceAll("\\", "/"));
    const hook = (body) =>
      writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "a.md"), "work in progress\n", "utf8");
    const start = run(root, "rev-parse", "HEAD");
    hook("echo refused >&2\nexit 1");
    const refused = performAutosave({ git: makeGitRunner(root), paths: ["docs/a.md"], settings });
    expect(refused.pushed).toBe(false);
    expect(refused.reason).toContain("commit hook");
    expect(run(root, "rev-parse", "HEAD")).toBe(start);
    expect(run(remote, "rev-parse", "main")).toBe(start);

    const ran = join(base, "hook-ran");
    hook(`touch "${ran.replaceAll("\\", "/")}"`);
    const saved = performAutosave({ git: makeGitRunner(root), paths: ["docs/a.md"], settings });
    expect(saved.pushed, saved.reason).toBe(true);
    expect(existsSync(ran)).toBe(true);
    expect(run(remote, "rev-parse", "main")).toBe(run(root, "rev-parse", "HEAD"));
  });

  it("writes a message that says what it is", () => {
    expect(commitMessage(3, new Date("2026-01-01T00:00:00Z"))).toContain(
      "wip(autosave): 3 files changed",
    );
  });
});

describe("precompact validation", () => {
  function withCheckpoint(text) {
    const root = tempDir("autonomous-precompact-");
    mkdirSync(join(root, "work"), { recursive: true });
    if (text !== null) writeFileSync(join(root, "work", "CHECKPOINT.md"), text, "utf8");
    return root;
  }

  it("passes on a present checkpoint", () => {
    const results = validateLiveStateFiles(withCheckpoint("# Checkpoint\n"));
    expect(results).toMatchObject([{ path: "work/CHECKPOINT.md", ok: true }]);
    expect(summarize(results).ok).toBe(true);
  });

  it("reports an empty or missing checkpoint and lets compaction continue", () => {
    for (const text of ["", null]) {
      const results = validateLiveStateFiles(withCheckpoint(text));
      expect(results[0].ok).toBe(false);
      expect(summarize(results).line).toContain("compaction continues");
    }
  });
});

describe("post-compaction recovery context", () => {
  it("prints the shared renderer's objective and queue from the checkpoint", () => {
    const root = installedProject({
      "autonomous.config.json": JSON.stringify({ project: { name: "Fixture" } }),
      "work/CHECKPOINT.md":
        "# Checkpoint\n\n## Primary objective\n\nTASK-001: refresh the docs.\n\n## Queue\n\n| TASK-001 | | support | in progress |\n\n## Log\n\n- 2026-10-11: started.\n",
      "work/items/TASK-001.json": item("TASK-001"),
    });
    const result = runHook("sessionstart-compact-context.mjs", root, {
      hook_event_name: "SessionStart",
      source: "compact",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Fixture: bounded context recovery");
    expect(result.stdout).toContain("SessionStart (compact)");
    expect(result.stdout).toContain("TASK-001: refresh the docs.");
    expect(result.stdout).toContain("| TASK-001 | | support | in progress |");
  });

  it("says so plainly, and exits 0, when the context cannot be rendered", () => {
    const root = tempDir("autonomous-hooks-");
    const result = runHook("sessionstart-compact-context.mjs", root, { source: "compact" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Recovery: the context could not be rendered");
  });
});

describe("lane guard hook", () => {
  const edit = (root, ...path) => ({
    tool_name: "Edit",
    tool_input: { file_path: join(root, ...path) },
  });

  it("lets an edit through while a support item owns the path, and blocks it once done", () => {
    const owned = installedProject({
      "work/items/TASK-001.json": item("TASK-001", { ownedPaths: ["AGENTS.md"] }),
    });
    expect(runHook("lane-guard-pretooluse.mjs", owned, edit(owned, "AGENTS.md")).status).toBe(0);

    const finished = installedProject({
      "work/items/TASK-001.json": item("TASK-001", {
        status: "done",
        evidence: ["work/runs/x.json"],
        ownedPaths: ["AGENTS.md"],
      }),
    });
    const blocked = runHook("lane-guard-pretooluse.mjs", finished, edit(finished, "AGENTS.md"));
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("ownedPaths of an item in progress or in review");
  });

  it("leaves the project's own docs and scripts to the product lane by default", () => {
    const root = installedProject();
    for (const path of [
      ["docs", "guide.md"],
      ["scripts", "build.sh"],
    ])
      expect(runHook("lane-guard-pretooluse.mjs", root, edit(root, ...path)).status).toBe(0);
    expect(
      runHook("lane-guard-pretooluse.mjs", root, edit(root, "scripts", "work.mjs")).status,
    ).toBe(2);
  });
});
