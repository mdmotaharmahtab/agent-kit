[CmdletBinding()]
param(
    # The daily pull time (24-hour HH:mm) and a Windows time-zone id (Get-TimeZone -ListAvailable), or 'Local'.
    [string]$At = '10:00',
    [string]$TimeZone = 'Local'
)

# One-time setup after cloning the kit into ~/.ai-instructions: apply the rules and skills to every tool now, then
# pull and apply updates automatically at login and once a day. Run it again any time; it changes nothing twice,
# except the daily time, which goes back to -At's default unless you pass -At again.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# The generated rules files and the rules themselves refer to ~/.ai-instructions.
$expected = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.ai-instructions'
if (-not $env:AIKIT_HOME -and [IO.Path]::GetFullPath($repoRoot).TrimEnd('\') -ne $expected) {
    throw "The kit must be cloned into $expected, not $repoRoot. Clone it there and run setup.ps1 from that folder."
}

& (Join-Path $repoRoot 'sync.ps1')
& (Join-Path $repoRoot 'install-autosync.ps1') -At $At -TimeZone $TimeZone

Write-Host ''
Write-Host "Set up. Start a new session in each tool to load the rules. Updates are pulled at login and daily at $At."
