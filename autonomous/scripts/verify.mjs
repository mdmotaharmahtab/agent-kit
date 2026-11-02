// Run one command and record a receipt that binds its result to the exact
// source snapshot it ran against. A receipt proves only that this command
// produced this exit code on these bytes; acceptance and independent review
// stay separate judgments.

import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  lstatSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { dirname, normalize, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";

import { loadConfig, taskIdExample, taskIdPattern } from "./autonomous-config.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function snapshot(root) {
  const files = [
    ...new Set(
      execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        cwd: root,
        encoding: "utf8",
      })
        .split("\0")
        .filter(Boolean),
    ),
  ]
    // The autonomous kit's own outputs are not source: receipts are written by this
    // run, and .local/ holds the command log this run is about to create.
    .filter((path) => !path.startsWith("work/runs/") && !path.startsWith(".local/"))
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(path).update("\0");
    const absolute = resolve(root, path);
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) hash.update("symlink\0").update(readlinkSync(absolute));
      else if (stat.isFile())
        hash
          .update("file\0")
          .update(String(stat.mode & 0o111))
          .update("\0")
          .update(readFileSync(absolute));
      else throw new Error(`Unsupported snapshot entry: ${path}`);
    } catch (error) {
      if (error.code === "ENOENT") hash.update("missing");
      else throw error;
    }
    hash.update("\0");
  }
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    sha256: hash.digest("hex"),
    fileCount: files.length,
  };
}

export function parseArguments(args, { config = null } = {}) {
  const resolvedConfig = config ?? loadConfig();
  const pattern = taskIdPattern(resolvedConfig);
  const example = taskIdExample(resolvedConfig);
  const separator = args.indexOf("--");
  if (separator < 0 || separator === args.length - 1)
    throw new Error("A command after -- is required.");
  const taskIds = [];
  let checkId;
  for (let index = 0; index < separator; index += 2) {
    const value = args[index + 1];
    if (args[index] === "--task" && pattern.test(value || "")) taskIds.push(value);
    else if (args[index] === "--check" && /^[a-z0-9][a-z0-9_-]*$/.test(value || ""))
      checkId = value;
    else throw new Error(`Invalid receipt metadata option: ${args[index]}`);
  }
  if (!taskIds.length || !checkId)
    throw new Error(`Provide --task ${example} and --check CHECK_ID.`);
  return { taskIds: [...new Set(taskIds)], checkId, command: args.slice(separator + 1) };
}

/** An environment variable, by its name in any letter case, as Windows looks names up. */
function environmentValue(env, name) {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * The file Windows runs for a command name, searched the way cmd.exe searches:
 * the folder it runs in (unless NoDefaultCurrentDirectoryInExePath is set), then
 * each PATH folder, trying each PATHEXT extension. Null when there is none.
 */
export function windowsCommandFile(name, { cwd = process.cwd(), env = process.env } = {}) {
  const extensions = (environmentValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const names = extensions.some((extension) => name.toUpperCase().endsWith(extension.toUpperCase()))
    ? [name]
    : extensions.map((extension) => `${name}${extension}`);
  const folders = /[\\/]/.test(name)
    ? [cwd]
    : [
        ...(environmentValue(env, "NODEFAULTCURRENTDIRECTORYINEXEPATH") === undefined ? [cwd] : []),
        ...(environmentValue(env, "PATH") || "").split(";").filter(Boolean),
      ];
  for (const folder of folders)
    for (const candidate of names) {
      const path = resolve(folder, candidate);
      try {
        if (statSync(path).isFile()) return path;
      } catch {
        // Not in this folder.
      }
    }
  return null;
}

/** The characters cmd.exe treats specially, each escaped with a caret. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const escapeForCmd = (text) => text.replace(CMD_META, "^$1");

/**
 * One argument for a batch file: quoted the way Windows programs split their
 * command line (backslashes before a quote or the closing quote doubled, a quote
 * escaped), then escaped twice for cmd.exe, which reads the line once to start
 * the batch file and again where the batch file passes it on.
 */
function batchArgument(argument) {
  let quoted = '"';
  let backslashes = 0;
  for (const character of String(argument)) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    quoted += "\\".repeat(character === '"' ? backslashes * 2 + 1 : backslashes) + character;
    backslashes = 0;
  }
  quoted += `${"\\".repeat(backslashes * 2)}"`;
  return escapeForCmd(escapeForCmd(quoted));
}

/**
 * The program and arguments that run `command` as written. On Windows a command
 * such as `npm` is a .cmd file: spawn neither finds it (it looks only for .exe
 * and .com files) nor starts it without cmd.exe. Such a command runs through
 * cmd.exe with every argument escaped, so each arrives exactly as given.
 */
export function spawnArguments(
  command,
  { platform = process.platform, cwd = process.cwd(), env = process.env } = {},
) {
  const [file, ...args] = command;
  if (platform !== "win32") return { file, args, options: {} };
  const found = windowsCommandFile(file, { cwd, env });
  if (!found || !/\.(?:cmd|bat)$/i.test(found)) return { file, args, options: {} };
  // cmd.exe ends a command at a line break, so the rest would be dropped without a word.
  if (args.some((argument) => /[\r\n]/.test(String(argument))))
    throw new Error(
      `${file} is a batch file, which cmd.exe runs only up to a line break, so an argument with one cannot reach it intact. Pass that text another way, in a file say.`,
    );
  const line = [escapeForCmd(normalize(found)), ...args.map(batchArgument)].join(" ");
  return {
    file: environmentValue(env, "COMSPEC") || "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}

export async function runVerification({ root = ROOT, taskIds, checkId, command, echo = true }) {
  const startedAt = new Date().toISOString();
  const id = startedAt.replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
  const artifactDir = resolve(root, ".local/artifacts", id);
  const receiptDir = resolve(root, "work/runs");
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(receiptDir, { recursive: true });
  const outputPath = resolve(artifactDir, "output.log");
  const errors = [];
  let before = null;
  let after = null;
  let result = { exitCode: null, signal: null };
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  output.on("error", (error) => errors.push(`Output: ${error.message}`));
  try {
    before = snapshot(root);
  } catch (error) {
    errors.push(`Before snapshot: ${error.message}`);
  }
  if (before) {
    result = await new Promise((resolveResult) => {
      let child;
      try {
        const { file, args, options } = spawnArguments(command, { cwd: root });
        child = spawn(file, args, {
          cwd: root,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          ...options,
        });
      } catch (error) {
        errors.push(`Spawn: ${error.message}`);
        resolveResult(result);
        return;
      }
      child.stdout.on("data", (data) => {
        if (echo) process.stdout.write(data);
        output.write(data);
      });
      child.stderr.on("data", (data) => {
        if (echo) process.stderr.write(data);
        output.write(data);
      });
      child.once("error", (error) => errors.push(`Spawn: ${error.message}`));
      child.once("close", (exitCode, signal) => resolveResult({ exitCode, signal }));
    });
  }
  await new Promise((finish) => {
    if (output.destroyed) finish();
    else {
      output.once("close", finish);
      output.end();
    }
  });
  try {
    after = snapshot(root);
  } catch (error) {
    errors.push(`After snapshot: ${error.message}`);
  }
  let outputSha256 = null;
  try {
    outputSha256 = createHash("sha256").update(readFileSync(outputPath)).digest("hex");
  } catch (error) {
    errors.push(`Output digest: ${error.message}`);
  }
  const unchanged = Boolean(
    before && after && before.commit === after.commit && before.sha256 === after.sha256,
  );
  const receipt = {
    type: "command_receipt",
    schemaVersion: 1,
    id,
    taskIds,
    checkId,
    startedAt,
    completedAt: new Date().toISOString(),
    command,
    runtime: { node: process.version, platform: process.platform },
    before,
    after,
    snapshotScope:
      "Git tracked/nonignored untracked paths, content, symlink targets and executable bits; excludes generated work/runs/ receipts and .local/ runtime output.",
    sourceUnchangedDuringCheck: unchanged,
    ...result,
    errors,
    verificationPassed: result.exitCode === 0 && unchanged && errors.length === 0,
    outputPath: relative(root, outputPath),
    outputSha256,
    note: "Proves only this command on this snapshot; acceptance and independent review remain separate.",
  };
  const receiptPath = resolve(receiptDir, id + ".json");
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  if (echo) {
    console.log("Verification receipt: " + relative(root, receiptPath));
    if (!unchanged)
      console.error("Snapshot missing or changed; this is not valid completion evidence.");
    for (const error of errors) console.error(error);
  }
  return { receipt, receiptPath };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { receipt } = await runVerification(parseArguments(process.argv.slice(2)));
    process.exitCode = receipt.verificationPassed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    console.error(
      `Usage: node scripts/verify.mjs --task ${taskIdExample()} [--task ${taskIdExample()}] --check CHECK_ID -- COMMAND [ARGS]`,
    );
    process.exitCode = 2;
  }
}
