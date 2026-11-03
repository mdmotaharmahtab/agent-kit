# WSL, macOS and Linux

`setup.ps1` and the automatic sync are Windows-only for now. The rules and skills themselves work anywhere.

## WSL

**Untested.** These commands have not been run on a real WSL install yet.

Set the kit up on Windows first (README), then use that one copy from WSL too. Link WSL's `~/.ai-instructions` to
the Windows folder, and link these WSL files and folders to their Windows counterparts, after backing up anything
WSL already has there: `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.codex/skills`, `~/.claude/skills` and, for
the Cursor CLI, `~/.cursor/rules/global-instructions.mdc`. The Windows sync then keeps both sides current. The Claude
Code hook is registered for Windows only, because its command names the Windows Node.

```bash
win="$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")"
mkdir -p ~/.codex ~/.claude ~/.cursor/rules
ln -sT "$win/.ai-instructions" ~/.ai-instructions
for f in .codex/AGENTS.md .claude/CLAUDE.md .codex/skills .claude/skills .cursor/rules/global-instructions.mdc; do
  ln -sT "$win/$f" ~/"$f"
done
```

`ln -sT` refuses to replace a file or folder that is already there, so move those aside first. Leave out the
Cursor line if you do not use the Cursor CLI.

To pull from a WSL shell:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w ~/.ai-instructions/sync.ps1)" -Mode Pull
```

## macOS and Linux

**Untested.** These commands, the Claude Code hook and the autonomous package have not been run on macOS or Linux
yet.

Install by hand. These commands overwrite `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md` and `~/.gemini/GEMINI.md`,
so back those up first if they hold anything.

```bash
git clone https://github.com/mdmotaharmahtab/agent-kit.git ~/.ai-instructions
cd ~/.ai-instructions
for d in ~/.claude/skills ~/.codex/skills ~/.cursor/skills ~/.gemini/config/skills; do
  mkdir -p "$d" && cp -R skills/* "$d"/
done
mkdir -p ~/.codex ~/.claude ~/.gemini
cp GLOBAL_INSTRUCTIONS.md ~/.codex/AGENTS.md
cp GLOBAL_INSTRUCTIONS.md ~/.gemini/GEMINI.md
printf '@~/.ai-instructions/GLOBAL_INSTRUCTIONS.md\n' > ~/.claude/CLAUDE.md
node hooks/install-claude-hooks.mjs
```

For Cursor, add the rules under Settings > Rules.

To update, run `git -C ~/.ai-instructions pull --ff-only`, then repeat the copy commands. The rules' session-start
pull is for Windows; agents on these systems skip it.
