#!/usr/bin/env node
// Registers the agent kit's Claude Code hooks in ~/.claude/settings.json, or removes them with --uninstall.
// Idempotent: it adds, updates, or removes only the kit's own entries (found by script name) and leaves every other
// setting and hook as it is. Before it changes the file it keeps the previous one beside it, as
// settings.json.before-agent-kit-hooks, or settings.json.before-agent-kit-hooks-uninstall for --uninstall, with a
// timestamp added when that name is taken, so an earlier backup is never overwritten. A file it
// cannot read as settings JSON is never rewritten: it says why and exits 1. Run by sync.ps1 Apply with the node it
// found; the hook command uses that same node, so it works when node is not on PATH.
// Usage: node install-claude-hooks.mjs [--uninstall]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fwd = (p) => p.replace(/\\/g, "/");
const HOOKS = [  // [event, script]
  ["Stop", "claude-stop-own-work.mjs"],
];
const USAGE = "Usage: node install-claude-hooks.mjs [--uninstall]";
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isKitHook = (hook, script) => typeof hook?.command === "string" && hook.command.includes(script);

const args = process.argv.slice(2);
if (args.includes("--help")) { console.log(USAGE); process.exit(0); }
const unknown = args.find((arg) => arg !== "--uninstall");
if (unknown) { console.error(`Unknown option ${unknown}.\n${USAGE}`); process.exit(2); }
const uninstall = args.includes("--uninstall");

// AIKIT_HOME is the test home sync.ps1 also honours, so a test run never touches the real settings.
const settingsPath = path.join(process.env.AIKIT_HOME || os.homedir(), ".claude", "settings.json");
const exists = fs.existsSync(settingsPath);
const refuse = (why) => {
  console.error(`${settingsPath} ${why}, so it was left unchanged and no hook was ${uninstall ? "removed" : "registered"}. Fix or move the file, then run this again.`);
  process.exit(1);
};

let raw = exists ? fs.readFileSync(settingsPath, "utf8") : "";
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);   // a byte-order mark, which some Windows editors write
let settings;
try {
  settings = raw.trim() ? JSON.parse(raw) : {};
} catch (error) {
  refuse(`is not valid JSON (${error.message})`);
}
if (!isObject(settings)) refuse("does not hold a JSON object");
if (settings.hooks !== undefined && !isObject(settings.hooks)) refuse('has a "hooks" value that is not an object');
for (const [event] of HOOKS)
  if (settings.hooks?.[event] !== undefined && !Array.isArray(settings.hooks[event]))
    refuse(`has a "hooks.${event}" value that is not a list`);

let changed = false;
if (uninstall) {
  for (const [event, script] of HOOKS) {
    const groups = settings.hooks?.[event];
    if (!groups) continue;
    const kept = groups.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const rest = group.hooks.filter((hook) => !isKitHook(hook, script));
      if (rest.length === group.hooks.length) return [group];
      changed = true;
      return rest.length ? [{ ...group, hooks: rest }] : [];
    });
    // A list or a hooks object left empty only by this removal goes too; anything else stays.
    if (kept.length || !groups.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (changed && Object.keys(settings.hooks).length === 0) delete settings.hooks;
} else {
  settings.hooks ??= {};
  for (const [event, script] of HOOKS) {
    const command = `"${fwd(process.execPath)}" "${fwd(path.join(here, script))}"`;
    const groups = (settings.hooks[event] ??= []);
    let found = false;
    for (const g of groups) for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
      if (isKitHook(h, script)) {
        found = true;
        if (h.command !== command) { h.command = command; changed = true; }
      }
    }
    if (!found) { groups.push({ hooks: [{ type: "command", command, timeout: 60 }] }); changed = true; }
  }
}

if (!changed) {
  console.log(uninstall ? `No agent-kit hooks in ${settingsPath}; nothing to remove.` : "Claude Code hooks already registered");
  process.exit(0);
}
// An earlier backup is never overwritten: a taken name gets a UTC timestamp, and a counter if that is taken too.
let backup = `${settingsPath}.before-agent-kit-hooks${uninstall ? "-uninstall" : ""}`;
if (fs.existsSync(backup)) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = `${backup}-${stamp}`;
  backup = base;
  for (let count = 2; fs.existsSync(backup); count += 1) backup = `${base}-${count}`;
}
if (exists) fs.copyFileSync(settingsPath, backup);
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(
  uninstall
    ? `Removed the agent-kit hooks from ${settingsPath}; the previous file is kept as ${backup}.`
    : `Claude Code hooks registered in ${settingsPath}`,
);
