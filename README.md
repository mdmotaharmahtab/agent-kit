# Agent kit

A set of rules and skills for AI coding agents (Codex, Claude Code, Cursor and Antigravity). The rules make an agent
plan before it changes things, say what it thinks of your ideas, explain plainly, and keep working while its helper
agents run. Setup installs them into all four tools with two commands, and the kit then keeps itself up to date.

## What setup changes on your computer

Read this before you run anything. Setup, on Windows 10 or 11:
- writes one global rules file for each tool (table under [What you get](#what-you-get));
- copies three skills into each tool's skills folder; a folder of yours with the same name is backed up first;
- registers a Claude Code hook in `~/.claude/settings.json`, if [Node.js](https://nodejs.org/) 22 or later is
  installed (only the kit's own entry changes, and a backup of the file is kept beside it);
- adds `~/.local/bin` to your user PATH, for the `aisync-inst` command;
- registers a hidden background task, "AI Global Instructions Sync", that pulls updates at login and once a day.
  It runs PowerShell with `-ExecutionPolicy Bypass`. Where scheduled tasks are blocked, it uses a file in your
  Startup folder instead.

Every rules file and skill folder it replaces is backed up into `~/.ai-instructions/backups/` first. [Uninstall](#uninstall) undoes all of
it.

## What you are trusting

The background task pulls each new release and runs its scripts on your computer: at login, once a day, and when an
agent session starts. So you trust this repository the way you trust any program that updates itself. Releases
come from one maintainer, about once a week, as one commit each; read them on GitHub, or on your computer with
`git -C "$env:USERPROFILE\.ai-instructions" log -p -1`.

To read every change before it runs, use your own fork ([FORKING.md](FORKING.md)): your copy then pulls only from
your fork, and you take in a release when you choose. On a work computer, ask your IT team first: a hidden
PowerShell task that bypasses the execution policy is something security tools watch for.

To report a security problem, see [SECURITY.md](SECURITY.md).

## Set up

With [Git](https://git-scm.com/) installed, run these two commands in PowerShell:

```powershell
git clone https://github.com/mdmotaharmahtab/agent-kit.git "$env:USERPROFILE\.ai-instructions"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.ai-instructions\setup.ps1"
```

Then start a new session in each tool to load the rules.

If a tool already has global rules of its own, setup never overwrites them. It backs each one up into
`~/.ai-instructions/backups/`, lists them all, and stops before the background task is set up. Merge what you want
to keep into your own fork (see [Want to change something?](#want-to-change-something)), or delete them, then run
`setup.ps1` again.

The daily pull runs at 10:00 in your time zone. For another time, add `-At '08:30'` to the setup command, and add
it again whenever you run setup again: without it, setup goes back to 10:00. To change the time later, run setup
with the new `-At`, then sign out and back in: the task already running keeps the old time until then.

On WSL, macOS or Linux, see [OTHER-PLATFORMS.md](OTHER-PLATFORMS.md).

## What you get

| Part | What it is for |
|---|---|
| The rules (`GLOBAL_INSTRUCTIONS.md`) | How the agent works with you: plan before acting, say its own opinion, keep working while helper agents run, explain plainly, review without bloating the work. |
| `explain` skill | Explanations a reader understands on the first read, from a chat answer to a long document. |
| `create-course` skill | Self-paced courses and study guides with quizzes and exams, as offline HTML. |
| `autonomous` skill and package | For long projects that several agents or sessions work on: a checked work queue, state that survives sessions, and lanes that decide who may edit which files. See [autonomous/README.md](autonomous/README.md). |
| Claude Code Stop hook | When a session tries to end its turn while its background agents or shells still run, the hook stops it once and lists other work it could do meanwhile. A dev server left running counts too, so each turn then costs one extra pass. To turn it off, set the user environment variable `AGENT_KIT_STOP_HOOK` to `0`. |

The rules ask agents to use the strongest available model for reviews and for writing, which costs more than the
default model. Change that, like any rule, in your own fork.

Where setup puts them (`~` is your user folder):

| Tool | Rules file | Skills folder |
|---|---|---|
| Codex | `~/.codex/AGENTS.md` | `~/.codex/skills/` |
| Claude Code | `~/.claude/CLAUDE.md` (imports the rules file) | `~/.claude/skills/` |
| Cursor | `~/.cursor/rules/global-instructions.mdc` | `~/.cursor/skills/` |
| Antigravity | `~/.gemini/GEMINI.md` | `~/.gemini/config/skills/` |

Some Cursor versions list the global rules file under Settings > Rules but do not give it to the agent. If yours
does not follow the rules, add a User Rule in Cursor's settings: "At the start of each session, read
`~/.ai-instructions/GLOBAL_INSTRUCTIONS.md` and follow it."

## Updates

The kit gets a new release about once a week, and your copy picks it up by itself:
- at login and once a day, from the background task;
- when an agent session starts: the rules tell the agent to pull first;
- when you run `aisync-inst` in a new terminal (within 10 minutes of the last pull it keeps the local copy).

The background task writes what it did to `~/.ai-instructions/autosync.log`.

Do not edit the files in `~/.ai-instructions`, or the rules files and skill folders setup writes: each pull
rewrites the tools' copies (keeping a backup of anything you changed), and a change in `~/.ai-instructions` pauses
updates. The next pull then stops and says why, until you undo the change or move it to your own fork.

## Want to change something?

- **Your own rules or skills, and still get updates:** use your own fork. [FORKING.md](FORKING.md) shows how to make
  one and point your copy at it.
- **Improve the kit for everyone:** open a pull request. [CONTRIBUTING.md](CONTRIBUTING.md) shows how. Changes that
  only suit you are not merged; keep those in your fork.

## Uninstall

Do the steps in order: while the background task runs, it puts back whatever you remove.

1. Stop the background task and its running copy:
   ```powershell
   Unregister-ScheduledTask -TaskName 'AI Global Instructions Sync' -Confirm:$false
   Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -like '*daily-sync-runner*' | ForEach-Object { Stop-Process -Id $_.ProcessId }
   ```
   If scheduled tasks were blocked, delete `AI-Global-Instructions-Sync.cmd` from your Startup folder instead
   (`shell:startup` in the Run box).
2. Remove the Claude Code hook (it keeps a backup of `settings.json`):
   `node "$env:USERPROFILE\.ai-instructions\hooks\install-claude-hooks.mjs" --uninstall`
3. Delete the four rules files in the table above, and `explain`, `create-course` and `autonomous` from each tool's
   skills folder.
4. Copy back what you want from `~/.ai-instructions/backups/`: your rules files and skill folders from before the
   kit are there.
5. Delete `~/.local/bin/aisync-inst.cmd` (and remove `~/.local/bin` from your user PATH if nothing else uses it),
   `%LOCALAPPDATA%\ai-global-instructions`, and finally `~/.ai-instructions`.

## Troubleshooting

- **"running scripts is disabled" although the command says `-ExecutionPolicy Bypass`:** your organization sets
  the policy centrally, and it wins. Ask your IT team.
- **No Claude Code hook:** setup says "Node.js not found". Install Node.js 22 or later, then run `setup.ps1` again.
- **Updates stopped:** `autosync.log` says why; the most common reason is an edited file (see [Updates](#updates)).

## License

MIT; see [LICENSE](LICENSE).
