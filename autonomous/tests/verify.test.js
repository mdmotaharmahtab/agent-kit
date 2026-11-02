import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { tempDir } from "./temp-dirs.js";
import { DEFAULT_CONFIG } from "../scripts/autonomous-config.mjs";
import { parseArguments, runVerification, snapshot, spawnArguments } from "../scripts/verify.mjs";

const config = { ...DEFAULT_CONFIG, tasks: { idPrefix: "TASK", idDigits: 3 } };

describe("receipt metadata", () => {
  it("requires a task id and a check id before the command", () => {
    const parsed = parseArguments(
      ["--task", "TASK-001", "--check", "unit", "--", "node", "-e", "0"],
      {
        config,
      },
    );
    expect(parsed).toMatchObject({ taskIds: ["TASK-001"], checkId: "unit" });
    expect(parsed.command).toEqual(["node", "-e", "0"]);
  });

  it("rejects a task id from another project's prefix", () => {
    expect(() =>
      parseArguments(["--task", "UN-001", "--check", "unit", "--", "x"], { config }),
    ).toThrow(/Invalid receipt metadata option/);
  });

  it("refuses to run without a command", () => {
    expect(() => parseArguments(["--task", "TASK-001", "--check", "unit"], { config })).toThrow(
      /command after -- is required/,
    );
  });

  it("de-duplicates repeated task ids", () => {
    const parsed = parseArguments(
      ["--task", "TASK-001", "--task", "TASK-001", "--check", "unit", "--", "true"],
      { config },
    );
    expect(parsed.taskIds).toEqual(["TASK-001"]);
  });
});

/** A throwaway git repository, because a receipt is bound to a commit. */
function repository() {
  const root = tempDir("autonomous-verify-");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(root, "file.txt"), "one\n", "utf8");
  git("add", ".");
  git("commit", "-m", "initial");
  return { root, git };
}

describe("verification receipts", () => {
  it("records a passing command against an unchanged snapshot", async () => {
    const { root } = repository();
    const { receipt } = await runVerification({
      root,
      taskIds: ["TASK-001"],
      checkId: "unit",
      command: [process.execPath, "-e", "console.log('ok')"],
      echo: false,
    });
    expect(receipt.exitCode).toBe(0);
    expect(receipt.sourceUnchangedDuringCheck).toBe(true);
    expect(receipt.verificationPassed).toBe(true);
    expect(receipt.before.sha256).toBe(receipt.after.sha256);
    const written = readdirSync(join(root, "work", "runs"));
    expect(written).toHaveLength(1);
    const stored = JSON.parse(readFileSync(join(root, "work", "runs", written[0]), "utf8"));
    expect(stored.id).toBe(receipt.id);
  });

  it("refuses to pass when the command edited the source under it", async () => {
    const { root } = repository();
    const target = resolve(root, "file.txt").replaceAll("\\", "\\\\");
    const { receipt } = await runVerification({
      root,
      taskIds: ["TASK-001"],
      checkId: "sneaky",
      command: [process.execPath, "-e", `require('fs').writeFileSync('${target}', 'two\\n')`],
      echo: false,
    });
    expect(receipt.exitCode).toBe(0);
    expect(receipt.sourceUnchangedDuringCheck).toBe(false);
    expect(receipt.verificationPassed).toBe(false);
  });

  it("records a failing exit code", async () => {
    const { root } = repository();
    const { receipt } = await runVerification({
      root,
      taskIds: ["TASK-001"],
      checkId: "unit",
      command: [process.execPath, "-e", "process.exit(3)"],
      echo: false,
    });
    expect(receipt.exitCode).toBe(3);
    expect(receipt.verificationPassed).toBe(false);
  });

  it("runs a Windows .cmd command such as npm through cmd.exe, and only that", () => {
    const folder = tempDir("autonomous-verify-path-");
    writeFileSync(join(folder, "tool.CMD"), "@echo off\r\n", "utf8");
    const env = { Path: folder, PATHEXT: ".EXE;.CMD", ComSpec: "cmd.exe" };
    const run = (command) => spawnArguments(command, { platform: "win32", cwd: folder, env });
    const { file, args, options } = run(["tool", "a b", 'say "hi"', "x&y"]);
    expect(file).toBe("cmd.exe");
    expect(options).toEqual({ windowsVerbatimArguments: true });
    expect(args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    // Each argument is quoted, then escaped for cmd.exe and again for the batch file.
    const tool = join(folder, "tool.CMD").replace(/([()\][%!^"<>&|;, *?])/g, "^$1");
    expect(args[3]).toBe(`"${tool} ^^^"a^^^ b^^^" ^^^"say^^^ \\^^^"hi\\^^^"^^^" ^^^"x^^^&y^^^""`);
    // cmd.exe would cut the command at a line break, so one is refused, not passed.
    expect(() => run(["tool", "line1\nline2", "after"])).toThrow(/line break/);
    // A command not found as a .cmd file, and any command elsewhere, start directly.
    expect(run(["node", "-e", "0"])).toEqual({ file: "node", args: ["-e", "0"], options: {} });
    expect(spawnArguments(["tool", "x"], { platform: "linux", cwd: folder, env }).file).toBe(
      "tool",
    );
  });

  // The real cmd.exe and a batch file that hands its arguments on, as npm.cmd does.
  it.runIf(process.platform === "win32")(
    "passes every argument through a .cmd command intact",
    async () => {
      const { root } = repository();
      writeFileSync(
        join(root, "print-args.js"),
        "console.log(JSON.stringify(process.argv.slice(2)));\n",
      );
      writeFileSync(
        join(root, "print-args.cmd"),
        `@"${process.execPath}" "%~dp0print-args.js" %*\r\n`,
      );
      const args = ["two words", 'a "quoted" word', 'x "y&z" w', "50%", "!bang", "", "C:\\dir\\"];
      const { receipt } = await runVerification({
        root,
        taskIds: ["TASK-001"],
        checkId: "unit",
        command: [".\\print-args", ...args],
        echo: false,
      });
      expect(receipt.errors).toEqual([]);
      expect(receipt.exitCode).toBe(0);
      const output = readFileSync(join(root, receipt.outputPath), "utf8");
      expect(JSON.parse(output)).toEqual(args);
    },
  );

  it("ignores generated receipts when hashing the tree", async () => {
    const { root } = repository();
    const before = snapshot(root);
    await runVerification({
      root,
      taskIds: ["TASK-001"],
      checkId: "unit",
      command: [process.execPath, "-e", "0"],
      echo: false,
    });
    expect(snapshot(root).sha256).toBe(before.sha256);
  });
});
