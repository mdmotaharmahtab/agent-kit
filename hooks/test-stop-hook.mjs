#!/usr/bin/env node
// Tests claude-stop-own-work.mjs on small fake transcripts (and, if given, a real one).
// Usage: node test-stop-hook.mjs [real-transcript.jsonl]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "claude-stop-own-work.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stophook-"));
const L = (s) => JSON.stringify({ x: s });
const cases = {
  "agent running -> block": [L("agentId: abcdef1234567 (internal")],
  "agent completed -> pass": [L("agentId: abcdef1234567 (internal"),
    L("<task-notification>\n<task-id>abcdef1234567</task-id>\n<status>completed</status>")],
  "completed then resumed -> block": [L("agentId: abcdef1234567 (internal"),
    L("<task-notification>\n<task-id>abcdef1234567</task-id>\n<status>completed</status>"),
    L('{"success":true,"resumedAgentId":"abcdef1234567"}')],
  "background shell running -> block": [L("Command running in background with ID: b1x2y3z4")],
  "shell killed -> pass": [L("Command running in background with ID: b1x2y3z4"),
    L("<task-id>b1x2y3z4</task-id> ... <status>killed</status>")],
  "nothing launched -> pass": [L("hello")],
  "described agent running -> block": ['{"type":"tool_use","id":"toolu_AAA1","name":"Agent","input":{"description":"Review doc 5","prompt":"x"}}',
    '{"tool_use_id":"toolu_AAA1","content":"agentId: abcdef1234567 (internal"}'],
};
const expectText = { "described agent running -> block": "Agent: Review doc 5" };
// Every block states its rule itself ("instead of idling") and names no rule kept in another file.
const blockText = "instead of idling", foreignRule = "global rule";
let bad = 0;
function run(file, active) {
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ transcript_path: file, stop_hook_active: active }), encoding: "utf8" });
  return r.stdout.includes('"decision":"block"') ? "block" : "pass";
}
for (const [name, lines] of Object.entries(cases)) {
  const f = path.join(dir, name.replace(/\W+/g, "_") + ".jsonl");
  fs.writeFileSync(f, lines.join("\n") + "\n");
  const want = name.endsWith("block") ? "block" : "pass";
  const got = run(f, false);
  const again = run(f, true);   // the second stop of a turn always passes
  let ok = got === want && again === "pass";
  if (want === "block") {
    const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ transcript_path: f }), encoding: "utf8" });
    ok = ok && r.stdout.includes(expectText[name] ?? blockText) && r.stdout.includes(blockText)
      && !r.stdout.includes(foreignRule);
  }
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: got ${got}, second stop ${again}`);
}
// The off switch lets a stop through even while an agent runs.
{
  const f = path.join(dir, "off_switch.jsonl");
  fs.writeFileSync(f, cases["agent running -> block"].join("\n") + "\n");
  for (const value of ["0", "off", "FALSE"]) {
    const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ transcript_path: f }), encoding: "utf8",
      env: { ...process.env, AGENT_KIT_STOP_HOOK: value } });
    const ok = r.status === 0 && !r.stdout.includes('"decision":"block"');
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} off switch AGENT_KIT_STOP_HOOK=${value} -> pass`);
  }
  const on = spawnSync(process.execPath, [hook], { input: JSON.stringify({ transcript_path: f }), encoding: "utf8",
    env: { ...process.env, AGENT_KIT_STOP_HOOK: "1" } });
  const ok = on.stdout.includes('"decision":"block"');
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} AGENT_KIT_STOP_HOOK=1 -> block`);
}
if (process.argv[2]) {
  const t0 = Date.now(); const got = run(process.argv[2], false);
  console.log(`real transcript: ${got} in ${Date.now() - t0} ms`);
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
