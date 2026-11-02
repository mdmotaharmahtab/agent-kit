#!/usr/bin/env node
// Remove the autonomous kit from a project.
//
//   node bin/autonomous-uninstall.mjs <project> [--dry-run]
//
// It undoes what the installer's records in work/messages/ say it wrote, and
// nothing else. A file whose bytes still match the record is removed, or, when
// --force had replaced a file of the project's own, that file's backup is put
// back. A file changed since the install is left where it is, with a note. The
// files the installer merged into keep everything that is not the autonomous kit's:
// .claude/settings.json loses only the autonomous kit's hook entries and settings (or
// gets its backed-up original back when it is unchanged), package.json loses
// only the scripts the install added, and .gitignore only the autonomous kit's block.
// Folders left empty by a removal go too. --dry-run reports the same plan and
// changes nothing.

import { existsSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  GITIGNORE_LINES,
  GITIGNORE_MARKER,
  LEGACY_GITIGNORE_MARKER,
  KIT_FILES,
  KIT_ROOT,
  PACKAGE_SCRIPTS,
  installRecords,
} from "./autonomous-install.mjs";
import { fileSha256, hookCommandTargets } from "../scripts/lane-guard.mjs";

const MESSAGES = "work/messages";
const CLAUDE_SETTINGS = ".claude/settings.json";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sha256Of = (root, path) => fileSha256(root, path);

/** The installer's records, oldest first, each with the file it came from. */
export { installRecords };

/**
 * What each recorded file should hold to count as the install's: the latest
 * record's pin, or, for a record from before pins, the package's own copy. A
 * backup of the project's own file stays with the path through later records,
 * so an update that replaced the kit's copy still lets the original come back.
 */
function expectedFiles(records) {
  const files = new Map();
  for (const { file, value } of records) {
    const merged = new Set(Array.isArray(value.merged) ? value.merged : []);
    const backups = isObject(value.backups) ? value.backups : {};
    if (isObject(value.fileHashes)) {
      for (const [path, hash] of Object.entries(value.fileHashes))
        files.set(path, {
          hash,
          merged: merged.has(path),
          backup: backups[path] ?? files.get(path)?.backup ?? null,
          file,
        });
      continue;
    }
    for (const path of Array.isArray(value.filesChanged) ? value.filesChanged : []) {
      if (path === CLAUDE_SETTINGS) continue;
      const hash = KIT_FILES.includes(path) ? sha256Of(KIT_ROOT, path) : null;
      files.set(path, { hash, merged: false, backup: null, file });
    }
  }
  return files;
}

/** The project's settings without the autonomous kit's hook entries and settings. */
export function withoutKitSettings(settings, kit) {
  if (!isObject(settings)) return settings;
  const result = structuredClone(settings);
  const targets = hookCommandTargets(kit);
  const isKitHook = (hook) =>
    typeof hook?.command === "string" && targets.some((target) => hook.command.includes(target));
  if (isObject(result.hooks)) {
    for (const [event, groups] of Object.entries(result.hooks)) {
      if (!Array.isArray(groups)) continue;
      const kept = groups.flatMap((group) => {
        if (!Array.isArray(group?.hooks)) return [group];
        const rest = group.hooks.filter((hook) => !isKitHook(hook));
        if (rest.length === group.hooks.length) return [group];
        return rest.length ? [{ ...group, hooks: rest }] : [];
      });
      if (kept.length) result.hooks[event] = kept;
      else delete result.hooks[event];
    }
    if (Object.keys(result.hooks).length === 0) delete result.hooks;
  }
  if (isObject(result.env) && isObject(kit.env)) {
    for (const [name, value] of Object.entries(kit.env))
      if (result.env[name] === value) delete result.env[name];
    if (Object.keys(result.env).length === 0) delete result.env;
  }
  return result;
}

/** The new text of a merged file without the autonomous kit's part, or null when nothing changes. */
function unmerge(root, path) {
  const text = readFileSync(join(root, path), "utf8");
  if (path === CLAUDE_SETTINGS) {
    const kit = JSON.parse(readFileSync(join(KIT_ROOT, CLAUDE_SETTINGS), "utf8"));
    const current = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    const cleaned = withoutKitSettings(current, kit);
    return isDeepStrictEqual(cleaned, current) ? null : `${JSON.stringify(cleaned, null, 2)}\n`;
  }
  if (path === "package.json") {
    const current = JSON.parse(text);
    if (!isObject(current?.scripts)) return null;
    const scripts = { ...current.scripts };
    for (const [name, command] of Object.entries(PACKAGE_SCRIPTS))
      if (scripts[name] === command) delete scripts[name];
    if (isDeepStrictEqual(scripts, current.scripts)) return null;
    return `${JSON.stringify({ ...current, scripts }, null, 2)}\n`;
  }
  if (path === ".gitignore") {
    const lines = text.split("\n");
    const start = lines.findIndex((line) =>
      [GITIGNORE_MARKER, LEGACY_GITIGNORE_MARKER].includes(line.trim()),
    );
    if (start === -1) return null;
    let end = start + 1;
    while (end < lines.length && GITIGNORE_LINES.includes(lines[end].trim())) end += 1;
    const kept = [...lines.slice(0, start), ...lines.slice(end)];
    return `${kept.join("\n").replace(/\n+$/, "")}\n`.replace(/^\n$/, "");
  }
  return null;
}

/** Work out the whole uninstall before changing anything. */
export function planUninstall(root) {
  const records = installRecords(root);
  if (records.length === 0)
    throw new Error(
      `No install record in ${MESSAGES}/ (an autonomous-install-*.json file), so there is nothing this command can safely undo.`,
    );
  const plan = { remove: [], restore: [], edit: [], left: [], records: [] };
  for (const [path, expected] of expectedFiles(records)) {
    if (!existsSync(join(root, path))) continue;
    const unchanged = sha256Of(root, path) === expected.hash;
    if (expected.backup && unchanged && existsSync(join(root, expected.backup))) {
      plan.restore.push({ path, from: expected.backup });
    } else if (expected.merged) {
      let text = null;
      try {
        text = unmerge(root, path);
      } catch (error) {
        plan.left.push({ path, why: `could not read it (${error.message})` });
        continue;
      }
      if (text === "") plan.remove.push(path);
      else if (text !== null) plan.edit.push({ path, text });
    } else if (unchanged) {
      plan.remove.push(path);
    } else {
      plan.left.push({
        path,
        why: expected.hash ? "changed since the install" : "no recorded bytes to compare",
      });
    }
  }
  const leftFrom = new Set(
    plan.left.map(({ path }) => expectedFiles(records).get(path)?.file).filter(Boolean),
  );
  plan.records = records.map(({ file }) => file).filter((file) => !leftFrom.has(file));
  return plan;
}

/** Remove the folders a removal emptied, up to the project root. */
function removeEmptyFolders(root, paths) {
  const folders = new Set(paths.map((path) => dirname(join(root, path))));
  const sorted = [...folders].sort((a, b) => b.length - a.length);
  for (let folder of sorted) {
    while (folder.startsWith(root) && folder !== root) {
      try {
        if (readdirSync(folder).length > 0) break;
        rmdirSync(folder);
      } catch {
        break;
      }
      folder = dirname(folder);
    }
  }
}

export function uninstall(target, { dryRun = false } = {}) {
  const root = resolve(target);
  if (root === KIT_ROOT)
    throw new Error("Refusing to uninstall the autonomous kit package itself.");
  const plan = planUninstall(root);
  if (!dryRun) {
    for (const { path, from } of plan.restore)
      writeFileSync(join(root, path), readFileSync(join(root, from)));
    for (const { path, text } of plan.edit) writeFileSync(join(root, path), text, "utf8");
    for (const path of [...plan.remove, ...plan.records]) rmSync(join(root, path), { force: true });
    removeEmptyFolders(root, [...plan.remove, ...plan.records]);
  }
  return plan;
}

function printPlan(plan, dryRun) {
  const show = (label, lines) => {
    if (lines.length === 0) return;
    console.log(`\n${label} (${lines.length}):`);
    for (const line of lines) console.log(`  ${line}`);
  };
  console.log(dryRun ? "Dry run — nothing was changed." : "Autonomous kit removed.");
  show("Removed", [...plan.remove, ...plan.records]);
  show(
    "Restored from the backup --force made",
    plan.restore.map(({ path, from }) => `${path} (from ${from})`),
  );
  show(
    "Kept, with the autonomous kit's part taken out",
    plan.edit.map(({ path }) => path),
  );
  show(
    "Left alone (check and remove by hand if you no longer want them)",
    plan.left.map(({ path, why }) => `${path}: ${why}`),
  );
}

const USAGE = "Usage: node bin/autonomous-uninstall.mjs <project> [--dry-run]\n";

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const dryRun = args.includes("--dry-run");
  const rest = args.filter((arg) => arg !== "--dry-run");
  const unknown = rest.find((arg) => arg.startsWith("-"));
  if (unknown || rest.length !== 1) {
    process.stderr.write(
      `autonomous-uninstall: ${unknown ? `unknown option ${unknown}` : "name exactly one project folder"}.\n${USAGE}`,
    );
    process.exitCode = 2;
    return;
  }
  try {
    const plan = uninstall(rest[0], { dryRun });
    printPlan(plan, dryRun);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
