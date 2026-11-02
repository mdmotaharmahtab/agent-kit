[CmdletBinding()]
param(
    # Passed to the runner: the daily pull time (24-hour HH:mm) and a Windows time-zone id, or 'Local'.
    [string]$At = '10:00',
    [string]$TimeZone = 'Local',
    # Also push every commit to origin. Only for a copy whose origin is your own repository (FORKING.md).
    [switch]$PushCommits
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
$runnerPath = Join-Path $repoRoot 'daily-sync-runner.ps1'
$commandInstallerPath = Join-Path $repoRoot 'install-command.ps1'
$taskName = 'AI Global Instructions Sync'

# Fail now, not silently in the background, if the time or zone is wrong.
[void][TimeSpan]::ParseExact($At, [string[]]@('hh\:mm', 'h\:mm'), [Globalization.CultureInfo]::InvariantCulture)
if ($TimeZone -ne 'Local') { [void][TimeZoneInfo]::FindSystemTimeZoneById($TimeZone) }
$runnerOptions = '-At "{0}" -TimeZone "{1}"' -f $At, $TimeZone

& $commandInstallerPath

if ($PushCommits) {
    $gitOutput = & git -C $repoRoot config core.hooksPath .githooks 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install repository hooks: $($gitOutput -join ' ')"
    }
    Write-Host 'Installed repository post-commit push hook.'
}

if ($env:AIKIT_HOME) {
    # A test home: never register a task or start a runner for the real user.
    Write-Host "Test home set: would start the daily sync runner ($runnerOptions); nothing registered."
    return
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
    '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" {1}' -f $runnerPath, $runnerOptions
)
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew
$launchInstalled = $false

try {
    Register-ScheduledTask -TaskName $taskName -Action $action `
        -Trigger $logonTrigger -Settings $settings `
        -Description "Start the global-instruction sync runner: at login and daily at $At ($TimeZone)." `
        -Force -ErrorAction Stop | Out-Null

    Write-Host "Installed scheduled task: $taskName"
    $launchInstalled = $true
} catch {
    Write-Warning "Scheduled tasks are unavailable: $($_.Exception.Message)"
}

if (-not $launchInstalled) {
    $startupRoot = [Environment]::GetFolderPath('Startup')
    if ([string]::IsNullOrWhiteSpace($startupRoot)) {
        throw 'Could not locate the current user Startup folder.'
    }

    $startupPath = Join-Path $startupRoot 'AI-Global-Instructions-Sync.cmd'
    # cmd reads the file in the console code page, so a profile path with accented letters would break; it expands
    # %USERPROFILE% itself instead.
    $profileRoot = [Environment]::GetFolderPath('UserProfile')
    $cmdRunnerPath = if ($runnerPath.StartsWith($profileRoot, [StringComparison]::OrdinalIgnoreCase)) {
        '%USERPROFILE%' + $runnerPath.Substring($profileRoot.Length)
    } else { $runnerPath }
    $command = @(
        '@echo off'
        ('start "" powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" {1}' -f $cmdRunnerPath, $runnerOptions)
    ) -join "`r`n"

    [IO.File]::WriteAllText($startupPath, $command + "`r`n", [Text.UTF8Encoding]::new($false))
    Write-Host "Scheduled tasks were blocked; installed user Startup runner instead: $startupPath"
}

$runnerArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" {1}' -f $runnerPath, $runnerOptions
Start-Process -FilePath 'powershell.exe' -ArgumentList $runnerArguments -WindowStyle Hidden
Write-Host 'Started the background sync runner for the current login.'
