# The autonomous kit

A small, reusable kit for running long coding work with AI agents (in Claude
Code, Codex, or Cursor) autonomously, without losing the thread.

Agents forget. Sessions get compacted, machines restart, a subagent finishes and
nobody remembers what it was for. The autonomous kit moves the things that
matter out of the conversation and into files the project can check: what the
current goal is, who owns what, what has actually been proven, and which
documents are still true. Everything here is plain Node with no runtime
dependencies.

Below, `<kit>` is the folder you cloned the agent kit into, by default
`~/.ai-instructions`; this package is `<kit>/autonomous/`.

## What you get

**A work queue you cannot fudge.** Tasks live in `work/items/` as JSON. A task
must be explicitly approved before it can be active, must carry acceptance
criteria, must name a reason when it is blocked, and cannot be marked done
without recorded evidence. `node scripts/work.mjs check` validates the whole
queue, including dependency cycles.

**The coordination files.** One agent, the coordinator (the rulebook calls it the
Router), plans and delegates, and it keeps three files under `work/`.
`work/CHECKPOINT.md` holds the primary objective (the task the work is proving
right now), the queue of next steps, and a dated log. `work/AGENT_CONTEXT.md`
holds the context every agent reads first, and `work/DECISIONS.md` the
corrections of the owner (the person the agents work for), in the owner's words.
A queue row for a task names only its id, because the task's file in
`work/items/` holds its status, owner, and files: each fact is written once.
`node scripts/work.mjs check` verifies that the objective names a real task, that
every approved task not yet done has a queue row, and that the part above the log
stays small, so the top of the checkpoint stays a dashboard instead of turning
into a diary.

**A lane guard.** Changing the rulebook, the validators, or the hooks is a
different job from building the product, and mixing them is how agents quietly
rewrite their own instructions mid-task. The guard blocks edits to a configured
list of protected paths unless the support agent covers them: it makes the edit
itself, or a task it owns, in progress or in review, lists the paths in its
`ownedPaths`. By default the list is the autonomous kit's own files: the
rulebook (`AGENTS.md`, `CLAUDE.md`), `autonomous.config.json`, the scripts,
hooks, and agent definitions it installs, and its Codex and Cursor wiring. The
project's own documents and scripts stay with the product lane; list any of them
(`docs/**`, say) under `lanes.protectedPaths` to guard them too. The guard runs
as a `PreToolUse` hook that refuses the edit before a byte is written, and as a
check (`node scripts/work.mjs check`) over the working tree and every commit not
yet pushed upstream. The check cannot see who edited, so it accepts the task's
`ownedPaths` or a support result record in `work/messages/` that names the paths.
There is a recorded, expiring override for emergencies. Step 2 of the install
below shows both formats.

**Documentation freshness.** Living documents carry a stamp on their first line
recording exactly which sources they were written against. Change a source and
the page is reported as review due. Nothing is rewritten automatically; you
update the prose and then restamp. The owner's dashboard,
`docs/project/status.html`, is stamped against the rulebooks and the README, the
architecture page's sources, and the accepted tasks, so day-to-day edits to the
checkpoint and to unfinished tasks never make it due.

**Receipts.** `node scripts/verify.mjs --task ABC-001 --check unit -- npm test`
runs a command, hashes the whole source tree before and after, and writes a
receipt that binds the result to that exact snapshot. A receipt whose source
moved during the run is not valid evidence.

**Compaction recovery.** Before compaction a hook checks that the checkpoint is
there and records a receipt; after compaction another hook re-injects the
objective, the queue, and the open tasks as real context, so the session does not
rely on a generated summary. Claude Code and Codex get this context from one
renderer.

**Autosave.** An optional `Stop` hook commits and fast-forward-pushes work in
progress on one configured branch, to the one origin named in `git.remotePath`.
It skips a save when a changed file's name looks like a secret (`.env`, `*.pem`,
`id_rsa`, or a name with a part such as `key`, `token`, `secret`, `credential`,
or `password`: `api-key.txt` counts, `keyboard.ts` does not), on a diverged
remote, on the wrong branch or identity, and on a rate limit. It never saves
`.claude/settings.local.json`. It reads names, not contents, so a secret pasted
into an ordinary file gets past this check. Its commit runs the project's own
Git hooks, so a pre-commit secret scanner, if the project has one, does read the
contents; when a hook refuses, autosave commits and pushes nothing and says so in
one line. It never amends, never forces, and never runs `git add -A`.
By default (`autosave.visibilityCheck` `"github"`) it pushes only to a repository
that GitHub confirms is private: before each save it asks the `gh` command, with
prompts turned off, as the account in `git.account` when one is set. Any other
answer, or none, skips that save with one line. For a remote off GitHub, set
`visibilityCheck` to `"none"`: autosave then skips that question, and you take
responsibility for the remote being private.

**Privacy and identity checks.** Every committable file is scanned for this
machine's username in a home-directory path (`C:\Users\<name>\`,
`/mnt/c/Users/<name>/`, `/Users/<name>/`, `/home/<name>/`), reported redacted.
The name counts only as such a path segment, so a user named `node` does not
fail every file that says "node", and another user's home path, such as a
Dockerfile's `WORKDIR /home/app/src`, is ordinary content. When
`git.commitEmail` is set, a commit is blocked unless it carries that address.

## Install it into a project

```bash
node <kit>/autonomous/bin/autonomous-install.mjs /path/to/your/project \
  --project-name "My Project" \
  --task-prefix MYP \
  --branch main
```

Two more flags are optional: `--commit-email you@example.com` turns on the
commit-identity check, and `--remote-path owner/repo` names the origin autosave
may push to (without it, autosave stays off). Run the installer without flags and
it asks for each value. Add `--dry-run` to see the plan first: it lists exactly
the files a real run writes.

What it does with files that already exist:

- Nothing existing is overwritten unless you pass `--force`, and then the
  previous copy of every file it replaces is saved under
  `.local/backups/install-<time>/`.
- An existing `AGENTS.md` or `CLAUDE.md` is left alone, with a note; the kit's
  version is written beside it as `AGENTS.autonomous.md` or
  `CLAUDE.autonomous.md` for you to merge in.
- A file left alone is the project's own, so the lane guard does not protect it
  as the kit's; add it back to `lanes.protectedPaths` once it holds the kit's
  version.
- The documentation map in `docs/project/status.html` gets a row for each
  document the project already has (what `.gitignore` leaves out does not
  count), saying only that it was there first; fill in the rest.
- An existing `.claude/settings.json` is never replaced, not even with
  `--force`: the kit's hooks are merged into it, everything else in it is kept,
  and the previous file is saved under `.local/backups/`.

The install names every protected file it writes in a support-lane record in
`work/messages/`, and pins each file's bytes there (SHA-256). So
`node scripts/work.mjs check` passes before the first commit and after it, and a
later edit to one of those files from the wrong lane fails the check again.

After it finishes:

1. If the installer wrote `AGENTS.autonomous.md` or `CLAUDE.autonomous.md`,
   merge it into your own file and delete it.
2. Have the support agent write the **Big picture** section of `AGENTS.md` so it
   describes your project, and record that change in a support result, a JSON
   file in `work/messages/` such as `work/messages/support-big-picture.json`:

   ```json
   {
     "type": "support_result",
     "agent": "autonomous-support",
     "summary": "Wrote the Big picture section of AGENTS.md.",
     "filesChanged": ["AGENTS.md"],
     "fileHashes": { "AGENTS.md": "<the file's SHA-256>" }
   }
   ```

   `fileHashes` pins each file's bytes, so the record covers a file only while
   it still has them;
   `node -p "require('crypto').createHash('sha256').update(require('fs').readFileSync('AGENTS.md')).digest('hex')"`
   prints the value. A record without a pin for a file covers it only until the
   record itself is pushed; a later edit needs a record of its own. For an
   emergency, `.local/runtime/lane-guard-override.json` lets any lane change
   protected paths until it expires (without `paths`, every protected path):

   ```json
   {
     "reason": "Fix the release script while the support agent is unavailable.",
     "recordedBy": "owner",
     "expiresAt": "2030-01-01T18:00:00Z",
     "paths": ["scripts/verify.mjs"]
   }
   ```

   It stays on this machine (`.local/` is ignored), and each use leaves a
   receipt under `.local/runtime/lane-guard/`.

3. Replace the placeholder objective in `work/CHECKPOINT.md` and the setup task
   in `work/items/`, and fill in `work/AGENT_CONTEXT.md`.
4. Run `node scripts/work.mjs check` and fix whatever it reports.
5. To use autosave, set `autosave.enabled` to `true` in `autonomous.config.json`
   once the branch and `git.remotePath` are right. It needs that remote, and,
   with the default visibility check, GitHub and the `gh` command.
6. Commit the kit, then start the first real task.

### Defaults you may want to change

The kit makes choices for its owner's way of working. Change any of them in the
installed files:

- **Four seats.** `AGENTS.md` allows at most four agents at once, the Router
  included.
- **Three subagents.** `.claude/settings.json` sets
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` to `3`, so Claude Code runs at most
  three subagents at once.
- **Nothing is deleted.** `AGENTS.md` says "Never delete files, discard changes,
  prune, reset, or remove worktrees."
- **Model substitution.** `CLAUDE.md` tells the Router to stop a subagent when
  Claude Code substituted a model.
- **Autosave** needs a remote and, with the default visibility check, GitHub and
  `gh`.
- **Project files.** The installer adds `work:*` and `docs:*` scripts to
  `package.json` (or writes one), and writes a CI workflow to
  `.github/workflows/ci.yml` that runs the kit's checks.

### One configuration file

Everything project-specific lives in `autonomous.config.json` at your project
root: the project name, the task-id prefix, the commit identity, the protected
paths (the kit's own files unless you add more), the support-agent name, which
documents carry a stamp and what sources they are stamped against, the autosave
settings (branch, allowlist, visibility check), the GitHub account autosave asks
as (`git.account`; empty means the active `gh` account), the size bounds of the
checkpoint, and the quiet hours. Anything you leave out falls back to a default,
so a short config is fine. `"autonomousVersion": 2` marks a project on version 2
of the kit; a project installed before the kit's rename has `"harnessVersion": 2`
instead, which reads the same, as do the stamp marker and lane-record type it
was installed with.

## How each tool picks it up

**Claude Code** reads `CLAUDE.md` (which includes `AGENTS.md`), the subagent
definitions in `.claude/agents/`, and the hook wiring in `.claude/settings.json`.
The hooks are the lane guard and the commit-identity guard on `PreToolUse`, a
checkpoint check on `PreCompact`, context re-injection on `SessionStart`, and
autosave on `Stop`. The agent files deliberately pin no model or permission
mode; add `model:`, `effort:`, or `permissionMode:` to their front matter if you
want those fixed.

**Codex** reads `AGENTS.md` and `.codex/hooks.json`, which runs
`scripts/context-hook.sh` through `bash` (so the file needs no executable bit),
or `scripts/context-hook.ps1` on Windows, both found from the repository root, at
session start, around compaction, and on subagent start and stop. The hook
returns a bounded block of recovery context and always fails open. This wiring is
**unverified against Codex itself**: the commands are tested to run from any
folder of the repository, but the `hooks.json` format and its `commandWindows`
field were not checked against Codex's documentation.

**Cursor** reads `AGENTS.md` and the always-on rule in
`.cursor/rules/agent-autonomous.mdc`. Cursor has no lifecycle hook, so run
`node scripts/context-hook.mjs render` yourself after a long gap.

## Day-to-day commands

```bash
node scripts/work.mjs status      # the operational view of the queue
node scripts/work.mjs check       # queue, evidence, lane, privacy, docs checks
node scripts/work.mjs no-yield    # exit 1 means there is still approved work
node scripts/work.mjs brief ID    # one task as JSON
node scripts/documentation.mjs check
node scripts/documentation.mjs stamp status
node scripts/verify.mjs --task ABC-001 --check unit -- npm test
```

## Update a project later

Update the kit with `git pull` in `<kit>`, then re-run the installer against the
project with `--force`. The installer refuses a project on version 1 of the
kit.

```bash
node <kit>/autonomous/bin/autonomous-install.mjs /path/to/your/project --force
```

An update keeps the project's settings. It takes its answers from the
project's `autonomous.config.json`, so it needs no other flags, and a flag you
pass still wins. The config is merged, not replaced: every setting in it stays,
and a key is added only when it is new and has no default, so a short config
stays short.

`--force` replaces a file only while it still has the bytes the last install
pinned for it in `work/messages/`, so it holds nothing but what the kit wrote
and needs no backup: that is how the kit's scripts, hooks, and agents reach the
new version. A file that changed since, or that no install wrote (a
`CHANGELOG.md` the project already had, say), stays as it is and is listed;
merge the kit's version into it by hand if you want it. `.claude/settings.json`,
`package.json`, and `.gitignore` are merged into as at install time. The work
state (`work/CHECKPOINT.md`, `work/AGENT_CONTEXT.md`, `work/DECISIONS.md`, the
setup task) and the living documents are neither rewritten nor restamped, so an
update adds no second setup task, and a page whose sources the update changed
shows as review due. Read the diff before committing.

**A project from before the rename.** The kit used to be called "harness", and a
project installed then has `harness.config.json`, `scripts/harness-config.mjs`,
`harness-*` agents, and `.cursor/rules/agent-harness.mdc`. It keeps working: the
scripts read the old config, and the lane guard treats each old file and agent
name as its new one. The installer, run on such a project, asks for `--force`;
with it, it renames those files to the new names (the config keeps its content,
with the file names inside it updated), says so, and then updates the kit's
files. Its install record pins no bytes, so there `--force` replaces the kit's
own scripts, hooks, and agents, saving each previous copy under
`.local/backups/`, and leaves the rest as it is. The support agent keeps the
name the project gave it.

## Uninstall

```bash
node <kit>/autonomous/bin/autonomous-uninstall.mjs /path/to/your/project --dry-run
node <kit>/autonomous/bin/autonomous-uninstall.mjs /path/to/your/project
```

It undoes what the install records in `work/messages/` say the installer wrote,
and nothing else. A file whose bytes still match the record is removed, or, where
`--force` had replaced a file of the project's own, that file's backup is put
back. A file changed since the install stays where it is, listed with a note.
`.claude/settings.json` gets its backed-up original back when it is unchanged,
and otherwise loses only the kit's hook entries and settings; `package.json`
loses only the scripts the install added, and `.gitignore` only the kit's block.
Folders left empty go too. `--dry-run` prints the plan and changes nothing.

## Testing the package

```bash
npm ci
npm test
npm run lint
npm run format:check
```

Outside a git checkout the tests that list the package's files are skipped.

Inside the package folder itself, `node scripts/work.mjs check` and
`node scripts/documentation.mjs check` say that they do not apply, and exit 0:
the package ships those scripts but has no work queue or living documents of
its own. Its Claude Code hooks do apply when you open the package folder in
Claude Code: with no config there, the lane guard protects its default list,
the kit's own files, so an edit to a script, hook, agent, or the rulebook needs
the support agent or an override, as in any project. Its `AGENTS.md` and
`CLAUDE.md` stay the rendered template on purpose, except the first paragraph
of the Big picture, which describes the package, and a test keeps them so.

## Notes and limits

- Node 22 or newer: `node` on the PATH, or a project-local copy unpacked under
  `.tools/node-<version>/` as the official archive ships it (`node.exe` at its top
  on Windows, `bin/node` elsewhere), which the hooks prefer when present. No
  runtime dependencies; the dev dependencies are only Vitest, ESLint, and
  Prettier.
- Any git host works. Only autosave's default visibility check needs GitHub.
- The guards assume a cooperative host. They catch the accidental lapse: editing
  the rulebook mid-task, committing with the wrong identity, pushing a file that
  looks like a secret. They are not an access-control system.
- Hooks are best-effort. Every one of them fails open with a visible note, and
  `node scripts/work.mjs check` is the deterministic backstop.
