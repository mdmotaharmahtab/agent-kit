// These are not fixtures: they check the package itself. It ships every file
// the installer copies, its own rulebook is the template rendered for it, and
// nothing in it names the source project or a host user.

import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { render, KIT_FILES } from "../bin/autonomous-install.mjs";
import { PACKAGE_NOTE } from "../scripts/autonomous-config.mjs";
import {
  hookCommandTargets,
  hostIdentityCandidates,
  scanTextForHostIdentity,
} from "../scripts/lane-guard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("shipped files", () => {
  it("ships every file the installer promises to copy", () => {
    for (const path of KIT_FILES) {
      expect(existsSync(join(ROOT, path)), `${path} is listed by the installer`).toBe(true);
    }
  });

  it("registers a hook file for every hook command", () => {
    const settings = JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));
    const targets = hookCommandTargets(settings);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(existsSync(join(ROOT, target))).toBe(true);
  });

  it("runs the Codex shell wrapper through bash, so it needs no executable bit", () => {
    const hooks = JSON.parse(readFileSync(join(ROOT, ".codex/hooks.json"), "utf8")).hooks;
    const commands = Object.values(hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands)
      expect(command).toContain('exec bash "$root/scripts/context-hook.sh"');
  });

  it("resolves the Codex Windows wrapper from the repository root, as the POSIX command does", () => {
    const hooks = JSON.parse(readFileSync(join(ROOT, ".codex/hooks.json"), "utf8")).hooks;
    const commands = Object.values(hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.commandWindows)),
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).toContain("git rev-parse --show-toplevel");
      expect(command).toContain("(Join-Path $root 'scripts/context-hook.ps1') run");
    }
  });

  it("keeps the rulebook in step with its template, but for the package's own Big picture", () => {
    // The answers the package's own copies are rendered with.
    const answers = {
      PROJECT_NAME: "Autonomous Kit",
      SUPPORT_AGENT: "autonomous-support",
      FIRST_TASK_ID: "AUTO-001",
      DEFAULT_BRANCH: "main",
    };
    // The first paragraph of the Big picture describes the package itself.
    const picture = (text) => /## Big picture\n\n([\s\S]*?)\n\n/.exec(text)[1];
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const own = readFileSync(join(ROOT, name), "utf8");
      let rendered = render(readFileSync(join(ROOT, "template", name), "utf8"), answers);
      if (name === "AGENTS.md") rendered = rendered.replace(picture(rendered), () => picture(own));
      expect(own, `${name} drifted from template/${name}`).toBe(rendered);
    }
    expect(picture(readFileSync(join(ROOT, "AGENTS.md"), "utf8"))).not.toContain("<one or two");
  });

  it("says the project checks do not apply in the package itself, and exits 0", () => {
    for (const [script, command] of [
      ["work.mjs", "check"],
      ["work.mjs", "no-yield"],
      ["documentation.mjs", "check"],
    ]) {
      const result = spawnSync(process.execPath, [join(ROOT, "scripts", script), command], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(result.status, `${script} ${command}: ${result.stderr}`).toBe(0);
      expect(result.stdout.trim()).toBe(PACKAGE_NOTE);
    }
  });
});

/** True when the package sits in a git checkout, which the file listing below needs. */
const IN_GIT = (() => {
  const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  return probe.status === 0 && probe.stdout.trim() === "true";
})();

/**
 * The length and the SHA-256 of each lowercased private name to keep out of the
 * package. The list lives beside the package, in the private kit only, so a
 * public copy carries neither the names nor their hashes; without it the name
 * test is skipped.
 */
const PRIVATE_TERMS_PATH = resolve(ROOT, "..", "edition", "private-terms.json");
const FORBIDDEN = existsSync(PRIVATE_TERMS_PATH)
  ? JSON.parse(readFileSync(PRIVATE_TERMS_PATH, "utf8")).terms.map(({ length, sha256 }) => [
      length,
      sha256,
    ])
  : null;

describe("genericness", () => {
  const sha256 = (text) => createHash("sha256").update(text).digest("hex");

  /** The line numbers where some slice of the text, lowercased, has one of the hashes. */
  function hashedNameLines(text, forbidden) {
    const lower = text.toLowerCase();
    const lines = new Set();
    for (const length of new Set(forbidden.map(([size]) => size))) {
      const hashes = new Set(forbidden.filter(([size]) => size === length).map(([, hash]) => hash));
      for (let at = 0; at + length <= lower.length; at += 1)
        if (hashes.has(sha256(lower.slice(at, at + length))))
          lines.add(lower.slice(0, at).split("\n").length);
    }
    return [...lines].sort((a, b) => a - b);
  }

  /**
   * Everything a commit could carry: tracked plus non-ignored untracked. A
   * tracked file deleted from the working tree carries no text, so it is skipped.
   */
  function trackedTextFiles() {
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .filter((path) => !/\.(png|jpe?g|gif|ico|wav|mp3|zip|pdf)$/i.test(path))
      .filter((path) => path !== "package-lock.json")
      .filter((path) => existsSync(join(ROOT, path)));
  }

  it("finds a hashed name anywhere in a text, in any letter case", () => {
    const probe = [[7, sha256("example")]];
    expect(hashedNameLines("one EXAMPLE\ntwo\nthree, anExample", probe)).toEqual([1, 3]);
    expect(hashedNameLines("nothing to see", probe)).toEqual([]);
  });

  // Skipped without the private list (a public copy) or without a git checkout.
  it.skipIf(!FORBIDDEN || !IN_GIT)(
    "names neither the source project nor its stack anywhere",
    () => {
      const offenders = [];
      for (const path of trackedTextFiles()) {
        const lines = hashedNameLines(readFileSync(join(ROOT, path), "utf8"), FORBIDDEN);
        if (lines.length) offenders.push(`${path}: line ${lines.join(", ")}`);
      }
      expect(offenders).toEqual([]);
    },
  );

  // Skipped outside a git checkout, which the file listing needs.
  it.skipIf(!IN_GIT)("contains no home-directory path with this host's username", () => {
    const hostNames = hostIdentityCandidates();
    const offenders = [];
    for (const path of trackedTextFiles()) {
      const text = readFileSync(join(ROOT, path), "utf8");
      for (const finding of scanTextForHostIdentity(text, { hostNames }))
        offenders.push(`${path}: ${finding.kind}`);
    }
    expect(offenders).toEqual([]);
  });
});
