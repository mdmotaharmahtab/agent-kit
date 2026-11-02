---
name: autonomous
description: Run a long project autonomously with the autonomous kit, so several agents or sessions can work on it without losing state or asking the owner again and again. Use when starting or running a coding or content project that many subagents or sessions will work on over days; when the user asks for a work queue, durable state that survives compaction and restarts, a lane guard that keeps agents from rewriting their own rules, task records with approval and evidence, or "subagents that behave like the main agent"; when installing, updating, uninstalling, or upgrading the autonomous kit (formerly "harness") in a project; and before delegating a large batch of work to subagents. Not for one-off edits or short single-session tasks.
---

# The autonomous kit: long autonomous work with durable state and guarded lanes

Agents forget: sessions compact, machines restart, a subagent finishes and nobody remembers why it ran. The core idea
is one sentence: **move what matters out of the conversation into files the project can check.** The kit adds one
more promise on top: **it runs autonomously and does not prompt the owner again and again.** Its rulebook
(`AGENTS.md`) decides routine matters itself and engages the owner only for the short list it names. That is
deliberate: those lines override any general "plan first and wait for approval" rule, so never "fix" them back
toward one.

`<kit>` below is the folder the agent kit was cloned into, by default `~/.ai-instructions`. The general rules this
page names ("Working with subagents" and the others) are in `<kit>/GLOBAL_INSTRUCTIONS.md`; each is summarised here in
one clause, so this page works without them.

## 1. The package (when the project is code)

The installable package is `<kit>/autonomous/`. It is plain Node 22 or later, with no runtime dependencies.

```
node <kit>/autonomous/bin/autonomous-install.mjs <project folder> --project-name "<name>" --task-prefix ABC --branch main
```

The command is one line, so it runs the same in Bash and PowerShell. Add `--dry-run` first. Two flags are optional:
`--commit-email you@example.com` (the only address commits may carry) and `--remote-path owner/repo` (the origin
autosave may push to). It installs: task records in `work/items/` (a task cannot be active without approval, cannot be
done without evidence), the three coordination files under `work/`, and a lane guard. The **support lane** is the one
agent role allowed to change the files the kit installs (its rulebook, config, scripts and hooks; a project may
protect more paths). The guard blocks those edits from every other lane, leaving a receipt of each refusal in
`.local/runtime/lane-guard/`, and `node scripts/work.mjs check` accepts a change to them from a support task, a
support result the support agent writes in `work/messages/`, or a recorded, expiring override. It also installs
documentation freshness stamps, verification receipts, compaction recovery, privacy and commit-identity checks, and
optional autosave, which needs a remote and, with its default visibility check, GitHub and the `gh` command. A
project's own `AGENTS.md` or `CLAUDE.md` is left alone, with the kit's version written beside it to merge.
`<kit>/autonomous/README.md` says what each part is for, and how to update or uninstall the kit. Then have the support
agent write the "Big picture" of `AGENTS.md`, fill in `work/AGENT_CONTEXT.md`, and run `node scripts/work.mjs check`.

**A content project** (documents, a course) needs no package: keep the three files of section 2's "Plain project"
column: the queue, the context file and the decisions log.

## 2. The coordination files

The rule "three living coordination files, no more" (one state file, one context file, one decisions log, so
nothing important lives only in a conversation) holds in a project with the kit too, under `work/`:

| Global role | Plain project | Project with the kit |
|---|---|---|
| State: the queue on top, the dated log below | `CHECKPOINT.md` | `work/CHECKPOINT.md`, plus one `work/items/<ID>.json` per code task (the queue row names only the id; the item holds status, owner, files and evidence) |
| Context every agent reads first | `AGENT_CONTEXT.md` | `work/AGENT_CONTEXT.md` for lessons and examples; standing rules live in `AGENTS.md` (protected: edit through the support lane) |
| The user's corrections in their own words, append only | `DECISIONS.md` | `work/DECISIONS.md` |

`AGENTS.md` and `AGENT_CONTEXT.md` stay separate on purpose: standing rules change rarely and are guarded; lessons
change during the work. While subagents run, keep working on queue rows that do not depend on them (the "Stay
productive while subagents work" rule). In Claude Code, the agent kit's own Stop hook, set up with the global rules,
shows that menu before a stop; the autonomous package's Stop hook only autosaves.

## 3. Delegating

Give every subagent the context it lacks, check the first unit of each kind of work in depth, then spot-check (the
"Working with subagents" rule). In a project with the kit the context pack is `work/AGENT_CONTEXT.md` and
`work/DECISIONS.md`. Three additions:

- **Hand-backs:** a subagent edits only its own files and flags the rest; the coordinator applies flags to shared
  files as each unit lands, and keeps a per-unit list of them in the queue. *Because* two agents editing one file
  overwrite each other's work.
- **Parallel safety:** each subagent writes scratch files in its own scratchpad subfolder; shared engine or rule files
  are edited by the coordinator only, on a copy, checked, then replaced. *Because* a half-edited shared file breaks
  every other agent's run.
- **Nested helpers:** in Claude Code, an agent that a subagent starts reports to the coordinator, not to that
  subagent, so relay its result or have the subagent do the work itself.

## 4. Quality loops

- Triage every review finding (fix in place, move to optional depth, or decline with a reason) and integrate fixes
  where they are first needed, so the work does not grow by additions (the "Reviews must not bloat the work" rule).
- Turn every repeated finding into a tool check (a lint, a scanner pattern, a test), so the next round cannot repeat it.
  The kit's own example: `<kit>/autonomous/tests/autonomy-lines.test.js` keeps every autonomy sentence of the rulebook
  word for word.
- Write patch scripts into the project (`tools/patches/`), re-runnable, so every edit is reproducible and traceable.
  A patch script reports every anchor it did not find, instead of skipping it silently, and deletes with a plain
  replace (a helper that treats "already applied" as success never deletes anything).

---

*This skill was made with the help of Claude.*
