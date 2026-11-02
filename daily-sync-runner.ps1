[CmdletBinding()]
param(
    [switch]$RunOnce,
    # The daily pull time (24-hour HH:mm) and a Windows time-zone id (Get-TimeZone -ListAvailable), or 'Local'.
    [string]$At = '10:00',
    [string]$TimeZone = 'Local'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$syncPath = Join-Path $repoRoot 'sync.ps1'
$logPath = Join-Path $repoRoot 'autosync.log'
$mutexName = 'Local\AI-Global-Instructions-Daily-Sync'
$createdNew = $false
$mutex = New-Object Threading.Mutex($false, $mutexName, [ref]$createdNew)
$acquired = $false

function Write-SyncLog {
    param([string]$Message)
    $timestamp = [DateTimeOffset]::Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
    Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message" -Encoding UTF8
}

function Invoke-SafePull {
    try {
        Write-SyncLog 'Starting pull and apply.'
        # Log as output arrives so a terminating error cannot discard the
        # preceding Git diagnostics from an incomplete assignment. *>&1 also keeps
        # sync's notices and warnings (backups, a missing Node.js) in the log.
        $global:LASTEXITCODE = 0
        & $syncPath -Mode Pull *>&1 | ForEach-Object {
            Write-SyncLog $_.ToString()
        }
        if ($LASTEXITCODE -ne 0) {
            Write-SyncLog "Pull and apply stopped (exit code $LASTEXITCODE); see the message above."
        } else {
            Write-SyncLog 'Pull and apply completed.'
        }
    } catch {
        Write-SyncLog "Pull and apply failed safely: $($_.Exception.Message)"
    }
}

function Get-SyncTimeZone {
    if ($TimeZone -eq 'Local') { return [TimeZoneInfo]::Local }
    return [TimeZoneInfo]::FindSystemTimeZoneById($TimeZone)
}

function Get-NextRunUtc {
    param([TimeZoneInfo]$Zone, [TimeSpan]$TimeOfDay)

    $nowUtc = [DateTime]::UtcNow
    $nowLocal = [TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $Zone)
    $candidate = [DateTime]::SpecifyKind(
        $nowLocal.Date.Add($TimeOfDay),
        [DateTimeKind]::Unspecified
    )
    if ($candidate -le $nowLocal) {
        $candidate = $candidate.AddDays(1)
    }
    # A time skipped by the spring daylight-saving change (02:30 on that day) does not exist; run an hour later.
    if ($Zone.IsInvalidTime($candidate)) {
        $candidate = $candidate.AddHours(1)
    }
    return [TimeZoneInfo]::ConvertTimeToUtc($candidate, $Zone)
}

try {
    try {
        $acquired = $mutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        $acquired = $true
    }

    if (-not $acquired) {
        Write-SyncLog 'A background sync runner is already active; exiting duplicate.'
        return
    }

    try {
        $zone = Get-SyncTimeZone
        $timeOfDay = [TimeSpan]::ParseExact($At, [string[]]@('hh\:mm', 'h\:mm'), [Globalization.CultureInfo]::InvariantCulture)
    } catch {
        Write-SyncLog "Daily sync not scheduled: -At '$At' or -TimeZone '$TimeZone' is not valid. Re-run install-autosync.ps1."
        $zone = $null
    }

    Invoke-SafePull
    if ($RunOnce -or -not $zone) { return }

    while ($true) {
        try {
            $nextRunUtc = Get-NextRunUtc -Zone $zone -TimeOfDay $timeOfDay
        } catch {
            Write-SyncLog "Could not compute the next daily sync ($($_.Exception.Message)); retrying in an hour."
            $nextRunUtc = [DateTime]::UtcNow.AddHours(1)
        }
        Write-SyncLog ("Next daily sync: {0} UTC ({1} {2})." -f $nextRunUtc.ToString('u'), $At, $zone.Id)

        while ([DateTime]::UtcNow -lt $nextRunUtc) {
            $remaining = $nextRunUtc - [DateTime]::UtcNow
            $sleepSeconds = [Math]::Min(300, [Math]::Max(1, [Math]::Ceiling($remaining.TotalSeconds)))
            Start-Sleep -Seconds $sleepSeconds
        }

        Invoke-SafePull
    }
} finally {
    if ($acquired) {
        try { $mutex.ReleaseMutex() } catch { }
    }
    $mutex.Dispose()
}
