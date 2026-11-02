#!/usr/bin/env node
// Claude Code Stop hook: periodic work-in-progress autosave.
//
// Work is saved to the remote periodically so a crash or a lost session cannot
// cost progress, even mid-change. This hook makes an ordinary commit and an
// ordinary fast-forward push of one configured branch - nothing else. It is
// deliberately timid: it refuses far more often than it acts, and every refusal
// is one visible line plus a receipt.
//
// It never amends, never forces, never creates or switches a branch, never tags,
// and never runs `git add -A`. It stages and commits only paths under a
// configured allowlist (whatever else is already staged stays out of its
// commit), and it refuses outright when any candidate path's name looks like
// a secret; it does not read file contents. Its commit runs the project's own
// Git hooks, so a pre-commit secret scanner checks the contents, and a hook
// that refuses stops the save: nothing is committed or pushed, the refusal is
// reported, and the commit is never retried without the hooks.
//
// By default (`autosave.visibilityCheck` "github") it pushes only to a
// repository GitHub confirms is private. Before each save it asks
// `gh repo view <owner/repo> --json visibility`, as `git.account` when the
// config names one, and skips with one line when the answer is anything but
// PRIVATE or cannot be had. With "none" it skips that question, for a remote
// off GitHub; the owner then answers for the remote being private. Either way
// it skips when origin's push URL points anywhere but `git.remotePath`.
// Every git and gh call runs without a terminal and with prompts off, so it can
// answer or fail but never ask.
//
// Everything it needs is in `autonomous.config.json` under `autosave` and `git`.
// With `autosave.enabled` false, or no `autosave.branch`, it does nothing.
//
// Failure policy: always exit 0. A Stop hook that blocks would strand the
// session at the end of every turn, which is worse than a missed autosave.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

import {
  isDirectInvocation,
  latestReceipt,
  projectRoot,
  readStdinJson,
  writeHookReceipt,
} from "./hook-support.mjs";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

export const FETCH_TIMEOUT_MS = 8_000;
export const GIT_TIMEOUT_MS = 10_000;
export const GH_TIMEOUT_MS = 5_000;
/**
 * The commit runs the project's own hooks (linters, secret scanners), which can
 * be slow. A commit killed half-way can leave `.git/index.lock` behind on
 * Windows, so it gets a minute; the Stop hook's timeout in
 * .claude/settings.json leaves room for it.
 */
export const COMMIT_TIMEOUT_MS = 60_000;

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  branch: "",
  remoteHost: "github.com",
  remotePath: "",
  account: "",
  visibilityCheck: "github",
  requiredEmail: "",
  minIntervalMs: 10 * 60 * 1000,
  allowedPrefixes: ["src/", "tests/", "scripts/", "docs/", "work/", ".claude/"],
  allowedFiles: ["AGENTS.md", "CLAUDE.md", "README.md", "CHANGELOG.md"],
});

/**
 * Read the autosave settings from autonomous.config.json, or from
 * harness.config.json, the name the kit used before, when only that exists.
 */
export function loadAutosaveSettings(root) {
  let config = {};
  try {
    const name = existsSync(resolve(root, "autonomous.config.json"))
      ? "autonomous.config.json"
      : "harness.config.json";
    config = JSON.parse(readFileSync(resolve(root, name), "utf8"));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const autosave = config.autosave ?? {};
  const git = config.git ?? {};
  return {
    enabled: autosave.enabled === true,
    branch: typeof autosave.branch === "string" ? autosave.branch : "",
    remoteHost: typeof git.remoteHost === "string" ? git.remoteHost : DEFAULT_SETTINGS.remoteHost,
    remotePath: typeof git.remotePath === "string" ? git.remotePath : "",
    account: typeof git.account === "string" ? git.account.trim() : "",
    visibilityCheck: autosave.visibilityCheck ?? DEFAULT_SETTINGS.visibilityCheck,
    requiredEmail: typeof git.commitEmail === "string" ? git.commitEmail : "",
    minIntervalMs: Number.isFinite(autosave.minIntervalMinutes)
      ? autosave.minIntervalMinutes * 60 * 1000
      : DEFAULT_SETTINGS.minIntervalMs,
    allowedPrefixes: Array.isArray(autosave.allowedPrefixes)
      ? autosave.allowedPrefixes
      : DEFAULT_SETTINGS.allowedPrefixes,
    allowedFiles: Array.isArray(autosave.allowedFiles)
      ? autosave.allowedFiles
      : DEFAULT_SETTINGS.allowedFiles,
  };
}

/** The visibility checks `autosave.visibilityCheck` may name. */
export const VISIBILITY_CHECKS = Object.freeze(["github", "none"]);

/**
 * Never stage anything that looks like a credential, private state, or evidence.
 * Words such as "key" and "token" count only as a whole part of a name, split at
 * "/", ".", "_", and "-": `api-key.txt` and `token.json` look sensitive, while
 * `keyboard.ts`, `monkey.md`, and `tokenizer.py` do not.
 */
export const SECRET_PATTERNS = Object.freeze([
  /(^|\/)\.env($|\.|\/)/i,
  /\.(pem|p12|pfx|key|keystore|jks|ppk)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i,
  /(^|\/)\.(netrc|pgpass|npmrc|pypirc|htpasswd)$/i,
  /(^|[/._-])((api|private|access|secret)[-_]?)?keys?([/._-]|$)/i,
  /(^|[/._-])((api|access|auth|refresh|bearer)[-_]?)?tokens?([/._-]|$)/i,
  /(^|[/._-])credentials?([/._-]|$)/i,
  /(^|[/._-])(client[-_]?)?secrets?([/._-]|$)/i,
  /(^|[/._-])passw(or)?ds?([/._-]|$)/i,
  /(^|\/)\.local\//,
  /^work\/private\//,
  /^outputs\//,
  /(^|\/)secrets\//,
]);

export function isSecretPath(path) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(path));
}

/** Per-user files that are never saved, whatever the allowlist says. */
export const NEVER_SAVED = Object.freeze([".claude/settings.local.json"]);

export function isAllowedPath(path, settings = DEFAULT_SETTINGS) {
  if (path.startsWith("work/private/")) return false;
  if (NEVER_SAVED.includes(path)) return false;
  if (settings.allowedFiles.includes(path)) return true;
  if (/^package(-lock)?\.json$/.test(path)) return true;
  return settings.allowedPrefixes.some((prefix) => path.startsWith(prefix));
}

/** Accept https, ssh, and scp-style remotes for the one expected repository. */
export function isExpectedOrigin(url, settings = DEFAULT_SETTINGS) {
  if (typeof url !== "string" || url.trim() === "") return false;
  if (!settings.remotePath) return false;
  const text = url.trim().replace(/\.git$/, "");
  const scp = /^[^@]+@([^:]+):(.+)$/.exec(text);
  if (scp)
    return (
      scp[1].toLowerCase() === settings.remoteHost.toLowerCase() && scp[2] === settings.remotePath
    );
  try {
    const parsed = new URL(text);
    return (
      parsed.hostname.toLowerCase() === settings.remoteHost.toLowerCase() &&
      parsed.pathname.replace(/^\//, "") === settings.remotePath
    );
  } catch {
    return false;
  }
}

/**
 * How the hook starts every git and gh call: stdin closed, no window, and the
 * prompts of git, its askpass helper, Git Credential Manager, ssh and gh all
 * off. A missing credential makes the call fail, and the hook skips with one
 * line, instead of asking the owner anything.
 */
export function quietSpawnOptions(root, { timeout, env = {} } = {}) {
  return {
    cwd: root,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      GCM_INTERACTIVE: "never",
      SSH_ASKPASS_REQUIRE: "never",
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      ...env,
    },
  };
}

export function makeGitRunner(root) {
  return (args, { timeout = GIT_TIMEOUT_MS } = {}) => {
    const result = spawnSync("git", args, quietSpawnOptions(root, { timeout }));
    return {
      status: result.error ? 1 : (result.status ?? 1),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? (result.error ? result.error.message : ""),
    };
  };
}

export function makeGhRunner(root) {
  return (args, { env = {} } = {}) => {
    const result = spawnSync("gh", args, quietSpawnOptions(root, { timeout: GH_TIMEOUT_MS, env }));
    return {
      status: result.error ? 1 : (result.status ?? 1),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      missing: result.error?.code === "ENOENT",
    };
  };
}

/**
 * Ask GitHub whether the expected repository is private, as the configured
 * account when there is one. Only "PRIVATE" confirms it. A public or internal
 * answer, a missing or signed-out gh, or an unreadable reply all leave it
 * unconfirmed, with a plain reason. The account's token stays in memory: it
 * goes to the one gh call and nowhere else.
 */
export function repositoryVisibility({ gh, settings = DEFAULT_SETTINGS }) {
  if (typeof gh !== "function") return { confirmed: false, reason: "gh is not available" };
  const env = {};
  if (settings.account) {
    const token = gh([
      "auth",
      "token",
      "--hostname",
      settings.remoteHost,
      "--user",
      settings.account,
    ]);
    if (token.status !== 0 || !token.stdout.trim())
      return {
        confirmed: false,
        reason: token.missing ? "gh is not installed" : `gh has no sign-in for ${settings.account}`,
      };
    env.GH_TOKEN = token.stdout.trim();
    env.GH_ENTERPRISE_TOKEN = env.GH_TOKEN;
  }
  const view = gh(
    ["repo", "view", `${settings.remoteHost}/${settings.remotePath}`, "--json", "visibility"],
    { env },
  );
  if (view.status !== 0)
    return {
      confirmed: false,
      reason: view.missing ? "gh is not installed" : "gh could not read the repository",
    };
  let visibility = null;
  try {
    visibility = JSON.parse(view.stdout).visibility ?? null;
  } catch {
    // An unreadable reply confirms nothing.
  }
  if (visibility === "PRIVATE") return { confirmed: true, visibility };
  return {
    confirmed: false,
    visibility,
    reason:
      typeof visibility === "string"
        ? `GitHub reports it as ${visibility.toLowerCase()}`
        : "gh gave no visibility",
  };
}

/** `git status --porcelain=v1 -z` entries, split into paths we could stage. */
export function parseStatusPaths(stdout) {
  const paths = [];
  const entries = String(stdout).split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (!path) continue;
    // A rename carries its source path in the next NUL-separated field.
    if (code.includes("R") || code.includes("C")) {
      const source = entries[index + 1];
      index += 1;
      if (source) paths.push(source);
    }
    paths.push(path);
  }
  return [...new Set(paths)];
}

/** Report an in-flight merge, cherry-pick, or rebase by name, or null. */
export function inProgressOperation(git) {
  for (const [ref, label] of [
    ["MERGE_HEAD", "a merge is in progress"],
    ["CHERRY_PICK_HEAD", "a cherry-pick is in progress"],
    ["REVERT_HEAD", "a revert is in progress"],
  ]) {
    const probe = git(["rev-parse", "--verify", "--quiet", ref]);
    if (probe.status === 0 && probe.stdout.trim()) return label;
  }
  for (const directory of ["rebase-merge", "rebase-apply"]) {
    const probe = git(["rev-parse", "--git-path", directory]);
    if (probe.status !== 0) continue;
    const path = probe.stdout.trim();
    if (path && existsSync(isAbsolute(path) ? path : resolve(gitRoot(git), path)))
      return "a rebase is in progress";
  }
  return null;
}

function gitRoot(git) {
  const probe = git(["rev-parse", "--show-toplevel"]);
  return probe.status === 0 ? probe.stdout.trim() : process.cwd();
}

/**
 * Decide whether an autosave may run. Returns `{ action, reason, paths }` where
 * `action` is "push" or "skip"; every skip carries a plain reason for the one
 * visible line the hook prints. The visibility question goes to GitHub last,
 * only once there is something to save; without a `gh` runner nothing is
 * confirmed, so nothing is pushed. With `visibilityCheck` "none" it is not asked.
 */
export function evaluateAutosave({
  git,
  gh = null,
  settings = DEFAULT_SETTINGS,
  now = new Date(),
  lastPushedAt = null,
  originCheck = isExpectedOrigin,
}) {
  if (!settings.enabled) return skip("autosave is disabled in autonomous.config.json");
  if (!settings.branch) return skip("no autosave branch is configured");
  if (!VISIBILITY_CHECKS.includes(settings.visibilityCheck))
    return skip(
      `autosave.visibilityCheck is ${JSON.stringify(settings.visibilityCheck)}; it must be "github" or "none"`,
    );

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.status !== 0) return skip("git is unavailable here");
  const branchName = branch.stdout.trim();
  if (branchName !== settings.branch) return skip(`branch is ${branchName || "unknown"}`);

  const origin = git(["remote", "get-url", "origin"]);
  if (origin.status !== 0) return skip("no origin remote");
  if (!originCheck(origin.stdout.trim(), settings))
    return skip("origin is not the expected repository");
  // `git push` uses the push URL, which a pushurl or pushInsteadOf can point
  // elsewhere; every one must be the repository whose visibility is checked.
  const push = git(["remote", "get-url", "--push", "--all", "origin"]);
  const pushUrls = push.stdout
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);
  if (
    push.status !== 0 ||
    pushUrls.length === 0 ||
    !pushUrls.every((url) => originCheck(url, settings))
  )
    return skip("origin pushes somewhere other than the expected repository");

  if (settings.requiredEmail) {
    const email = git(["config", "user.email"]);
    if (email.stdout.trim() !== settings.requiredEmail)
      return skip(`commit identity is ${email.stdout.trim() || "unset"}`);
  }

  const operation = inProgressOperation(git);
  if (operation) return skip(operation);

  if (lastPushedAt) {
    const elapsed = now.getTime() - new Date(lastPushedAt).getTime();
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < settings.minIntervalMs)
      return skip(`last autosave was ${Math.round(elapsed / 60000)} min ago`);
  }

  // `--untracked-files=all` matters: the default collapses a new directory into a
  // single entry, which would both hide a secret-shaped file inside it and stage
  // the whole directory blind.
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status.status !== 0) return skip("git status failed");
  const paths = parseStatusPaths(status.stdout);
  if (paths.length === 0) return skip("nothing to save");

  const secrets = paths.filter((path) => isSecretPath(path));
  if (secrets.length > 0)
    return skip(`a changed path looks sensitive (${secrets[0]}); saving it needs a human`, {
      secrets,
    });

  const staged = paths.filter((path) => isAllowedPath(path, settings));
  if (staged.length === 0) return skip("no changed path is inside the autosave allowlist");

  // With "none" the owner has taken responsibility for the remote being private.
  if (settings.visibilityCheck === "github") {
    const visibility = repositoryVisibility({ gh, settings });
    if (!visibility.confirmed)
      return skip(`${settings.remotePath} is not confirmed private (${visibility.reason})`);
  }

  return { action: "push", reason: `${staged.length} file(s) ready`, paths: staged };
}

function skip(reason, extra = {}) {
  return { action: "skip", reason, paths: [], ...extra };
}

export const AUTOSAVE_BODY =
  "Automatic work-in-progress save made by the project's periodic autosave hook.";

export function commitMessage(fileCount, now = new Date()) {
  return `wip(autosave): ${fileCount} files changed at ${now.toISOString()}\n\n${AUTOSAVE_BODY}\n`;
}

/**
 * Fetch, refuse if the remote has moved ahead of us, then stage the allowlisted
 * paths, commit those paths only (`git commit --only`, so whatever else is
 * staged stays staged and out of the save), and push fast-forward only.
 */
export function performAutosave({ git, paths, settings = DEFAULT_SETTINGS, now = new Date() }) {
  const branch = settings.branch;
  const fetched = git(["fetch", "--quiet", "origin", branch], { timeout: FETCH_TIMEOUT_MS });
  if (fetched.status !== 0) return { pushed: false, reason: "could not reach the remote" };

  const counts = git(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]);
  if (counts.status === 0) {
    const [, behind] = counts.stdout.trim().split(/\s+/).map(Number);
    if (Number.isFinite(behind) && behind > 0)
      return { pushed: false, reason: "the remote has newer commits; a human should reconcile" };
  }

  const added = git(["add", "--", ...paths]);
  if (added.status !== 0) return { pushed: false, reason: "could not stage the changes" };

  const staged = git(["diff", "--cached", "--name-only", "--", ...paths]);
  if (staged.status === 0 && staged.stdout.trim() === "")
    return { pushed: false, reason: "nothing to save after filtering" };

  // The project's own commit hooks run. Their output stays out of the report,
  // because a secret scanner's findings can quote the secret.
  const committed = git(
    ["commit", "--only", "-m", commitMessage(paths.length, now), "--", ...paths],
    {
      timeout: COMMIT_TIMEOUT_MS,
    },
  );
  if (committed.status !== 0)
    return {
      pushed: false,
      reason:
        "the commit failed, so nothing was committed or pushed (a project commit hook, such as a secret scanner, may have refused it; the changes stay staged, and `git commit` shows why)",
    };

  const pushed = git(["push", "origin", `${branch}:${branch}`]);
  if (pushed.status !== 0)
    return { pushed: false, reason: "the push was rejected; committed locally only" };

  const head = git(["rev-parse", "--short", "HEAD"]);
  return { pushed: true, reason: "saved", commit: head.stdout.trim() };
}

async function main() {
  await readStdinJson();
  const root = projectRoot(HOOK_DIR);
  const settings = loadAutosaveSettings(root);
  if (!settings.enabled) process.exit(0);
  const git = makeGitRunner(root);
  const now = new Date();
  const last = latestReceipt(root, "autosave", (value) => value?.decision === "pushed");
  const decision = evaluateAutosave({
    git,
    gh: makeGhRunner(root),
    settings,
    now,
    lastPushedAt: last?.recordedAt ?? null,
  });

  if (decision.action === "skip") {
    process.stdout.write(`autosave: skipped - ${decision.reason}.\n`);
    if (decision.secrets)
      writeHookReceipt(
        root,
        "autosave",
        {
          kind: "autosave_refused",
          recordedAt: now.toISOString(),
          decision: "refused",
          reason: decision.reason,
          sensitivePaths: decision.secrets,
        },
        { prefix: "refused" },
      );
    process.exit(0);
  }

  const result = performAutosave({ git, paths: decision.paths, settings, now });
  process.stdout.write(
    result.pushed
      ? `autosave: saved ${decision.paths.length} file(s) to the remote (${result.commit}).\n`
      : `autosave: not saved - ${result.reason}.\n`,
  );
  writeHookReceipt(
    root,
    "autosave",
    {
      kind: "autosave_stop_hook",
      recordedAt: now.toISOString(),
      decision: result.pushed ? "pushed" : "not_pushed",
      reason: result.reason,
      commit: result.commit ?? null,
      fileCount: decision.paths.length,
      paths: decision.paths.slice(0, 40),
    },
    { prefix: result.pushed ? "pushed" : "held" },
  );
  process.exit(0);
}

// Only run the hook when executed directly; tests import the functions above.
if (isDirectInvocation(import.meta.url)) {
  main().catch((error) => {
    process.stdout.write(`autosave: hook could not run: ${error.message}\n`);
    process.exit(0);
  });
}
