@AGENTS.md

# Claude specifics

Read `AGENTS.md` once, then the files under "Read first". Nothing else is
required reading unless one of them points you there.

- **Seats:** you are the Router. Subagents are `autonomous-support`,
  `autonomous-worker`, and `autonomous-explorer`. Three subagents maximum. Check
  `/tasks` after launch and stop a subagent if Claude Code substituted a model.
- **Current work:** the live milestone is the primary objective in
  `work/CHECKPOINT.md`, with its queue below it. Everything earlier is
  complete — do not redo, re-review, or resume it.
- **Lanes:** keep a product step moving and recorded in `work/CHECKPOINT.md`;
  delegate every change to a path listed in `autonomous.config.json` under
  `lanes.protectedPaths` to `autonomous-support` (a `PreToolUse` hook blocks them
  otherwise).
- **Owner messages:** answer first, in plain language, before any further tool
  call. See "Plain-language owner communication" in `AGENTS.md`; it binds every
  message the owner sees, including relayed subagent wording.
- Do not rediscover done items, discard existing changes, or ask the owner for
  routine steps the repository already automates.

## Commands

```bash
node scripts/work.mjs status        # the operational view of the queue
node scripts/work.mjs check         # queue, evidence, lane, privacy, docs checks
node scripts/work.mjs no-yield      # exit 1 means keep going
node scripts/documentation.mjs check
node scripts/verify.mjs --task AUTO-001 --check unit -- npm test
```
