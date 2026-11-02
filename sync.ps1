[CmdletBinding()]
param(
    [ValidateSet('Apply', 'Pull', 'Publish')]
    [string]$Mode = 'Apply',

    [string]$Message = 'Update global AI instructions'
)

$ErrorActionPreference = 'Stop'

# WSL can pass Linux PATHEXT/PATH values into Windows PowerShell. Restore
# executable discovery for this process without changing persistent user settings.
if ($env:OS -eq 'Windows_NT') {
    if ($env:PATHEXT -notmatch '(?i)(^|;)\.EXE(;|$)') {
        $env:PATHEXT = [Environment]::GetEnvironmentVariable('PATHEXT', 'Machine')
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
    }
}


$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$canonicalPath = Join-Path $repoRoot 'GLOBAL_INSTRUCTIONS.md'
$commandInstallerPath = Join-Path $repoRoot 'install-command.ps1'
# AIKIT_HOME points every tool folder at another home, so a test can run sync without touching the real one.
$userRoot = if ($env:AIKIT_HOME) { $env:AIKIT_HOME } else { [Environment]::GetFolderPath('UserProfile') }
$managedMarker = 'Managed by ai-global-instructions'
# Written into each mirrored skill folder, so a same-named folder the user made is backed up, not silently replaced.
$skillMarker = '.managed-by-ai-global-instructions'

function Invoke-RepoGit {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
    Get-Command git -ErrorAction Stop | Out-Null
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 otherwise treats normal Git progress on stderr
        # as a terminating error when the background runner captures output.
        $ErrorActionPreference = 'Continue'
        & git -C $repoRoot @GitArgs 2>&1 | ForEach-Object { $_.ToString() }
        $gitExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($gitExitCode -ne 0) {
        throw "git $($GitArgs -join ' ') failed with exit code $gitExitCode"
    }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    if ((Test-Path -LiteralPath $Path) -and [IO.File]::ReadAllText($Path) -ceq $Content) {
        return
    }
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Protect-AdapterFile {
    param([string]$Path, [string]$Content)
    if (-not (Test-Path -LiteralPath $Path)) { return }

    $existing = [IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($existing) -or $existing -ceq $Content) {
        return
    }

    $backupRoot = Join-Path $repoRoot 'backups'
    if (-not (Test-Path -LiteralPath $backupRoot)) {
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fffffff'
    $toolName = Split-Path -Leaf (Split-Path -Parent $Path)
    $leaf = Split-Path -Leaf $Path
    $backupPath = Join-Path $backupRoot "$stamp-$toolName-$leaf"
    Copy-Item -LiteralPath $Path -Destination $backupPath
    Write-Host "Backed up existing file to $backupPath"

    if (-not $existing.Contains($managedMarker)) {
        return "Existing unmanaged instructions were preserved at $Path (backup: $backupPath)."
    }
}

# A coordinating agent and each of its subagents run a session-start pull. They need
# not all reach the network: a pull in the last 10 minutes is fresh enough.
$pullStampDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'ai-global-instructions' } else { Join-Path $repoRoot '.state' }
$pullStamp = Join-Path $pullStampDir 'last-pull.txt'
if ($Mode -eq 'Pull' -and (Test-Path -LiteralPath $pullStamp)) {
    $pullAge = (Get-Date) - (Get-Item -LiteralPath $pullStamp).LastWriteTime
    if ($pullAge.TotalMinutes -lt 10) {
        Write-Host ('Instructions were pulled {0:N0} minute(s) ago; using the local copy.' -f $pullAge.TotalMinutes)
        return
    }
}

# Manual commands, session-start pulls, and the daily runner share this
# repository. Serialize their complete Git/apply transaction to protect FETCH_HEAD.
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try {
    $repoKey = [BitConverter]::ToString($hashAlgorithm.ComputeHash(
        [Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($repoRoot).ToLowerInvariant())
    )).Replace('-', '')
} finally {
    $hashAlgorithm.Dispose()
}
$syncMutex = [Threading.Mutex]::new($false, "Local\AI-Global-Instructions-Sync-$repoKey")
$syncAcquired = $false
try {
    try {
        $syncAcquired = $syncMutex.WaitOne([TimeSpan]::FromSeconds(30))
    } catch [Threading.AbandonedMutexException] {
        $syncAcquired = $true
    }
    if (-not $syncAcquired) {
        if ($Mode -eq 'Pull') {
            # Another agent is pulling right now; its result is as fresh as ours would be.
            Write-Host 'Another instruction sync is running; using the local copy.'
            return
        }
        throw 'Another instruction sync is still running. Retry after it finishes; no changes were made by this invocation.'
    }

    # A copy whose origin is the shared kit is never edited (README.md), so changes of its own mean it cannot take
    # updates safely: stop with a plain message instead of a raw git error. The owner's copy and a fork have another
    # origin, and edits there are normal until they are published. https://, ssh:// and git@ forms are the same.
    $sharedKitUrl = 'https://github.com/mdmotaharmahtab/agent-kit'
    function Get-RepoKey([string]$url) {
        $u = $url.Trim().ToLowerInvariant()
        return ($u -replace '^[a-z+]+://', '' -replace '^[^@/]+@', '' -replace '^([^/:]+):', '$1/' -replace '\.git$', '').TrimEnd('/')
    }
    $sharedCopy = $false
    if ($Mode -eq 'Pull') {
        $pauseErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $origin = (& git -C $repoRoot config --get remote.origin.url 2>$null) -join ''
        } finally {
            $ErrorActionPreference = $pauseErrorActionPreference
        }
        $sharedCopy = (Get-RepoKey $origin) -eq (Get-RepoKey $sharedKitUrl)
    }
    if ($sharedCopy) {
        $pauseErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $status = @(& git -C $repoRoot status --porcelain --untracked-files=no 2>$null)
            $statusExitCode = $LASTEXITCODE
            $ahead = 0
            & git -C $repoRoot rev-parse --verify --quiet '@{u}' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $ahead = [int]((& git -C $repoRoot rev-list --count '@{u}..HEAD' 2>$null) -join '') }
        } finally {
            $ErrorActionPreference = $pauseErrorActionPreference
        }
        if ($statusExitCode -ne 0) {
            throw "Could not read the state of $repoRoot (git status exit code $statusExitCode); nothing was pulled."
        }
        $changed = @($status | ForEach-Object { $_.Substring(3) })
        if ($changed.Count -gt 0 -or $ahead -gt 0) {
            $what = @()
            if ($changed.Count -gt 0) { $what += "edited files ($($changed -join ', '))" }
            if ($ahead -gt 0) { $what += "$ahead commit(s) that the shared kit does not have" }
            # A plain message and exit code 1, not a throw, so it prints once instead of inside an error record.
            Write-Host ("Updates are paused: this copy of the shared kit has changes of its own: $($what -join ' and '). " +
                "Your rules and skills stay as they are. To take updates again, undo them: " +
                "git -C `"$repoRoot`" checkout -- <file> for an edit, or git -C `"$repoRoot`" reset --hard '@{u}' " +
                "to drop local commits (this deletes them). To keep your changes and still get updates, move them to " +
                "your own fork (FORKING.md), or propose them to the kit (CONTRIBUTING.md); changes that only suit you " +
                "are not merged.")
            exit 1
        }
    }
    if ($Mode -eq 'Pull') {
        # Pulls run hidden (at login, daily, at session start): a password prompt nobody sees would hold the lock.
        # aisync-inst runs in a terminal you watch, so it may still ask you to sign in.
        $quiet = -not $env:AIKIT_INTERACTIVE
        $sshSet = $false
        if ($quiet) {
            $env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
            if (-not $env:GIT_SSH_COMMAND) { $env:GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'; $sshSet = $true }
        }
        try {
            Invoke-RepoGit pull --ff-only
        } finally {
            if ($quiet) { Remove-Item Env:GIT_TERMINAL_PROMPT, Env:GCM_INTERACTIVE -ErrorAction SilentlyContinue }
            if ($sshSet) { Remove-Item Env:GIT_SSH_COMMAND -ErrorAction SilentlyContinue }
        }
    }

    if (-not (Test-Path -LiteralPath $canonicalPath)) {
        throw "Canonical instructions not found: $canonicalPath"
    }

    # Keep the manual command installed and current on devices that already have
    # the login/daily runner. A pull updates this helper before it is invoked.
    & $commandInstallerPath

    if ($Mode -eq 'Publish') {
        & git -C $repoRoot diff --cached --quiet
        if ($LASTEXITCODE -eq 1) {
            throw 'Publish requires a clean Git index. Commit or unstage the existing staged changes first.'
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Could not inspect the Git index (exit code $LASTEXITCODE)."
        }

        # Use the exit code, not captured text: Git may print harmless line-ending
        # warnings even when there are no changes in a Windows/WSL checkout.
        $diffErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & git -C $repoRoot diff --quiet -- . ':(exclude)GLOBAL_INSTRUCTIONS.md' ':(exclude)GLOBAL_MAP.md' ':(exclude)skills' 2>&1 |
                ForEach-Object { Write-Host $_.ToString() }
            $unrelatedDiffExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $diffErrorActionPreference
        }
        if ($unrelatedDiffExitCode -eq 1) {
            throw 'Publish requires unrelated tracked edits to be committed first. No instruction commit was created.'
        }
        if ($unrelatedDiffExitCode -ne 0) {
            throw "Could not inspect unrelated tracked edits (exit code $unrelatedDiffExitCode)."
        }

        # Publish the canonical instructions, the map of where each rule appears and the
        # shared skills together, including new and deleted skill files, so other devices
        # never get a pointer to a skill that was not pushed, and map rows change in the
        # same commit as the rules they describe.
        # The map is optional: a copy of the kit without one publishes the rest (a deleted map is still staged).
        $publishPaths = @('GLOBAL_INSTRUCTIONS.md', 'GLOBAL_MAP.md', 'skills') |
            Where-Object { (Test-Path -LiteralPath (Join-Path $repoRoot $_)) -or (& git -C $repoRoot ls-files -- $_) }

        # Check before committing that origin accepts pushes from this account: a copy cloned from the public kit
        # still points there, and nobody but its owner can push to it. A trial push of a new branch name sends
        # nothing and does not depend on whether this copy is behind origin.
        $env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
        try {
            Invoke-RepoGit push --dry-run --quiet origin 'HEAD:refs/heads/aikit-push-check'
        } catch {
            throw "origin ($((& git -C $repoRoot remote get-url origin) -join '')) does not accept pushes from you, so nothing was committed. Point origin at your own fork (FORKING.md)."
        } finally {
            Remove-Item Env:GIT_TERMINAL_PROMPT, Env:GCM_INTERACTIVE -ErrorAction SilentlyContinue
        }
        Invoke-RepoGit add -A -- @publishPaths
        & git -C $repoRoot diff --cached --quiet
        $diffExitCode = $LASTEXITCODE
        if ($diffExitCode -eq 1) {
            # Publish owns the push, so the post-commit hook must not push early.
            Invoke-RepoGit -c core.hooksPath=/dev/null commit -m $Message
        } elseif ($diffExitCode -eq 0) {
            Write-Host 'No canonical instruction or skill changes to commit.'
        } else {
            throw "Could not inspect staged instruction changes (exit code $diffExitCode)."
        }

        # Read and apply the canonical file only after incorporating remote changes.
        # Git content conflicts stop here with both sides retained for review.
        # Hooks stay off here too: a rebase can rerun the post-commit hook, which would push early.
        Invoke-RepoGit -c core.hooksPath=/dev/null pull --rebase
    }

    $instructions = [IO.File]::ReadAllText($canonicalPath).TrimEnd() + [Environment]::NewLine
    $newline = [Environment]::NewLine

    $codexPath = Join-Path $userRoot '.codex\AGENTS.md'
    $claudePath = Join-Path $userRoot '.claude\CLAUDE.md'
    $cursorPath = Join-Path $userRoot '.cursor\rules\global-instructions.mdc'
    # Antigravity (IDE, VS Code and other editor extensions, 2.0 and CLI) reads a
    # standalone global rules file at ~/.gemini/GEMINI.md: plain Markdown, no
    # frontmatter, always active. See https://antigravity.google/docs/rules
    $antigravityPath = Join-Path $userRoot '.gemini\GEMINI.md'
    $antigravityRuleLimitBytes = 24000

    $codexContent = @(
        '<!-- Managed by ai-global-instructions. Generated from ~/.ai-instructions/GLOBAL_INSTRUCTIONS.md; do not edit this file. -->'
        ''
        $instructions.TrimEnd()
    ) -join $newline

    $claudeContent = @(
        '<!-- Managed by ai-global-instructions. Generated from ~/.ai-instructions/GLOBAL_INSTRUCTIONS.md; do not edit this file. -->'
        ''
        '@~/.ai-instructions/GLOBAL_INSTRUCTIONS.md'
    ) -join $newline

    $cursorContent = @(
        '---'
        'description: Shared global instructions for all projects'
        'globs: "**/*"'
        'alwaysApply: true'
        '---'
        '<!-- Managed by ai-global-instructions. Generated from ~/.ai-instructions/GLOBAL_INSTRUCTIONS.md; do not edit this file. -->'
        ''
        $instructions.TrimEnd()
    ) -join $newline

    $antigravityContent = @(
        '<!-- Managed by ai-global-instructions. Generated from ~/.ai-instructions/GLOBAL_INSTRUCTIONS.md; do not edit this file. -->'
        ''
        $instructions.TrimEnd()
    ) -join $newline

    # Antigravity silently truncates a rule file above 24,000 bytes.
    $antigravityBytes = [Text.UTF8Encoding]::new($false).GetByteCount($antigravityContent + $newline)
    if ($antigravityBytes -gt $antigravityRuleLimitBytes) {
        Write-Warning "Antigravity rules file is $antigravityBytes bytes; Antigravity truncates rule files above $antigravityRuleLimitBytes bytes."
    }

    # Preflight every destination before overwriting any adapter. Preserve previous
    # managed content too, so edits made directly in generated files remain recoverable.
    # Check all four before stopping, so a first run names every file to merge at once.
    $unmanaged = @(
        Protect-AdapterFile $codexPath ($codexContent + $newline)
        Protect-AdapterFile $claudePath ($claudeContent + $newline)
        Protect-AdapterFile $cursorPath ($cursorContent + $newline)
        Protect-AdapterFile $antigravityPath ($antigravityContent + $newline)
    ) | Where-Object { $_ }
    if ($unmanaged) {
        throw (($unmanaged -join ' ') + ' Keep what you need from them (in your own fork of the kit, see FORKING.md), then delete them and run setup.ps1 again.')
    }

    Write-Utf8NoBom $codexPath ($codexContent + $newline)
    Write-Utf8NoBom $claudePath ($claudeContent + $newline)
    Write-Utf8NoBom $cursorPath ($cursorContent + $newline)
    Write-Utf8NoBom $antigravityPath ($antigravityContent + $newline)

    Write-Host 'Applied global instructions to:'
    Write-Host "  Codex:      $codexPath"
    Write-Host "  Claude Code: $claudePath"
    Write-Host "  Cursor:     $cursorPath"
    Write-Host "  Antigravity: $antigravityPath"

    # Shared skills: every folder under skills/ containing a SKILL.md is mirrored
    # into each tool's user-level skills directory so the tools discover it natively.
    # The canonical copy stays in this repository; generated copies are overwritten.
    $skillsRoot = Join-Path $repoRoot 'skills'
    if (Test-Path -LiteralPath $skillsRoot) {
        $skillTargets = @(
            (Join-Path $userRoot '.claude\skills'),
            (Join-Path $userRoot '.codex\skills'),
            (Join-Path $userRoot '.cursor\skills'),
            # Antigravity IDE and extensions: https://antigravity.google/docs/skills
            (Join-Path $userRoot '.gemini\config\skills')
        )
        $skillDirs = Get-ChildItem -LiteralPath $skillsRoot -Directory |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') }
        foreach ($skill in $skillDirs) {
            foreach ($target in $skillTargets) {
                $dest = Join-Path $target $skill.Name
                $destMarker = Join-Path $dest $skillMarker
                # The marker lists the hash of every file the last sync wrote. A same-named folder without a marker,
                # or a marked one whose files someone edited or added, holds work of its own: keep a copy first.
                $userWork = $false
                if (-not (Test-Path -LiteralPath $dest)) {
                    New-Item -ItemType Directory -Path $dest -Force | Out-Null
                } elseif (-not (Test-Path -LiteralPath $destMarker)) {
                    $userWork = $true
                } else {
                    $written = @{}
                    foreach ($line in [IO.File]::ReadAllLines($destMarker)) {
                        if ($line -match '^([0-9a-f]{64}) (.+)$') { $written[$Matches[2]] = $Matches[1] }
                    }
                    if ($written.Count) {
                        $userWork = @(Get-ChildItem -LiteralPath $dest -Recurse -File | Where-Object {
                            $relative = $_.FullName.Substring($dest.Length).TrimStart('\', '/')
                            $relative -ne $skillMarker -and
                                $written[$relative] -ne (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                        }).Count -gt 0
                    }
                }
                if ($userWork) {
                    $backupRoot = Join-Path $repoRoot 'backups'
                    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fffffff'
                    $toolName = Split-Path -Leaf (Split-Path -Parent $target)
                    $backupPath = Join-Path $backupRoot "$stamp-$toolName-skill-$($skill.Name)"
                    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
                    Copy-Item -LiteralPath $dest -Destination $backupPath -Recurse
                    Write-Host "Backed up skill folder $dest, which had files of its own, to $backupPath"
                }
                $sourceFiles = Get-ChildItem -LiteralPath $skill.FullName -Recurse -File
                foreach ($file in $sourceFiles) {
                    $relative = $file.FullName.Substring($skill.FullName.Length).TrimStart('\', '/')
                    $destFile = Join-Path $dest $relative
                    $destDir = Split-Path -Parent $destFile
                    if (-not (Test-Path -LiteralPath $destDir)) {
                        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                    }
                    $needsCopy = -not (Test-Path -LiteralPath $destFile)
                    if (-not $needsCopy) {
                        $needsCopy = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName)) -cne
                            [Convert]::ToBase64String([IO.File]::ReadAllBytes($destFile))
                    }
                    if ($needsCopy) { [IO.File]::WriteAllBytes($destFile, [IO.File]::ReadAllBytes($file.FullName)) }
                }
                # Remove generated files that no longer exist in the canonical skill.
                Get-ChildItem -LiteralPath $dest -Recurse -File | ForEach-Object {
                    $relative = $_.FullName.Substring($dest.Length).TrimStart('\', '/')
                    if ($relative -ne $skillMarker -and -not (Test-Path -LiteralPath (Join-Path $skill.FullName $relative))) {
                        Remove-Item -LiteralPath $_.FullName -Force
                    }
                }
                $hashes = $sourceFiles | ForEach-Object {
                    "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) " +
                        $_.FullName.Substring($skill.FullName.Length).TrimStart('\', '/')
                }
                [IO.File]::WriteAllLines($destMarker, @("$managedMarker. Generated from ~/.ai-instructions/skills; do not edit this folder.") + $hashes)
            }
        }
        if ($skillDirs.Count -gt 0) {
            Write-Host "Applied $($skillDirs.Count) shared skill(s) to ~/.claude/skills, ~/.codex/skills, ~/.cursor/skills, ~/.gemini/config/skills"
        }
    }

    # Claude Code hooks (hooks/): registered in ~/.claude/settings.json with the node found here, so a rule that
    # must hold at a specific moment (the Stop hook: no idle stop while background work runs) is enforced by the
    # tool, not by memory. The installer only adds or updates the kit's own entries.
    $hookInstaller = Join-Path $repoRoot 'hooks\install-claude-hooks.mjs'
    if (Test-Path -LiteralPath $hookInstaller) {
        $nodeExe = $null
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        if ($nodeCmd) { $nodeExe = $nodeCmd.Source }
        elseif (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')) {
            $nodeExe = Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'
        }
        if ($nodeExe) {
            # Its messages on stderr must reach the log as warnings, not stop a background pull.
            $hookErrorActionPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                & $nodeExe $hookInstaller 2>&1 | ForEach-Object { $_.ToString() }
                $hookExitCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $hookErrorActionPreference
            }
            if ($hookExitCode -ne 0) { Write-Warning 'Claude Code hooks were not registered (installer failed).' }
        } else {
            Write-Warning 'Node.js not found: Claude Code hooks were not registered. Install Node.js and run sync.ps1 again.'
        }
    }

    if ($Mode -eq 'Publish') {
        Invoke-RepoGit push
    }
    if ($Mode -eq 'Pull' -or $Mode -eq 'Publish') {
        New-Item -ItemType Directory -Path $pullStampDir -Force | Out-Null
        Set-Content -LiteralPath $pullStamp -Value (Get-Date -Format o) -Encoding ascii
    }
    # Done: a native command that failed on the way (a hook installer warning) must not make the run look stopped.
    $global:LASTEXITCODE = 0
} finally {
    if ($syncAcquired) { $syncMutex.ReleaseMutex() }
    $syncMutex.Dispose()
}
