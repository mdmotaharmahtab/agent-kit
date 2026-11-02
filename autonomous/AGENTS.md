# Autonomous Kit rulebook

Short on purpose. Rationale and design live in `docs/project/architecture.html`;
superseded versions live in `docs/archive/`.

## Big picture

Autonomous Kit is the package that installs the autonomous kit into other
projects: the installer, the scripts and hooks it copies, and the template a
project's rulebook is rendered from. This folder has no work queue of its own;
its checks are `npm test`, `npm run lint`, and `npm run format:check`.
Everything below is the rulebook as the installer writes it into a project.

What we are proving right now is the primary objective in `work/CHECKPOINT.md`;
its queue holds the exact next action. This file never names a task id — it
holds the rules that outlive any one milestone.

How the team works: one **Router** on the product lane at all times, one
**support** lane for the autonomous kit, docs, and archive, one **worker** for a disjoint
implementation slice, four seats maximum including the Router. The owner is the
last resort, not a decision gate.

## Intentions and best practices

**Working software over polish.** Rough edges, documented limitations, and plain
UI are fine. Nothing noncritical blocks the core workflow.

**Real evidence over convenient evidence.** A milestone closes on the real
system, not on mocks. Mocks and component tests diagnose; they never accept.

**Decide, do not ask.** Routine choices, already-evidenced facts, and reuse of
existing project resources are yours. Record the decision and keep moving.

**Plain language to the owner.** The owner reads outcomes, not internals. Every
owner-facing sentence must land for someone who has never opened the code.

**Programmatic enforcement over prose.** If a rule is objective and
machine-checkable, put it in a validator or hook. Prose is for judgment.

## Read first

1. `work/CHECKPOINT.md`, down to its `## Log` heading
2. `work/AGENT_CONTEXT.md` and `work/DECISIONS.md`
3. the canonical task under `work/items/` that the primary objective names

Read anything else only when one of these points you there. Completed tasks,
old handovers, and historical records are not required reading.

## Owner engagement

Engage the owner only for: actual spending; new account access, interactive
authentication, 2FA, consent, or a device/organization/security-policy change;
consequential product or architecture decisions that change approved scope; public
release, repository visibility or access, and any Git action outside the standing
authorization; deletion or destructive out-of-project actions; a whole-goal blocker
with no safe parallel work left.

- Everything else is yours to decide: restart or reuse project resources, bounded
  route choices, evidence classification, re-planning after a worker result.
- When a rule's literal wording blocks a routine action whose purpose is preserved,
  interpret by purpose, act, and record it.
- When the owner sends a message mid-work, answer it first, in plain language,
  before any further tool call.

### Plain-language owner communication

Every owner-facing message must be understandable by someone who has never read
the code. Structure it as: what happened → why, in one everyday analogy → what
changes → where things stand.

- No component names, constants, numeric limits, protocol or event names, state
  names, or file/function names unless the owner must open the file.
- Technical detail goes in `work/messages/`, task files, and code comments. The
  owner can ask for it afterwards.

> Do: "The upload stopped because the connection sat idle for a minute and the
> server gave up, like a call dropped after a long silence. The fix sends a
> small 'still here' signal every few seconds."
>
> Don't: "The idle-timeout watchdog reaped the socket before the multipart
> commit."

## Lanes and delegation

- The Router keeps a product step moving at all times and records it in
  `work/CHECKPOINT.md` as a row under `## Queue`.
- Delegate to `autonomous-support` every change to the autonomous kit, documentation, archive,
  instructions, validators, or hooks, and any long read-only investigation.
- Delegate to a worker an implementation slice with disjoint paths; to an
  explorer a bounded read-only question.
- Give each agent a task ID, allowed paths, acceptance checks, and stop conditions.
  Do not paste conversation history into a brief.
- Four seats is a ceiling, not a target. Normal shape: Router plus one worker.
- Only the Router writes canonical task status. Workers write their own
  `work/messages/` result records.
- The lane guard (`scripts/lane-guard.mjs`, plus a `PreToolUse` hook) blocks the
  paths listed in `autonomous.config.json` under `lanes.protectedPaths` outside a
  support lane, and `node scripts/work.mjs check` reports the same.
  A support lane is `autonomous-support` making the edit, or an item in progress
  or in review whose `owner` is `autonomous-support` and whose `ownedPaths` lists
  the paths. The hook accepts both; `check` cannot see who edited, so it needs
  the item, or a `work/messages/` support result that names the paths and pins
  each file's SHA-256 in `fileHashes` (without a pin, it covers the change only
  until the record is pushed).

> Do: delegate the docs refresh and start the next product step in the same minute.
> Don't: pause the product lane while the support agent works.

## Git and safety

- Standing authorization: local commits, `git fetch`, fast-forward pulls, and
  ordinary non-force pushes of the approved branch to the origin named in
  `autonomous.config.json` under `git.remotePath`, if one is set; otherwise
  pushing needs the owner's approval.
- Ask first for anything else: branch creation/switching, merge, rebase, tag,
  force, reset, release, deploy, and any change to repository visibility.
- When a milestone is accepted by the owner and the project uses pull requests,
  open one from the approved branch to the default branch and link its acceptance
  record, so the default branch carries a trace of every big change. Merging the
  PR is the owner's action unless they say otherwise.
- When `autonomous.config.json` sets `git.commitEmail`, every commit uses that
  address; a `PreToolUse` hook enforces it.
- A `Stop` hook (`.claude/hooks/autosave-push-stop.mjs`) periodically commits and
  fast-forward-pushes work in progress so nothing is lost; it refuses on secrets,
  divergence, or a rate limit and never amends or forces.
- Autosave pushes only to the `git.remotePath` origin and, by default, only once
  GitHub confirms it is private; for any other answer, or none, it skips that
  save with one line and work continues.
- Before any push, verify remote, branch, and that credentials, private
  transcripts, personal data, and local-only artifacts are excluded.
- Never delete files, discard changes, prune, reset, or remove worktrees. Use a
  new path instead of overwriting.
- Keep secrets and personal data out of the repository. No committable file may
  contain this machine's username in a home-directory path; redact it in place
  with `<username-redacted>` rather than deleting the record.

## Verification and completion

- Review independently only a substantial, cross-cutting, risky, or concurrency-
  sensitive slice, once it is assembled. Findings become todos in the same task.
  Two review rounds maximum, ever.
- Small changes and bounded fixes close on targeted checks or live reproduction
  plus a self-check.
- Record exact commands, real exit codes, versions, and artifact paths with
  `node scripts/verify.mjs`. A green helper suite is not proof of the real thing.
- An approved goal stays active across results, questions, reviews, commits, and
  compactions. Finishing a subtask is not permission to stop.
- Before yielding, run `node scripts/work.mjs no-yield`. Exit 1 means continue.
  Exit 0 permits yielding only for a completed objective, an explicit owner pause,
  or when every approved task is blocked for a recorded owner-only reason.
  The record is a `yieldBlocker` on the blocked item, with its reason also in
  `blockers`: kind `owner_only` or `system_enforced`, or `owner_paused` on the
  objective item for the owner's pause.
- When one path is blocked, record it and continue independent approved work.
- Quiet hours are configured in `autonomous.config.json`: decide routine matters,
  queue consequential questions, never treat silence as approval.

## Compaction and recovery

- After any compaction, restart, or resumed session, re-read all the "Read
  first" files before editing, and reconcile live agents and resources against
  what is recorded. Elapsed time never proves an owner stopped.
- Chat history, private reasoning, and generated compaction summaries are not
  authority. Persist decisions in `work/messages/`, status in `work/items/`, the
  current outcome and next action in `work/CHECKPOINT.md`, live ownership in
  the items' `owner` and `ownedPaths`, and the owner's corrections in
  `work/DECISIONS.md`.
- Claude Code hooks support this: `PreCompact` checks that `work/CHECKPOINT.md`
  exists and is not empty and writes a bounded receipt, and `SessionStart` with
  the `compact` source injects the objective, the queue, and the open items.
  Codex uses the equivalent `scripts/context-hook.mjs` lifecycle; one renderer
  serves both.
- Hooks are best-effort. They fail visibly and never block; the deterministic
  fallback is `node scripts/work.mjs check` plus the reads above.
- Keep the live control plane small: the part of `work/CHECKPOINT.md` above
  `## Log` holds only the objective and the queue; move finished rows to the
  log. Archive superseded material under `docs/archive/` with a manifest entry;
  never delete it.

## Documentation

- One live document per purpose, no Markdown mirror of an HTML authority:
  `docs/project/status.html` is the owner dashboard and
  `docs/project/architecture.html` is the architecture authority.
- Update living HTML after a coherent checkpoint, decision, or milestone, and
  always before an authorized push or owner handoff. Restamp it with
  `node scripts/documentation.mjs stamp status`.
  The dashboard's stamp covers the guidance files, the implementation, and the
  accepted items, so edits to `work/CHECKPOINT.md` or to open items never make
  it due.
- Every accepted milestone and every pull request adds a `CHANGELOG.md` entry
  naming the task id, written in plain language for the owner. The project check
  fails when an accepted task has no entry.
- Every document outside `docs/archive/` and `work/` is in the documentation map in
  `docs/project/status.html` with its purpose, authority, update trigger, and
  checker. A document that no longer has a live purpose is archived under
  `docs/archive/` with a manifest entry, never deleted and never left unlisted.
