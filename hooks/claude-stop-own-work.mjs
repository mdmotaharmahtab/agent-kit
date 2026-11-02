#!/usr/bin/env node
// Claude Code Stop hook: no idle stop while background work runs.
// While its background tasks run, a coordinator should take up other approved work instead of idling, picking it
// from a fixed menu before every stop. A rule read at session start was forgotten at the moment of stopping,
// repeatedly, so this hook brings it to that moment. When the session ends a turn while any of its background
// agents or shells is still running, it blocks the stop ONCE and shows the menu, with what each running task is (its
// description and how long it has run) and the project's open queue rows, so the scan starts from real state rather
// than memory. The second stop of the same turn (stop_hook_active) always passes, so a turn with genuinely nothing
// to do costs one extra pass, and the hook can never loop. Set AGENT_KIT_STOP_HOOK=0 (or off, false) to turn it off.
// Installed into ~/.claude/settings.json by install-claude-hooks.mjs (run by sync.ps1 Apply). Never throws: any
// error lets the stop through.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const LAUNCH = [/agentId: ([a-z0-9]{8,})/g, /running in background with ID: ([a-z0-9]{6,})/g,
  /"resumedAgentId":"([a-z0-9]{8,})"/g, /Resuming agent ([a-z0-9]{8,})/g];
const DONE = [/<task-id>([a-z0-9]{6,})<\/task-id>[\s\S]{0,4000}?<status>(?:completed|failed|killed|stopped)<\/status>/g,
  /Task ([a-z0-9]{6,}) \(type: [a-z_]+\) \(status: (?:completed|failed|killed|stopped)\)/g];   // after a compaction
const STALE_MS = 2 * 3600 * 1000;   // no sign of life for 2 hours: a task lost to a restart, not a running one
// The launching tool call carries a human description; its result carries the task ID. The transcript format is not
// a stable API, so a missing description falls back to the ID alone.
const TOOL_USE = /"type":"tool_use","id":"(toolu_[A-Za-z0-9]+)","name":"([A-Za-z_]+)","input":\{[^]*?"description":"((?:[^"\\]|\\.)*)"/g;
const TOOL_RESULT = /"tool_use_id":"(toolu_[A-Za-z0-9]+)"/g;
const QUEUE_FILES = ["CHECKPOINT.md", path.join("work", "CHECKPOINT.md")];
const MAX_ROWS = 12;

// A task's output file sits in <tmp>/claude/<project>/<session>/tasks/<id>.output and grows while it runs.
function tasksDir(transcript) {
  const project = path.basename(path.dirname(transcript));
  const session = path.basename(transcript, ".jsonl");
  return path.join(os.tmpdir(), "claude", project, session, "tasks");
}

async function running(transcript) {
  const state = new Map();                        // id -> { st: "running" | "done", at: launch time, what }
  const described = new Map();                    // tool_use id -> "Agent: description"
  const rl = readline.createInterface({ input: fs.createReadStream(transcript, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (raw.includes('"tool_use"') && raw.includes('"description"')) {
      for (const m of raw.matchAll(TOOL_USE)) described.set(m[1], `${m[2]}: ${m[3].replace(/\\"/g, '"')}`);
    }
    if (!raw.includes("agentId") && !raw.includes("task-id") && !raw.includes("background with ID")
        && !raw.includes("esumed") && !raw.includes("(status: ")) continue;
    const line = raw.replace(/\\n/g, "\n").replace(/\\"/g, '"');   // the transcript stores JSON-escaped text
    const at = Date.parse((line.match(/"timestamp":"([^"]+)"/) || [])[1] || "") || Date.now();
    const what = [...raw.matchAll(TOOL_RESULT)].map((m) => described.get(m[1])).find(Boolean) || "";
    const events = [];
    for (const rx of LAUNCH) for (const m of line.matchAll(rx)) events.push([m.index, m[1], "running"]);
    for (const rx of DONE) for (const m of line.matchAll(rx)) events.push([m.index, m[1], "done"]);
    events.sort((a, b) => a[0] - b[0]);
    for (const [, id, st] of events) {
      const prev = state.get(id);
      // keep the first description seen: later lines (request logs) can list several tool calls at once
      state.set(id, { st, at: st === "running" && prev?.st === "running" ? prev.at : at, what: prev?.what || what });
    }
  }
  const dir = tasksDir(transcript), haveDir = fs.existsSync(dir), now = Date.now();
  return [...state].filter(([id, { st, at }]) => {
    if (st !== "running") return false;
    const out = path.join(dir, id + ".output");
    if (fs.existsSync(out)) return now - Math.max(at, fs.statSync(out).mtimeMs) < STALE_MS;
    return !haveDir && now - at < STALE_MS;        // no output file where one should be: not a real task
  }).map(([id, { at, what }]) => ({ id, what, minutes: Math.max(0, Math.round((now - at) / 60000)) }));
}

// Open rows of the project's work queue: Markdown table rows whose last cell does not start with "done".
function openQueueRows(cwd) {
  for (const rel of QUEUE_FILES) {
    const file = path.join(cwd || ".", rel);
    if (!fs.existsSync(file)) continue;
    const rows = fs.readFileSync(file, "utf8").split(/\r?\n/)
      .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
      .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
      .filter((cells) => cells.length >= 2);
    const body = rows.slice(1).filter((c) => !/^done\b/i.test(c[c.length - 1]));
    if (!body.length) return `Queue (${rel}): no open rows.`;
    const shown = body.slice(0, MAX_ROWS).map((c) => `- ${c[0]} [${c[c.length - 1]}]`);
    const more = body.length > MAX_ROWS ? `\n- ... ${body.length - MAX_ROWS} more in ${rel}` : "";
    return `Open queue rows (${rel}):\n${shown.join("\n")}${more}`;
  }
  return "No CHECKPOINT.md queue found in the project; list your remaining steps from the plan.";
}

const MENU = `Background work is still running (%N% task(s)):
%TASKS%
%QUEUE%

Before ending this turn, take up other approved work instead of idling: work that does not depend on these tasks' results, will not be made obsolete when they finish, and touches no file they are editing. Start from the tasks and queue rows above, not from memory, and generate your own work from these kinds:
1. Verify finished units in depth, beyond the scripts (browser, reading, a sample of the changes).
2. Shared files only you edit (engine, root pages, briefs, story or fact files).
3. Prepare the end: one-command checks, reports, totals, the release or publish step.
4. Test what you just built: new tools, scripts, scheduled tasks, hooks.
5. Record lessons: the context file's examples and past mistakes, the decisions log.
6. Earlier requests from the user that are still open. If one waits on the user's yes, prepare it fully now (exact wording, diff or command) so a yes applies it at once; "waiting on the user" is not a reason to do nothing.
7. For each running task above, prepare for its result now: what you will check in it, which files it will change, and the next step that waits on it.
8. Consistency across deliverables after your recent changes: numbering, cross-links, indexes and start pages, totals, names that changed in one place but not another.
For each kind, start a task now, or name in one line why it has none. Write each piece of your own work as its own queue row, never one aggregate "waiting" row. Then end the status with: what is running, and what you started or what blocks each remaining step. If the user told you to stop or wait, just stop. This check runs once per turn.`;

// Off switch: AGENT_KIT_STOP_HOOK=0 (or off/false) lets every stop through.
const OFF = ["0", "off", "false"];

async function main() {
  if (OFF.includes(String(process.env.AGENT_KIT_STOP_HOOK ?? "").trim().toLowerCase())) return;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const ev = JSON.parse(input || "{}");
  if (ev.stop_hook_active || !ev.transcript_path || !fs.existsSync(ev.transcript_path)) return;
  const tasks = await running(ev.transcript_path);
  if (process.env.STOP_HOOK_LIST) { console.log(tasks.length, tasks.map((t) => t.id).join(" ")); return; }   // for testing
  if (!tasks.length) return;
  const lines = tasks.map((t) => `- ${t.what || "task"} (${t.id}, running ${t.minutes} min)`).join("\n");
  let queue = "";
  try { queue = openQueueRows(ev.cwd); } catch { queue = ""; }
  const reason = MENU.replace("%N%", String(tasks.length)).replace("%TASKS%", lines).replace("%QUEUE%", queue);
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}
main().catch(() => {});
