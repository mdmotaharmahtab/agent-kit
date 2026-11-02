// Lifecycle context hook for Codex (and any tool that can run a command hook).
// The Claude Code SessionStart hook prints the same rendered context, so both
// tools recover from one renderer.
//
// It reads the recorded state — the checkpoint and the canonical items — and
// returns a bounded block of recovery context, so a session that starts,
// resumes, or wakes up after compaction is told the current objective and queue
// instead of guessing from a summary.
//
// Contract (matching the Codex hook protocol):
//   * reads one JSON object on stdin,
//   * writes one JSON object on stdout,
//   * SessionStart returns `hookSpecificOutput.additionalContext`,
//     every other event returns `systemMessage`,
//   * every failure prints a note on stderr, writes `{}`, and exits 0.
//
// It never edits a repository file. A bounded receipt is written under
// .local/runtime/context-hook/ and holds decisions and counts only.

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig } from "./autonomous-config.mjs";
import { evaluateDocumentation, renderDocumentationReminder } from "./documentation.mjs";
import { LIVE_STATE_PATHS, checkpointSections, isOpenItem, objectiveId } from "./live-state.mjs";
import { validateQueue } from "./work.mjs";

export const MAX_CONTEXT_BYTES = 3_500;
export const MAX_CHECKPOINT_BYTES = 1_800;
export const MAX_EVENT_MESSAGE_BYTES = 1_200;
export const MAX_HOOK_INPUT_BYTES = 64 * 1024;
export const MAX_STATE_FILE_BYTES = 256 * 1024;
export const MAX_TASK_FILES = 512;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_DIRECTORY = ".local/runtime/context-hook";

const VALID_EVENTS = new Set([
  "SessionStart",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
]);

const CONTINUATION_SAFETY_BOUNDARY =
  "Spending, new account access, interactive authentication, scope changes, public release, and destructive actions still require the owner.";

/** Wanted sections of the checkpoint, in the order recovery needs them. */
export const CHECKPOINT_SECTIONS = Object.freeze(["Primary objective", "Queue"]);

function truncateUtf8(text, limit) {
  const value = String(text ?? "");
  if (Buffer.byteLength(value, "utf8") <= limit) return value;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(characters.slice(0, middle).join(""), "utf8") <= limit - 3) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join("").trimEnd()}...`;
}

/**
 * One safe line of display text. Control characters become spaces rather than
 * being matched by a regular expression, so nothing in a recorded file can
 * smuggle an escape sequence into the context this hook returns.
 */
function cleanInline(value, limit = 240) {
  if (typeof value !== "string") return null;
  const cleaned = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? truncateUtf8(cleaned, limit) : null;
}

/**
 * Read the start of the checkpoint. Its dated log may grow without bound, but
 * recovery needs only the part above it, which `check` keeps under 16 KiB. So
 * the hook reads at most MAX_STATE_FILE_BYTES and never refuses a long file.
 */
function readCheckpointHead(root) {
  const absolute = resolve(root, LIVE_STATE_PATHS.checkpoint);
  if (!existsSync(absolute)) return { text: null, error: "missing" };
  let descriptor;
  try {
    descriptor = openSync(absolute, "r");
    const buffer = Buffer.alloc(MAX_STATE_FILE_BYTES);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    return { text: buffer.subarray(0, length).toString("utf8"), error: null };
  } catch (error) {
    return { text: null, error: cleanInline(error.message) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Pull the named `## ` sections out of the checkpoint, in the order requested. */
export function extractSections(markdown, wanted = CHECKPOINT_SECTIONS) {
  const sections = checkpointSections(markdown);
  const out = [];
  for (const name of wanted) {
    const trimmed = trimBlank(sections.get(name) ?? []);
    if (trimmed.length > 0) out.push(`### ${name}`, ...trimmed, "");
  }
  return trimBlank(out).join("\n");
}

function trimBlank(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** Read the checkpoint and the items without validating them beyond parse + shape. */
export function loadRecoveryState(root = ROOT) {
  const notes = [];
  const config = loadConfig({ root });
  const checkpoint = readCheckpointHead(root);
  if (checkpoint.error) notes.push(`${LIVE_STATE_PATHS.checkpoint}: ${checkpoint.error}`);

  const tasks = [];
  try {
    const directory = resolve(root, "work/items");
    const names = existsSync(directory)
      ? readdirSync(directory)
          .filter((name) => name.endsWith(".json"))
          .sort()
      : [];
    if (names.length > MAX_TASK_FILES)
      notes.push(`work/items: ${names.length} tasks exceed the ${MAX_TASK_FILES} recovery bound.`);
    for (const name of names.slice(0, MAX_TASK_FILES)) {
      try {
        tasks.push(JSON.parse(readFileSync(resolve(directory, name), "utf8")));
      } catch (error) {
        notes.push(`work/items/${name}: ${cleanInline(error.message, 120)}`);
      }
    }
  } catch (error) {
    notes.push(`work/items: ${cleanInline(error.message, 120)}`);
  }

  let queueErrors = [];
  try {
    queueErrors = validateQueue(tasks, { config });
  } catch (error) {
    notes.push(`queue validation: ${cleanInline(error.message, 160)}`);
  }

  return {
    checkpoint: checkpoint.text,
    objective: checkpoint.text === null ? null : objectiveId(checkpoint.text, { config }),
    tasks,
    queueErrors,
    notes,
  };
}

function renderObjective(state) {
  if (!state.objective) return `No primary objective is named in ${LIVE_STATE_PATHS.checkpoint}.`;
  const item = state.tasks.find((task) => task?.id === state.objective);
  if (!item) return `${cleanInline(state.objective, 40)}: no item in work/items.`;
  return `Task: ${cleanInline(item.id, 40)} [${cleanInline(item.status, 20)}] ${cleanInline(item.title, 160) ?? ""}`;
}

function renderCheckpoint(state) {
  if (state.checkpoint === null)
    return `${LIVE_STATE_PATHS.checkpoint} could not be read; read it by hand and run \`node scripts/work.mjs check\`.`;
  const sections = extractSections(state.checkpoint);
  if (!sections) return "No Primary objective or Queue section found.";
  if (Buffer.byteLength(sections, "utf8") <= MAX_CHECKPOINT_BYTES) return sections;
  const pointer = `Truncated; read ${LIVE_STATE_PATHS.checkpoint} for the rest.`;
  return `${truncateUtf8(sections, MAX_CHECKPOINT_BYTES - Buffer.byteLength(pointer, "utf8") - 1)}\n${pointer}`;
}

/** The open (approved, not done) items, the moving ones first, so the cap never hides them. */
function renderTasks(state) {
  const order = ["in_progress", "review", "blocked", "ready"];
  const rank = (task) => (order.includes(task.status) ? order.indexOf(task.status) : order.length);
  const open = state.tasks.filter(isOpenItem).sort((a, b) => rank(a) - rank(b));
  if (open.length === 0) return "No approved task is open.";
  return open
    .slice(0, 12)
    .map(
      (task) =>
        `- ${cleanInline(task.id, 40)} [${cleanInline(task.status, 20)}] ${cleanInline(task.title, 120) ?? ""}` +
        (task.blockers?.length ? ` — blocked: ${cleanInline(task.blockers[0], 160)}` : ""),
    )
    .join("\n");
}

function renderHealth(state) {
  const parts = [];
  if (state.queueErrors.length)
    parts.push(
      `Queue validation reported ${state.queueErrors.length} problem(s); first: ${cleanInline(state.queueErrors[0], 200)}`,
    );
  for (const note of state.notes.slice(0, 4)) parts.push(cleanInline(note, 200));
  return parts.length ? parts.join("\n") : "Recorded state parsed cleanly.";
}

export function renderContinuationDirective(eventName) {
  const action = {
    SessionStart:
      "Reconcile the checkpoint queue with the validated items and their owners before editing; then continue the next safe approved action rather than stopping on a progress report.",
    SubagentStart:
      "Complete the assigned task within owned paths and acceptance checks; record exact evidence plus the next safe action.",
    PreCompact:
      "Checkpoint the current result, ownership, and exact next action durably before compaction; compaction is not a stopping point.",
    PostCompact:
      "Compaction finished; re-read the checkpoint and the open items before continuing approved work.",
    SubagentStop:
      "Integrate or route this result, reconcile the item and the checkpoint queue, then continue the next safe approved action.",
  }[eventName];
  if (!action) return "";
  return `${action} ${CONTINUATION_SAFETY_BOUNDARY}`;
}

function safeDocumentation(root, evaluator) {
  try {
    return evaluator(root);
  } catch {
    return null;
  }
}

export function renderRecoveryContext({
  root = ROOT,
  input = {},
  documentationEvaluator = evaluateDocumentation,
} = {}) {
  const config = loadConfig({ root });
  const state = loadRecoveryState(root);
  const documentation = safeDocumentation(root, documentationEvaluator);
  const reminder = documentation
    ? renderDocumentationReminder(documentation, { audience: "coordinator", maxBytes: 320 })
    : "";
  const source = cleanInline(input?.source ?? input?.trigger, 40) ?? "unknown";
  const projectName = cleanInline(config.project?.name, 60) ?? "This project";
  const context = [
    `# ${projectName}: bounded context recovery`,
    `SessionStart (${source}). Recorded state only — not restored reasoning and not proof that any process is still running.`,
    "Authority: AGENTS.md rules, work/DECISIONS.md corrections, work/items status, work/CHECKPOINT.md queue. A chat or compaction summary is not authority.",
    `## Autonomous continuation\n${renderContinuationDirective("SessionStart")}`,
    ...(reminder ? [`## Documentation\n${reminder}`] : []),
    `## Primary objective\n${renderObjective(state)}`,
    `## Checkpoint\n${renderCheckpoint(state)}`,
    `## Open tasks (recorded only)\n${renderTasks(state)}`,
    `## State health\n${renderHealth(state)}`,
  ].join("\n\n");
  return { context: truncateUtf8(context, MAX_CONTEXT_BYTES), state, documentation };
}

export function sessionStartOutput(options = {}) {
  const rendered = renderRecoveryContext(options);
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: rendered.context,
    },
  };
}

/** Write a bounded receipt. Never throws; returns the path or null. */
export function writeContextReceipt(root, body) {
  try {
    const directory = resolve(root, RECEIPT_DIRECTORY);
    mkdirSync(directory, { recursive: true });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 8);
    const path = resolve(directory, `${stamp}-${digest}.json`);
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    return path;
  } catch {
    return null;
  }
}

export function dispatchHook({ root = ROOT, input = {}, mode = "run" } = {}) {
  const eventName = VALID_EVENTS.has(input?.hook_event_name)
    ? input.hook_event_name
    : "SessionStart";
  const diagnostics = [];

  if (eventName === "SessionStart") {
    const rendered = renderRecoveryContext({ root, input });
    if (mode === "run")
      writeContextReceipt(root, {
        kind: "context_hook_session_start",
        recordedAt: new Date().toISOString(),
        source: input?.source ?? null,
        contextBytes: Buffer.byteLength(rendered.context, "utf8"),
        queueErrors: rendered.state.queueErrors.length,
        notes: rendered.state.notes.length,
      });
    return {
      output: {
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: rendered.context },
      },
      diagnostics,
    };
  }

  const documentation = safeDocumentation(root, evaluateDocumentation);
  const audience = { SubagentStart: "subagent", SubagentStop: "integration" }[eventName];
  const reminder = documentation
    ? renderDocumentationReminder(documentation, { audience, maxBytes: 400 })
    : "";
  const message = truncateUtf8(
    [renderContinuationDirective(eventName), reminder].filter(Boolean).join(" "),
    MAX_EVENT_MESSAGE_BYTES,
  );
  if (mode === "run")
    writeContextReceipt(root, {
      kind: "context_hook_event",
      recordedAt: new Date().toISOString(),
      event: eventName,
      trigger: input?.trigger ?? null,
      messageBytes: Buffer.byteLength(message, "utf8"),
    });
  return {
    output:
      eventName === "SubagentStart"
        ? { hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: message } }
        : { systemMessage: message },
    diagnostics,
  };
}

async function readHookInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_HOOK_INPUT_BYTES) throw new Error("Hook input exceeded the 64 KiB limit.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Hook input must be a JSON object.");
  return input;
}

async function main() {
  const mode = process.argv[2] || "run";
  if (!["run", "render"].includes(mode)) {
    process.stderr.write("Usage: context-hook.mjs [run|render]\n");
    process.stdout.write("{}\n");
    return;
  }
  let input = {};
  try {
    input = await readHookInput();
  } catch (error) {
    process.stderr.write(`context hook: ${cleanInline(error.message, 240)}\n`);
    process.stdout.write("{}\n");
    return;
  }
  try {
    const result = dispatchHook({ root: ROOT, input, mode });
    for (const diagnostic of result.diagnostics)
      process.stderr.write(`context hook: ${diagnostic}\n`);
    process.stdout.write(`${JSON.stringify(result.output)}\n`);
  } catch (error) {
    process.stderr.write(`context hook failed open: ${cleanInline(error.message, 240)}\n`);
    process.stdout.write("{}\n");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
